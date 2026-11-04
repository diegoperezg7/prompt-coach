// Uso de cada llamada al modelo: tokens exactos (los que devuelve la llamada) y coste medido por Claude Code
// como la diferencia del total de la sesión antes y después, el mismo registro que /cost. Se guarda 90 días
// en el almacén del plugin y /coach usage lo enseña para poder comprobarlo.
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
  output: number
  /** Dólares; null si la sesión no lleva cuenta de coste. */
  usd: number | null
  ms: number
  ok: boolean
}

const KEY = 'usage'
const DAY = 24 * 60 * 60 * 1000

/** Lo que la sesión lleva gastado según Claude Code, o null si no lleva cuenta. */
export async function sessionUsd($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return typeof u?.cost?.usd === 'number' ? u.cost.usd : null
}

export async function nowMs($: EngineInterface): Promise<number> {
  return $.clock.now().catch(() => Date.now())
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
  }
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

/** «haiku · 2 llamadas · 3100 in (1200 caché) · 1200 out · 0,0012 $ · 6,1 s» */
export function usageLine(u: Usage, model: string, lang: Lang): string {
  const t = UI[lang]
  const cached = u.cached ? ` (${u.cached} ${t.cached})` : ''
  return [model, `${u.calls} ${t.calls}`, `${u.input} in${cached}`, `${u.output} out`, fmtUsd(u.usd, lang), fmtSec(u.ms, lang)]
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
    return `${u.calls} ${t.calls} · ${u.input} in · ${u.output} out · ${fmtUsd(u.usd, lang)}`
  }
  const week = all.filter(c => now - c.t < 7 * DAY)
  const models = [...new Set(week.map(c => c.model))]
  const lines = [
    t.usageTitle,
    `${t.usageToday}: ${total(all.filter(c => c.t >= start.getTime()))}`,
    `${t.usageWeek}: ${total(week)}`,
  ]
  if (models.length) lines.push(`${t.usageByModel}: ${models.map(m => `${m} ${total(week.filter(c => c.model === m))}`).join(' | ')}`)
  lines.push(`${t.usageLast}:`)
  for (const c of all.slice(-10).reverse()) {
    const cached = c.cached ? ` (${c.cached} ${t.cached})` : ''
    lines.push(`  ${hhmm(c.t)} ${c.model} · ${t.pass} ${c.pass} · ${c.input} in${cached} · ${c.output} out · ${fmtUsd(c.usd, lang)} · ${fmtSec(c.ms, lang)}${c.ok ? '' : ` · ${t.noModel}`}`)
  }
  return lines.join('\n')
}
