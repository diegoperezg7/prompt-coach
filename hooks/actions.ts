// Acciones: mejorar, aplicar, deshacer, enviar, descartar y seguir el compositor.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult } from 'claude-code'

import {
  assess, buildPrompt, describeMissing, isQuestion, isRepairable, keepAttachments, langOf, projectRulesBlock,
  recentContext, repairPrompt, rewritePrompt, systemPrompt, unfence,
} from '../core/rubric.ts'
import type { Lang } from '../core/rubric.ts'
import { UI } from './i18n.ts'
import { cfg, isCoachable, MAX_DRAFT, noteLang, PANE, RULE_FILES, ses, ui, uiLang } from './state.ts'

// El motor exige que cada fichero declare las referencias de $.state que lee o escribe; actions.ts y
// views.tsx declaran las mismas (misma clave y misma forma).
const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, { shape: 'proposal-3' })

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

export async function improve($: EngineInterface, text: string): Promise<Improved> {
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
    return await rewrite($, text, lang, id, controller.signal)
  } catch {
    return { text, score: before }
  } finally {
    // Pase lo que pase (un fallo del motor, un modelo bloqueado), el panel no se queda ocupado.
    if (id === ses.run) {
      await update($, proposal, p => (p && p.isBusy ? { ...p, text: p.original, isBusy: false, note: UI[p.lang].noModel } : p))
    }
  }
}

async function rewrite($: EngineInterface, text: string, lang: Lang, id: number, signal: AbortSignal): Promise<Improved> {
  const cwd = await $.session.cwd()
  const used = cfg.model === 'session' ? await $.session.model() : cfg.model

  const context = recentContext(await $.session.messages())
  const rules = cfg.projectRules
    ? projectRulesBlock(await Promise.all(RULE_FILES.map(async name => ({ name, text: await $.fs.read(`${cwd}/${name}`).catch(() => '') }))))
    : ''
  // Lo que el agente ya sabe: una ruta de la propuesta solo puntúa si sale de aquí.
  const known = [text, context, rules].join('\n')
  const opts = { cwd, context, rules }
  const ask = (prompt: string) => $.model.complete({
    model: used, system: systemPrompt(lang, cfg.verbosity), prompt, maxTokens: 900, effort: 'low', timeoutMs: 30_000,
  }, { signal })

  const r = await ask(rewritePrompt(text, opts))
  let best = r.isAnswered ? keepAttachments(text, unfence(r.text)) : ''
  let passes = r.isAnswered ? 1 : 0
  let tokens = r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens + r.usage.output_tokens
  // Segunda pasada dirigida: solo si quedan criterios que el modelo puede cubrir sin inventar datos.
  if (best) {
    const a = assess(best, { known, cwd })
    if (a.score < 100 && isRepairable(a) && !signal.aborted) {
      const r2 = await ask(repairPrompt(text, best, a, opts))
      tokens += r2.usage.input_tokens + r2.usage.cache_read_input_tokens + r2.usage.cache_creation_input_tokens + r2.usage.output_tokens
      if (r2.isAnswered) {
        passes = 2
        const second = keepAttachments(text, unfence(r2.text))
        if (assess(second, { known, cwd }).score > a.score) best = second
      }
    }
  }
  const local = best ? null : buildPrompt(text, cwd)
  const out = best || keepAttachments(text, local!.prompt)
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
          tokens: passes ? tokens : undefined,
          origin: best ? ('model' as const) : ('local' as const),
          model: best ? used : undefined,
          note: best ? undefined : failureNote(r, uiLang(text)),
          changes: local ? local.changes : [],
          isBusy: false,
        }
      : p,
  )
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
}

// VS Code: el compositor de la extensión no manda teclas, así que el botón lee el borrador al pulsarlo.
// También la banda y el panel vacío del terminal: misma validación y nunca dos mejoras a la vez.
export async function improveFromBox($: EngineInterface) {
  if ((await read($, proposal))?.isBusy) return
  const text = (await $.prompt.read()).text.trim()
  const t = ui(text)
  if (!isCoachable(text)) return $.ui.toast(t.empty)
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
export async function onDraft($: EngineInterface, text: string, isOwnFill: boolean) {
  noteLang($, text)
  await update($, draft, () => text)
  if (!isOwnFill && (await read($, proposal))) void dismiss($)
  if (ses.hasBand) return
  if (!isCoachable(text) || isQuestion(text)) return $.ui.status(undefined)
  const a = assess(text)
  const t = ui(text)
  $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100 · ${t.hint}`)
}
