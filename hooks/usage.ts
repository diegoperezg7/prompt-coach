// Uso de cada llamada al modelo: tokens exactos (los que devuelve la llamada), su equivalente en dólares a precio
// de lista de la API (core/pricing.ts; con un plan de suscripción no se cobra) y cuánto movió cada ventana del
// plan (5 h, 7 días), que es con lo que se mueve quien tiene un plan. Las llamadas del mod no entran en /cost.
// Se guarda 90 días en el almacén del plugin y /coach usage lo enseña para poder comprobarlo.
import type { EngineInterface } from 'claude-code'

import type { Lang } from '../core/rubric.ts'
import type { Usage } from '../types'
import { UI } from './i18n.ts'

export type Call = {
  t: number
  model: string
  pass: 1 | 2
  /** Tokens de entrada de la llamada, incluidos los servidos o escritos en la caché. */
  input: number
  /** De esos, los que sirvió la caché. */
  cached: number
  /** De esos, los que se escribieron en la caché. */
  written: number
  output: number
  /** Dólares a precio de lista; null si el modelo no está en la tabla de precios. */
  usd: number | null
  ms: number
  ok: boolean
  /** Lo que subió cada ventana del plan durante la llamada, en puntos de porcentaje (resolución 0,1). */
  plan?: Record<string, number>
}

/** Una ventana del plan tal como la da el motor: `five_hour`, `seven_day` o `spend_limit`. */
export type PlanWindow = { kind: string; percentUsed: number; resetsAt?: string }

const KEY = 'usage'
const DAY = 24 * 60 * 60 * 1000

export async function nowMs($: EngineInterface): Promise<number> {
  return $.clock.now().catch(() => Date.now())
}

/** Las ventanas del plan ahora (gratis: no hace ninguna llamada); vacío sin plan o sin lectura. */
export async function planNow($: EngineInterface): Promise<PlanWindow[]> {
  const u = await $.session.usage().catch(() => null)
  return Array.isArray(u?.rateLimits) ? u.rateLimits.filter(w => typeof w?.percentUsed === 'number') : []
}

/** Lo que subió cada ventana entre dos lecturas; undefined si no hay ventanas que comparar. */
export function planDelta(before: PlanWindow[], after: PlanWindow[]): Record<string, number> | undefined {
  if (!before.length || !after.length) return undefined
  const out: Record<string, number> = {}
  for (const w of after) {
    const b = before.find(x => x.kind === w.kind)
    if (b) out[w.kind] = Math.max(0, Math.round((w.percentUsed - b.percentUsed) * 10) / 10)
  }
  return Object.keys(out).length ? out : undefined
}

export function summarize(calls: Call[]): Usage {
  const usd = calls.every(c => c.usd !== null) ? calls.reduce((s, c) => s + (c.usd ?? 0), 0) : null
  return {
    calls: calls.length,
    input: calls.reduce((s, c) => s + c.input, 0),
    cached: calls.reduce((s, c) => s + c.cached, 0),
    output: calls.reduce((s, c) => s + c.output, 0),
    usd,
    ms: calls.reduce((s, c) => s + c.ms, 0),
    plan: sumPlan(calls),
  }
}

function sumPlan(calls: Call[]): Record<string, number> | undefined {
  const seen = calls.filter(c => c.plan)
  if (!seen.length) return undefined
  const out: Record<string, number> = {}
  for (const c of seen) for (const [k, v] of Object.entries(c.plan!)) out[k] = Math.round(((out[k] ?? 0) + v) * 10) / 10
  return out
}

const comma = (lang: Lang) => lang !== 'en'
const dec = (n: number, digits: number, lang: Lang) => {
  const s = n.toFixed(digits)
  return comma(lang) ? s.replace('.', ',') : s
}
export function fmtUsd(usd: number | null, lang: Lang): string {
  if (usd === null) return UI[lang].costNA
  const v = dec(usd, usd < 0.01 ? 4 : 3, lang)
  return lang === 'en' ? `$${v}` : `${v} $`
}
const fmtSec = (ms: number, lang: Lang) => `${dec(ms / 1000, 1, lang)} s`
const apiUsd = (usd: number | null, lang: Lang) => (usd === null ? fmtUsd(usd, lang) : `${fmtUsd(usd, lang)} API`)

function windowName(kind: string, lang: Lang): string {
  const t = UI[lang]
  return kind === 'five_hour' ? '5 h' : kind === 'seven_day' ? t.win7d : kind === 'spend_limit' ? t.winSpend : kind
}

/** «plan 5 h +0,2 %», o «plan <0,1 %» si ninguna ventana se movió lo bastante para verlo; vacío sin plan. */
export function fmtPlan(plan: Record<string, number> | undefined, lang: Lang): string {
  if (!plan) return ''
  const t = UI[lang]
  const moved = Object.entries(plan).filter(([, v]) => v > 0)
  if (!moved.length) return `${t.plan} <${dec(0.1, 1, lang)} %`
  return `${t.plan} ${moved.map(([k, v]) => `${windowName(k, lang)} +${dec(v, 1, lang)} %`).join(', ')}`
}

/** «haiku · 2 llamadas · 3100 in (1200 caché) · 1200 out · 0,0012 $ · 6,1 s» */
export function usageLine(u: Usage, model: string, lang: Lang): string {
  const t = UI[lang]
  const cached = u.cached ? ` (${u.cached} ${t.cached})` : ''
  return [model, `${u.calls} ${u.calls === 1 ? t.call : t.calls}`, `${u.input} in${cached}`, `${u.output} out`, fmtPlan(u.plan, lang), apiUsd(u.usd, lang), fmtSec(u.ms, lang)]
    .filter(Boolean).join(' · ')
}

async function load($: EngineInterface): Promise<Call[]> {
  const raw = await $.store.get(KEY).catch(() => undefined)
  return Array.isArray(raw) ? (raw as Call[]).filter(c => typeof c?.t === 'number' && typeof c?.input === 'number') : []
}

// El registro es secundario: si el almacén falla, la mejora sigue igual.
export async function recordCalls($: EngineInterface, calls: Call[]) {
  if (!calls.length) return
  try {
    const now = await nowMs($)
    const kept = (await load($)).filter(c => now - c.t < 90 * DAY).slice(-(5000 - calls.length))
    await $.store.set(KEY, [...kept, ...calls])
  } catch {
    // sin registro esta vez
  }
}

const hhmm = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Totales de hoy y de 7 días, por modelo, y las últimas llamadas una a una. */
export async function usageText($: EngineInterface, lang: Lang): Promise<string> {
  const t = UI[lang]
  const now = await nowMs($)
  const all = await load($)
  if (!all.length) return t.usageNone
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const total = (cs: Call[]) => {
    const u = summarize(cs)
    return [`${u.calls} ${u.calls === 1 ? t.call : t.calls}`, `${u.input} in`, `${u.output} out`, fmtPlan(u.plan, lang), apiUsd(u.usd, lang)]
      .filter(Boolean).join(' · ')
  }
  const week = all.filter(c => now - c.t < 7 * DAY)
  const models = [...new Set(week.map(c => c.model))]
  const windows = await planNow($)
  const resets = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : ` (${t.resets} ${d.getDate()}/${d.getMonth() + 1} ${hhmm(d.getTime())})`
  }
  const lines = [
    t.usageTitle,
    ...(windows.length ? [`${t.planNow}: ${windows.map(w => `${windowName(w.kind, lang)} ${dec(w.percentUsed, 1, lang)} %${resets(w.resetsAt)}`).join(' · ')}`] : []),
    `${t.usageToday}: ${total(all.filter(c => c.t >= start.getTime()))}`,
    `${t.usageWeek}: ${total(week)}`,
  ]
  if (models.length) lines.push(`${t.usageByModel}: ${models.map(m => `${m} ${total(week.filter(c => c.model === m))}`).join(' | ')}`)
  lines.push(`${t.usageLast}:`)
  for (const c of all.slice(-10).reverse()) {
    const cached = c.cached ? ` (${c.cached} ${t.cached})` : ''
    const plan = fmtPlan(c.plan, lang)
    lines.push(`  ${hhmm(c.t)} ${c.model} · ${t.pass} ${c.pass} · ${c.input} in${cached} · ${c.output} out${plan ? ` · ${plan}` : ''} · ${apiUsd(c.usd, lang)} · ${fmtSec(c.ms, lang)}${c.ok ? '' : ` · ${t.noModel}`}`)
  }
  return lines.join('\n')
}
