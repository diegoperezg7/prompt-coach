// Prompt Coach: conecta los eventos del motor con el estado (state.ts), las acciones (actions.ts) y el dibujo
// (views.tsx). La rúbrica y los prompts del modelo viven en core/, sin dependencias de Claude Code.
import type { Register } from 'claude-code'

import { assess, isQuestion, LANGS } from '../core/rubric.ts'
import type { Lang } from '../core/rubric.ts'
import { clearStaleBusy, improve, onDraft, openPane, pasteHint, recordScore, statsText, undo } from './actions.ts'
import { expandPastes, hasPasteChip, hasPastedBlock } from '../core/pastes.ts'
import { usageText } from './usage.ts'
import { UI } from './i18n.ts'
import { cfg, isCoachable, LAST_LANG, MAX_DRAFT, MODELS, PANE, ses, ui, uiLang } from './state.ts'
import { bandTerminal, bandVscode, paneTerminal, paneVscode } from './views.tsx'

export { paneLayout } from './state.ts'

export const register: Register = (on, options) => {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  cfg.language = pick(options.language, ['auto', ...LANGS] as const, 'auto')
  cfg.model = pick(options.model, MODELS, 'haiku')
  cfg.verbosity = pick(options.verbosity, ['concise', 'balanced', 'detailed'] as const, 'balanced')
  cfg.projectRules = options.projectRules !== false
  cfg.holdPasted = options.holdPasted !== false

  on('session.start', async ($, e, next) => {
    ses.hasBand = e.surface === 'terminal' || e.surface === 'desktop'
    ses.surface = e.surface
    const remembered = await $.store.get(LAST_LANG).catch(() => undefined)
    if ((LANGS as readonly unknown[]).includes(remembered)) ses.lastLang = remembered as Lang
    await clearStaleBusy($)
    await $.command.register({
      name: 'coach',
      description: UI[cfg.language === 'auto' ? 'en' : cfg.language].command,
    })
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    await onDraft($, r.text, false)
    return r
  })

  on('prompt.change', async ($, e, next) => {
    // La propuesta solo se descarta si la persona cambia el borrador (historial, deshacer). Lo que mueve el motor
    // no cuenta: tras retener un Enter devuelve el borrador al compositor, y eso no es seguir escribiendo.
    const byPerson = e.origin.kind === 'history' || e.origin.kind === 'undo'
    await onDraft($, e.text, !byPerson)
    return next(e)
  })

  // Sin banda (VS Code) el motor no ve las teclas: el único momento de ofrecer la mejora es el Enter.
  // Se retiene solo un prompt flojo con intención de trabajo (no preguntas ni respuestas cortas), sin adjuntos.
  on('prompt.submit', async ($, e, next) => {
    // Lo pegado llega aquí expandido, entre etiquetas: se puntúa sin ellas.
    const text = expandPastes(e.text.trim())
    const pastedHold = cfg.holdPasted && hasPastedBlock(e.text)
    // Historial: la nota de lo que sale de verdad desde el compositor (no comandos ni preguntas); lo que se
    // retiene no ha salido, y lo que se envía después desde el panel se registra en sendAs.
    const pass = async () => {
      if (e.origin.kind === 'composer' && !e.command && !e.isMeta && isCoachable(text) && !isQuestion(text)) await recordScore($, text)
      return next(e)
    }
    // VS Code retiene siempre (no ve las teclas); en terminal y escritorio, solo lo que lleva texto pegado.
    const canHold = ses.surface === 'vscode' || ses.surface === 'mobile' || (pastedHold && ses.surface !== null)
    if (!canHold || e.command || e.isMeta || e.attachments?.length) return pass()
    if (e.origin.kind !== 'composer') return pass()
    if (!isCoachable(text) || isQuestion(text)) return pass()
    const a = assess(text)
    const t = ui(text)
    if (!a.weak || a.intent === 'ask' || a.words < 3) {
      $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100`)
      return pass()
    }
    const done = await improve($, e.text.trim(), { held: true })
    // Una sola línea: el aviso de un Enter retenido no admite saltos de línea, y la propuesta ya está en el panel.
    return { drop: `Prompt Coach: ${t.weak} ${a.score}/100 → ${done.score}/100. ${t.held}` }
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const typed = e.args.trim()
    if (typed === 'stats') return { text: await statsText($, uiLang('')) }
    if (typed === 'usage') return { text: await usageText($, uiLang('')) }
    if (typed === 'undo') return { text: (await undo($)) ? ui('').undone : ui('').nothingToUndo }
    const text = (typed || (await $.prompt.read()).text).trim()
    const t = ui(text)
    if (!isCoachable(text)) return { text: t.empty }
    if (hasPasteChip(text)) return { text: pasteHint(text) }
    if (text.length > MAX_DRAFT) return { text: t.tooLong }
    // Con panel colocado, el comando responde al momento y la propuesta llega al panel. Si el terminal es
    // demasiado estrecho para colocarlo, la propuesta va en la respuesta del comando.
    if (ses.hasBand && (await openPane($)).isPlaced) {
      void improve($, text)
      return { text: t.ready }
    }
    const done = await improve($, text)
    return { text: `${ses.hasBand ? t.narrow : t.ready}\n\n${done.text}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const tree = e.surface === 'vscode' || e.surface === 'mobile' ? await bandVscode($, e) : await bandTerminal($, e)
    return tree ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    e.surface === 'vscode' || e.surface === 'mobile' ? paneVscode($, e) : paneTerminal($, e))
}
