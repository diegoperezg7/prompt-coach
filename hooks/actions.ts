// Acciones: mejorar, aplicar, deshacer, enviar, descartar y seguir el compositor.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult } from 'claude-code'

import {
  assess, buildPrompt, describeMissing, LABEL, isQuestion, isRepairable, keepAttachments, langOf, projectRulesBlock,
  recentContext, repairPrompt, rewritePrompt, systemPrompt, unfence,
} from '../core/rubric.ts'
import type { CriterionId, Lang } from '../core/rubric.ts'
import { UI } from './i18n.ts'
import { callCost } from '../core/pricing.ts'
import { draftForModel, expandPastes, hasPasteChip, hasPastedBlock, restorePastes, splitPastes } from '../core/pastes.ts'
import type { Pasted } from '../core/pastes.ts'
import { nowMs, planDelta, planNow, recordCalls, summarize } from './usage.ts'
import type { Call } from './usage.ts'
import { cfg, isCoachable, MAX_DRAFT, noteLang, PANE, RULE_FILES, ses, ui, uiLang } from './state.ts'

// El motor exige que cada fichero declare las referencias de $.state que lee o escribe; actions.ts y
// views.tsx declaran las mismas (misma clave y misma forma).
const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, { shape: 'proposal-4' })

function failureNote(r: ModelCompleteResult, lang: Lang): string {
  const t = UI[lang]
  if (r.isAnswered) return t.emptyReply
  if (r.reason === 'api-error') return `${t.noModel} (${r.error}${r.status ? ' ' + r.status : ''})`
  if (r.reason === 'aborted') return t.timeout
  return t.emptyReply
}

// Declarada con `function`: el motor solo sigue $ entre ficheros hasta declaraciones de función.
export function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Prompt Coach', focus: true, closeOnEscape: true, rows: 24 }).catch(() => ({ isPlaced: false as const }))
}

export type Improved = { text: string; score: number }

// Una propuesta que quedó ocupada en una sesión anterior (una recarga a mitad) no debe bloquear el panel.
export async function clearStaleBusy($: EngineInterface) {
  await update($, proposal, p => (p && p.isBusy ? null : p))
}

export async function improve($: EngineInterface, sent: string): Promise<Improved> {
  // Un prompt enviado con texto pegado llega con el contenido entre etiquetas: se puntúa y se guarda expandido,
  // y el modelo lee un dictado entero o, si es material de apoyo, las palabras de la persona con el pegado aparte.
  const pasted = hasPastedBlock(sent) ? splitPastes(sent) : null
  const text = pasted ? expandPastes(sent) : sent
  const lang = langOf(text)
  const before = assess(text).score
  noteLang($, text)
  ses.edited = null
  ses.stop?.abort()
  const controller = new AbortController()
  ses.stop = controller
  const id = ++ses.run
  // Estado y panel se piden antes del primer await, mientras sigue en curso la pulsación o el comando de la
  // persona: un panel abierto después cuenta como no pedido y en un terminal estrecho no se coloca.
  const busy = update($, proposal, () => ({
    original: text, text: '', lang: uiLang(text), before, after: before, origin: 'local' as const, changes: [], missing: [], passes: 0, isBusy: true, isApplied: false,
  }))
  const opening = openPane($)
  await busy
  await opening
  try {
    return await rewrite($, text, pasted, lang, id, controller.signal)
  } catch {
    return { text, score: before }
  } finally {
    // Pase lo que pase (un fallo del motor, un modelo bloqueado), el panel no se queda ocupado.
    if (id === ses.run) {
      await update($, proposal, p => (p && p.isBusy ? { ...p, text: p.original, isBusy: false, note: UI[p.lang].noModel } : p))
    }
  }
}

async function rewrite($: EngineInterface, text: string, pasted: Pasted | null, lang: Lang, id: number, signal: AbortSignal): Promise<Improved> {
  const forModel = pasted ? draftForModel(pasted) : text
  const cwd = await $.session.cwd()
  const used = cfg.model === 'session' ? await $.session.model() : cfg.model

  const context = recentContext(await $.session.messages())
  const rules = cfg.projectRules
    ? projectRulesBlock(await Promise.all(RULE_FILES.map(async name => ({ name, text: await $.fs.read(`${cwd}/${name}`).catch(() => '') }))))
    : ''
  // Lo que el agente ya sabe: una ruta de la propuesta solo puntúa si sale de aquí.
  const known = [text, context, rules].join('\n')
  const opts = { cwd, context, rules }
  // Cada llamada se mide: tokens de su respuesta y su coste a precio de lista (las del mod no entran en /cost).
  const calls: Call[] = []
  async function ask(prompt: string, pass: 1 | 2) {
    const plan0 = await planNow($)
    const t0 = await nowMs($)
    const res = await $.model.complete({
      model: used, system: systemPrompt(lang, cfg.verbosity), prompt, maxTokens: 900, effort: 'low', timeoutMs: 30_000,
    }, { signal })
    const t1 = await nowMs($)
    const plan1 = await planNow($)
    const u = res.usage
    calls.push({
      t: t0, model: used, pass,
      input: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
      cached: u.cache_read_input_tokens,
      written: u.cache_creation_input_tokens,
      output: u.output_tokens,
      usd: callCost(used, { uncached: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }),
      ms: t1 - t0,
      ok: res.isAnswered,
      plan: planDelta(plan0, plan1),
    })
    return res
  }

  const r = await ask(rewritePrompt(forModel, opts), 1)
  let best = r.isAnswered ? keepAttachments(forModel, unfence(r.text)) : ''
  let passes = r.isAnswered ? 1 : 0
  // Segunda pasada dirigida: solo si quedan criterios que el modelo puede cubrir sin inventar datos.
  if (best) {
    const a = assess(best, { known, cwd })
    if (a.score < 100 && isRepairable(a) && !signal.aborted) {
      const r2 = await ask(repairPrompt(forModel, best, a, opts), 2)
      if (r2.isAnswered) {
        passes = 2
        const second = keepAttachments(forModel, unfence(r2.text))
        if (assess(second, { known, cwd }).score > a.score) best = second
      }
    }
  }
  const local = best ? null : buildPrompt(forModel, cwd)
  const drafted = best || keepAttachments(forModel, local!.prompt)
  // El material de apoyo vuelve entero a la propuesta, para que el agente lo reciba igual que con el original.
  const out = pasted ? restorePastes(drafted, pasted) : drafted
  const after = assess(out, { known, cwd })
  await update($, proposal, p =>
    p && id === ses.run
      ? {
          ...p,
          text: out,
          after: after.score,
          missing: describeMissing(after, uiLang(text)),
          ask: askFor(after),
          passes,
          usage: calls.length ? summarize(calls) : undefined,
          origin: best ? ('model' as const) : ('local' as const),
          model: best ? used : undefined,
          note: best ? undefined : failureNote(r, uiLang(text)),
          changes: local ? local.changes : [],
          isBusy: false,
        }
      : p,
  )
  await recordCalls($, calls)
  return { text: out, score: after.score }
}

// Contexto y detalle son datos que el modelo no puede inventar: si faltan, el panel se los pide a la persona.
function askFor(a: ReturnType<typeof assess>): 'contexto' | 'detalle' | undefined {
  return a.missing.find(c => c.id === 'contexto' || c.id === 'detalle')?.id as 'contexto' | 'detalle' | undefined
}

// Lo que responde se añade al borrador, así cuenta como algo que la persona dijo, y se mejora otra vez.
export async function addFact($: EngineInterface, fact: string) {
  const p = await read($, proposal)
  if (!p || p.isBusy || !fact.trim()) return
  await improve($, `${p.original}\n\n${fact.trim()}`)
}

export async function apply($: EngineInterface, text?: string) {
  const p = await read($, proposal)
  if (!p || p.isBusy) return
  const final = text ?? ses.edited ?? p.text
  const filled = await $.prompt.fill({ text: final })
  if (!filled.isFilled) return $.ui.toast(UI[p.lang].notFilled)
  await update($, proposal, q => (q ? { ...q, text: final, isApplied: true } : q))
}

export async function undo($: EngineInterface) {
  const p = await read($, proposal)
  if (!p) return
  await $.prompt.fill({ text: p.original })
  await update($, proposal, q => (q ? { ...q, isApplied: false } : q))
}

// ponytail: sondeo del compositor cada segundo porque la extensión de VS Code no envía prompt.edit; quitar cuando lo envíe.
const POLL_MS = 1000
let isPolling = false
let lastPolled: string | null = null
async function pollComposer($: EngineInterface) {
  const box = await $.prompt.read().catch(() => null)
  if (!box || box.text === lastPolled) return
  lastPolled = box.text
  noteLang($, box.text)
  await update($, draft, () => box.text)
}
export function startPoll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  $.clock.every(POLL_MS, () => { void pollComposer($) })
}

// $.prompt.submit no pasa por el compositor: se vacía antes para que no quede el borrador viejo.
export async function sendAs($: EngineInterface, text: string) {
  const p = await read($, proposal)
  await $.prompt.fill({ text: '' }).catch(() => undefined)
  await dismiss($)
  const sent = await $.prompt.submit({ text })
  // Otro hook puede rechazar el envío: entonces el borrador de la persona vuelve al compositor.
  if (sent.drop !== undefined) await $.prompt.fill({ text: p?.original ?? text }).catch(() => undefined)
  else await recordScore($, text)
}

// VS Code: el compositor de la extensión no manda teclas, así que el botón lee el borrador al pulsarlo.
// También la banda y el panel vacío del terminal: misma validación y nunca dos mejoras a la vez.
export async function improveFromBox($: EngineInterface) {
  if ((await read($, proposal))?.isBusy) return
  const text = (await $.prompt.read()).text.trim()
  const t = ui(text)
  if (!isCoachable(text)) return $.ui.toast(t.empty)
  if (hasPasteChip(text)) return $.ui.toast(pasteHint(text))
  if (text.length > MAX_DRAFT) return $.ui.toast(t.tooLong)
  await improve($, text)
}

// Descarta la propuesta. Donde hay banda (terminal, escritorio) el panel se abrió a demanda y se cierra;
// en VS Code el panel es fijo, con el botón, y solo vuelve al estado inicial.
export async function dismiss($: EngineInterface, restore = false) {
  ses.edited = null
  ses.stop?.abort()
  ses.run++
  const p = await read($, proposal)
  // Tras retener un Enter en VS Code el compositor puede quedar vacío: Cancelar no debe perder el borrador.
  if (restore && p && !ses.hasBand && !(await $.prompt.read().catch(() => ({ text: '' }))).text.trim()) {
    await $.prompt.fill({ text: p.original }).catch(() => undefined)
  }
  await update($, proposal, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// Lo que hay en el compositor: teclear llega por prompt.edit, lo demás (historial, fill, clear) por prompt.change.
export async function onDraft($: EngineInterface, text: string, keepProposal: boolean) {
  noteLang($, text)
  await update($, draft, () => text)
  if (!keepProposal && (await read($, proposal))) void dismiss($)
  if (ses.hasBand) return
  if (!isCoachable(text) || isQuestion(text)) return $.ui.status(undefined)
  if (hasPasteChip(text)) return $.ui.status(pasteHint(text))
  const a = assess(text)
  const t = ui(text)
  $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100 · ${t.hint}`)
}

/** Lo que se dice en vez de puntuar un marcador de pegado, cuyo contenido aún no se puede leer. */
export function pasteHint(text: string): string {
  const t = ui(text)
  return cfg.holdPasted ? t.pasteHint : t.pasteHintNoHold
}

// ---------- historial ----------

// Nota de cada prompt enviado, 90 días, en el almacén del plugin (entre sesiones y proyectos).
const HISTORY = 'history'
const DAY = 24 * 60 * 60 * 1000
type Entry = { t: number; score: number; missing: CriterionId[] }

async function history($: EngineInterface): Promise<Entry[]> {
  const raw = await $.store.get(HISTORY).catch(() => undefined)
  return Array.isArray(raw) ? (raw as Entry[]).filter(e => typeof e?.t === 'number' && typeof e?.score === 'number') : []
}

// El historial es secundario: si el reloj o el almacén fallan, el envío sigue igual.
export async function recordScore($: EngineInterface, text: string) {
  try {
    const now = await $.clock.now()
    const a = assess(expandPastes(text))
    const kept = (await history($)).filter(e => now - e.t < 90 * DAY).slice(-1999)
    kept.push({ t: now, score: a.score, missing: a.missing.map(c => c.id) })
    await $.store.set(HISTORY, kept)
  } catch {
    // sin historial esta vez
  }
}

/** «Esta semana: 72 (14 prompts) · semana anterior: 61 (9), +11. Criterio que más falla: aceptación (64 %).» */
export async function statsText($: EngineInterface, lang: Lang): Promise<string> {
  const t = UI[lang]
  const now = await $.clock.now()
  const all = (await history($)).filter(e => now - e.t < 90 * DAY)
  if (!all.length) return t.statsNone
  const week = all.filter(e => now - e.t < 7 * DAY)
  const prev = all.filter(e => now - e.t >= 7 * DAY && now - e.t < 14 * DAY)
  const mean = (xs: Entry[]) => Math.round(xs.reduce((s, e) => s + e.score, 0) / xs.length)
  const parts = [`${t.statsThis}: ${week.length ? `${mean(week)}/100 (${week.length} ${t.statsPrompts})` : '-'}`]
  if (prev.length) {
    const delta = week.length ? mean(week) - mean(prev) : 0
    parts.push(`${t.statsPrev}: ${mean(prev)}/100 (${prev.length} ${t.statsPrompts})${week.length ? `, ${delta >= 0 ? '+' : ''}${delta}` : ''}`)
  }
  const pool = week.length ? week : all
  const counts = new Map<CriterionId, number>()
  for (const e of pool) for (const id of e.missing) counts.set(id, (counts.get(id) ?? 0) + 1)
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]
  const line = `Prompt Coach · ${parts.join(' · ')}.`
  return top ? `${line} ${t.statsTop}: ${LABEL[lang][top[0]]} (${Math.round((top[1] / pool.length) * 100)} %).` : line
}
