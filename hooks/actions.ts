// Acciones: mejorar, aplicar, deshacer, enviar, descartar y seguir el compositor.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult } from 'claude-code'

import {
  assess, buildPrompt, describeMissing, LABEL, keepAttachments, langOf, projectRulesBlock,
  completable, completePrompt, completeSystem, isSolid, recentContext, repairPrompt, rewritePrompt, shouldRepair, systemPrompt, turnOf, unfence,
} from '../core/rubric.ts'
import type { CriterionId, Lang, Turn } from '../core/rubric.ts'
import { UI } from './i18n.ts'
import { callCost } from '../core/pricing.ts'
import { draftForModel, expandPastes, hasPasteChip, hasPastedBlock, restorePastes, splitPastes } from '../core/pastes.ts'
import type { Pasted } from '../core/pastes.ts'
import { nowMs, planDelta, planNow, recordCalls, summarize } from './usage.ts'
import type { Call } from './usage.ts'
import { cfg, isCoachable, MAX_DRAFT, noteLang, PANE, PANE_CHROME, RULE_FILES, scoreOf, ses, skipScore, ui, uiLang, wrappedRows } from './state.ts'

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
export function openPane($: EngineInterface, rows = 24) {
  return $.ui.open({ id: PANE, title: 'Prompt Coach', focus: true, closeOnEscape: true, rows }).catch(() => ({ isPlaced: false as const }))
}

// Con la propuesta lista, el panel pide el alto que necesita para mostrarla entera; el terminal lo concede hasta
// donde le cabe, y un alto que la persona haya fijado arrastrando manda.
async function fitPane($: EngineInterface, text: string) {
  if (!text || ses.paneClosed) return
  await openPane($, Math.max(24, wrappedRows(text, ses.paneCols) + 1 + PANE_CHROME))
}

export type Improved = { text: string; score: number }

// Una propuesta que quedó ocupada en una sesión anterior (una recarga a mitad) no debe bloquear el panel.
export async function clearStaleBusy($: EngineInterface) {
  await update($, proposal, p => (p && p.isBusy ? null : p))
}

export async function improve($: EngineInterface, sent: string, opts: { held?: boolean } = {}): Promise<Improved> {
  // Un prompt enviado con texto pegado llega con el contenido entre etiquetas: se puntúa y se guarda expandido,
  // y el modelo lee un dictado entero o, si es material de apoyo, las palabras de la persona con el pegado aparte.
  const pasted = hasPastedBlock(sent) ? splitPastes(sent) : null
  const text = pasted ? expandPastes(sent) : sent
  const lang = langOf(text)
  const before = scoreOf(text).score
  noteLang($, text)
  ses.edited = null
  ses.stop?.abort()
  const controller = new AbortController()
  ses.stop = controller
  const id = ++ses.run
  // Estado y panel se piden antes del primer await, mientras sigue en curso la pulsación o el comando de la
  // persona: un panel abierto después cuenta como no pedido y en un terminal estrecho no se coloca.
  const busy = update($, proposal, () => ({
    original: text, text: '', lang: uiLang(text), before, after: before, origin: 'local' as const, changes: [], missing: [], passes: 0, isBusy: true, isApplied: false, held: opts.held,
  }))
  ses.paneClosed = false
  const opening = openPane($)
  await busy
  await opening
  try {
    const done = await rewrite($, text, pasted, lang, id, controller.signal)
    if (id === ses.run) {
      const p = await read($, proposal)
      if (p && !p.isBusy) await fitPane($, p.text)
    }
    return done
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

  const rows = await $.session.messages()
  ses.talk = rows
  const turn = turnOf(text, rows)
  lastTurn = turn
  const context = recentContext(rows, cwd)
  // Una respuesta a una pregunta del agente no necesita las reglas del proyecto: solo engordan la respuesta.
  const rules = cfg.projectRules && turn !== 'reply'
    ? projectRulesBlock(await Promise.all(RULE_FILES.map(async name => ({ name, text: await $.fs.read(`${cwd}/${name}`).catch(() => '') }))))
    : ''
  // Lo que el agente ya sabe: una ruta de la propuesta solo puntúa si sale de aquí.
  const known = [text, context, rules].join('\n')
  const opts = { cwd, context, rules, turn }
  // Cada llamada se mide: tokens de su respuesta y su coste a precio de lista (las del mod no entran en /cost).
  const calls: Call[] = []
  async function ask(prompt: string, pass: 1 | 2, system = systemPrompt(lang, cfg.verbosity, turn)) {
    const plan0 = await planNow($)
    const t0 = await nowMs($)
    const res = await $.model.complete({
      model: used, system, prompt, maxTokens: 900, effort: 'low', timeoutMs: 30_000,
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

  // Un encargo que ya está bien no se reescribe: se conserva y se le añade solo lo que falte y se pueda añadir.
  const draftA = assess(forModel, { known, cwd, turn })
  const solid = !pasted && isSolid(draftA, turn)
  let r: ModelCompleteResult | null = null
  let best = ''
  let passes = 0
  if (solid) {
    best = forModel
    if (completable(draftA).length && !signal.aborted) {
      r = await ask(completePrompt(forModel, draftA, lang, opts), 1, completeSystem(lang))
      if (r.isAnswered) {
        passes = 1
        const done = keepAttachments(forModel, unfence(r.text))
        // Si el modelo tocó el borrador en vez de añadir, se queda el borrador.
        if (done.includes(forModel.trim()) && assess(done, { known, cwd, turn }).score > draftA.score) best = done
      }
    }
  } else {
    r = await ask(rewritePrompt(forModel, opts), 1)
    best = r.isAnswered ? keepAttachments(forModel, unfence(r.text)) : ''
    passes = r.isAnswered ? 1 : 0
  }
  // Segunda pasada dirigida: solo si quedan criterios que el modelo puede cubrir sin inventar datos.
  if (best && !solid) {
    const a = assess(best, { known, cwd, turn })
    if (shouldRepair(a, turn) && !signal.aborted) {
      const r2 = await ask(repairPrompt(forModel, best, a, opts), 2)
      if (r2.isAnswered) {
        passes = 2
        const second = keepAttachments(forModel, unfence(r2.text))
        if (assess(second, { known, cwd, turn }).score > a.score) best = second
      }
    }
  }
  // Sin modelo, una continuación se queda como está: la plantilla local es justo lo que sobra ahí.
  const local = best || turn !== 'new' ? null : buildPrompt(forModel, cwd)
  const drafted = best || (local ? keepAttachments(forModel, local.prompt) : forModel)
  // El material de apoyo vuelve entero a la propuesta, para que el agente lo reciba igual que con el original.
  const out = pasted ? restorePastes(drafted, pasted) : drafted
  const after = assess(out, { known, cwd, turn })
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
          model: best && calls.length ? used : undefined,
          note: best || !r ? undefined : failureNote(r, uiLang(text)),
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
  // Sustituido el borrador, el panel sobra: se cierra, y /coach undo devuelve el de la persona.
  ses.lastOriginal = p.original
  await recordOutcome($, final !== p.original)
  $.ui.toast(UI[p.lang].appliedToast)
  await dismiss($)
}

/** /coach undo: vuelve a poner en el compositor el borrador que había antes de «Sustituir borrador». */
export async function undo($: EngineInterface): Promise<boolean> {
  if (ses.lastOriginal === null) return false
  const filled = await $.prompt.fill({ text: ses.lastOriginal })
  if (filled.isFilled) ses.lastOriginal = null
  return filled.isFilled
}

// ponytail: sondeo del compositor cada segundo porque la extensión de VS Code no envía prompt.edit; quitar cuando lo envíe.
const POLL_MS = 1000
let isPolling = false
let lastPolled: string | null = null
async function pollComposer($: EngineInterface) {
  const box = await $.prompt.read().catch(() => null)
  if (!box || box.text === lastPolled) return
  await noteTalk($, lastPolled, box.text)
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
  else {
    await recordScore($, text)
    if (p && !p.isBusy) await recordOutcome($, text !== p.original)
  }
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
  // Cancelar una propuesta ya hecha es descartarla.
  if (restore && p && !p.isBusy && p.text) await recordOutcome($, false)
  // Tras retener un Enter en VS Code el compositor puede quedar vacío: Cancelar no debe perder el borrador.
  if (restore && p && !ses.hasBand && !(await $.prompt.read().catch(() => ({ text: '' }))).text.trim()) {
    await $.prompt.fill({ text: p.original }).catch(() => undefined)
  }
  await update($, proposal, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// La conversación se lee al empezar cada borrador, no a cada tecla: es lo que dice si es respuesta o continuación.
async function noteTalk($: EngineInterface, before: string | null, text: string) {
  if (before?.trim() || !text.trim()) return
  ses.talk = await $.session.messages().catch(() => ses.talk)
}

// Lo que hay en el compositor: teclear llega por prompt.edit, lo demás (historial, fill, clear) por prompt.change.
export async function onDraft($: EngineInterface, text: string, keepProposal: boolean) {
  await noteTalk($, await read($, draft), text)
  noteLang($, text)
  await update($, draft, () => text)
  const open = keepProposal ? null : await read($, proposal)
  // Seguir escribiendo encima de una propuesta terminada también es descartarla.
  if (open) {
    if (!open.isBusy && open.text) await recordOutcome($, false)
    void dismiss($)
  }
  if (ses.hasBand) return
  if (!isCoachable(text) || skipScore(text)) return $.ui.status(undefined)
  if (hasPasteChip(text)) return $.ui.status(pasteHint(text))
  const a = scoreOf(text)
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
    const a = scoreOf(expandPastes(text))
    const kept = (await history($)).filter(e => now - e.t < 90 * DAY).slice(-1999)
    kept.push({ t: now, score: a.score, missing: a.missing.map(c => c.id) })
    await $.store.set(HISTORY, kept)
  } catch {
    // sin historial esta vez
  }
}

// ---------- lo que se hace con las propuestas ----------

// Si cada propuesta se usó (sustituida o enviada) o se descartó, por tipo de turno, para dejar de retener el Enter
// donde la persona siempre la descarta.
const OUTCOMES = 'outcomes'
const SHUN_AFTER = 5
type Outcome = { t: number; turn: Turn; used: boolean }
let lastTurn: Turn = 'new'

async function outcomes($: EngineInterface): Promise<Outcome[]> {
  const raw = await $.store.get(OUTCOMES).catch(() => undefined)
  return Array.isArray(raw) ? (raw as Outcome[]).filter(o => typeof o?.used === 'boolean' && typeof o?.turn === 'string') : []
}

async function recordOutcome($: EngineInterface, used: boolean) {
  try {
    const kept = (await outcomes($)).slice(-199)
    kept.push({ t: await $.clock.now(), turn: lastTurn, used })
    await $.store.set(OUTCOMES, kept)
  } catch {
    // secundario: sin registro esta vez
  }
}

/** True si las últimas cinco propuestas de este tipo de turno se descartaron todas: no se retiene el Enter. */
export async function isShunned($: EngineInterface, turn: Turn): Promise<boolean> {
  const last = (await outcomes($)).filter(o => o.turn === turn).slice(-SHUN_AFTER)
  return last.length === SHUN_AFTER && last.every(o => !o.used)
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
