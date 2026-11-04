import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Proposal } from '../types'
import {
  assess, buildPrompt, describeMissing, isQuestion, isRepairable, keepAttachments, LANGS, langOf, recentContext, repairPrompt,
  rewritePrompt, systemPrompt, unfence, WEAK_BELOW,
} from '../core/rubric.ts'
import type { Lang, Verbosity } from '../core/rubric.ts'
import { UI } from './i18n.ts'

const PANE = 'prompt-coach'
const MAX_DRAFT = 8000

const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, {
  shape: 'proposal-2',
})


// Idioma de la interfaz: la opción `language` del plugin; en `auto`, el del borrador. La propuesta va
// siempre en el idioma del borrador, que es en el que la persona trabaja.
let uiSetting: 'auto' | Lang = 'auto'
// Modelo de la reescritura y longitud de la propuesta: opciones `model` y `verbosity` del plugin.
const MODELS = ['haiku', 'sonnet', 'opus'] as const
let model: string = 'haiku'
let verbosity: Verbosity = 'balanced'
const uiLang = (text: string): Lang => (uiSetting === 'auto' ? langOf(text) : uiSetting)
const ui = (text: string) => UI[uiLang(text)]

const isCoachable = (text: string) => text.trim().length > 0 && !text.trimStart().startsWith('/')

function failureNote(r: ModelCompleteResult, lang: Lang): string {
  const t = UI[lang]
  if (r.isAnswered) return t.emptyReply
  if (r.reason === 'api-error') return `${t.noModel} (${r.error}${r.status ? ' ' + r.status : ''})`
  if (r.reason === 'aborted') return t.timeout
  return t.emptyReply
}

// ---------- acciones ----------

// Lo que la persona teclea en el editor del panel; no es estado para no redibujar a cada tecla.
let edited: string | null = null
// True en terminal y escritorio, donde la banda sobre el prompt dibuja la puntuación y el botón.
// Sin banda (VS Code, móvil) el panel se abre al arrancar y hace de banda.
let hasBand = false
// Superficie de la sesión; null en `claude -p` y el SDK, donde nadie elige y no se retiene nada.
let surface: string | null = null
// Una mejora a la vez: la nueva o Cancelar cortan la anterior, que deja de escribir en el panel.
let run = 0
let stop: AbortController | null = null


const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Prompt Coach', focus: true, closeOnEscape: true, rows: 24 }).catch(() => ({ isPlaced: false as const }))

type Improved = { text: string; score: number }

async function improve($: EngineInterface, text: string): Promise<Improved> {
  const lang = langOf(text)
  const before = assess(text).score
  edited = null
  stop?.abort()
  const controller = new AbortController()
  stop = controller
  const id = ++run
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
    if (id === run) {
      await update($, proposal, p => (p && p.isBusy ? { ...p, text: p.original, isBusy: false, note: UI[p.lang].noModel } : p))
    }
  }
}

async function rewrite($: EngineInterface, text: string, lang: Lang, id: number, signal: AbortSignal): Promise<Improved> {
  const cwd = await $.session.cwd()

  const context = recentContext(await $.session.messages())
  // Lo que el agente ya sabe: una ruta de la propuesta solo puntúa si sale de aquí.
  const known = [text, context].join('\n')
  const opts = { cwd, context }
  const ask = (prompt: string) => $.model.complete({
    model, system: systemPrompt(lang, verbosity), prompt, maxTokens: 900, effort: 'low', timeoutMs: 30_000,
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
    p && id === run
      ? {
          ...p,
          text: out,
          after: after.score,
          missing: describeMissing(after, uiLang(text)),
          passes,
          tokens: passes ? tokens : undefined,
          origin: best ? ('model' as const) : ('local' as const),
          model: best ? model : undefined,
          note: best ? undefined : failureNote(r, uiLang(text)),
          changes: local ? local.changes : [],
          isBusy: false,
        }
      : p,
  )
  return { text: out, score: after.score }
}

async function apply($: EngineInterface, text?: string) {
  const p = await read($, proposal)
  if (!p || p.isBusy) return
  const final = text ?? edited ?? p.text
  const filled = await $.prompt.fill({ text: final })
  if (!filled.isFilled) return $.ui.toast(UI[p.lang].notFilled)
  await update($, proposal, q => (q ? { ...q, text: final, isApplied: true } : q))
}

async function undo($: EngineInterface) {
  const p = await read($, proposal)
  if (!p) return
  await $.prompt.fill({ text: p.original })
  await update($, proposal, q => (q ? { ...q, isApplied: false } : q))
}

// Descarta la propuesta. Donde hay banda (terminal, escritorio) el panel se abrió a demanda y se cierra;
// en VS Code el panel es fijo, con el botón, y solo vuelve al estado inicial.
const tone = (score: number) => (score < WEAK_BELOW ? 'warning' : 'success')

// Por debajo de este ancho la banda deja solo la nota y el botón.
const NARROW = 40

// Alto del editor del panel en terminal: lo que deja libre el resto, entre 3 y 14 filas, para que los botones
// no queden fuera de la vista en un terminal bajo o con el panel encima del prompt. En poco alto, sin huecos.
export function paneLayout(bodyRows: number, cols: number, lines: string[]) {
  const shown = lines.filter(Boolean)
  const gap = bodyRows < 20 ? 0 : 1
  const used = shown.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, cols))), 0) + gap * shown.length
  return { gap, rows: Math.max(3, Math.min(14, bodyRows - used)) }
}

// ponytail: sondeo del compositor cada segundo porque la extensión de VS Code no envía prompt.edit; quitar cuando lo envíe.
const POLL_MS = 1000
let isPolling = false
let lastPolled: string | null = null
async function pollComposer($: EngineInterface) {
  const box = await $.prompt.read().catch(() => null)
  if (!box || box.text === lastPolled) return
  lastPolled = box.text
  await update($, draft, () => box.text)
}
function startPoll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  $.clock.every(POLL_MS, () => { void pollComposer($) })
}

// $.prompt.submit no pasa por el compositor: se vacía antes para que no quede el borrador viejo.
async function sendAs($: EngineInterface, text: string) {
  const p = await read($, proposal)
  await $.prompt.fill({ text: '' }).catch(() => undefined)
  await dismiss($)
  const sent = await $.prompt.submit({ text })
  // Otro hook puede rechazar el envío: entonces el borrador de la persona vuelve al compositor.
  if (sent.drop !== undefined) await $.prompt.fill({ text: p?.original ?? text }).catch(() => undefined)
}

// VS Code: el compositor de la extensión no manda teclas, así que el botón lee el borrador al pulsarlo.
// También la banda y el panel vacío del terminal: misma validación y nunca dos mejoras a la vez.
async function improveFromBox($: EngineInterface) {
  if ((await read($, proposal))?.isBusy) return
  const text = (await $.prompt.read()).text.trim()
  const t = ui(text)
  if (!isCoachable(text)) return $.ui.toast(t.empty)
  if (text.length > MAX_DRAFT) return $.ui.toast(t.tooLong)
  await improve($, text)
}

async function dismiss($: EngineInterface, restore = false) {
  edited = null
  stop?.abort()
  run++
  const p = await read($, proposal)
  // Tras retener un Enter en VS Code el compositor puede quedar vacío: Cancelar no debe perder el borrador.
  if (restore && p && !hasBand && !(await $.prompt.read().catch(() => ({ text: '' }))).text.trim()) {
    await $.prompt.fill({ text: p.original }).catch(() => undefined)
  }
  await update($, proposal, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// Lo que hay en el compositor: teclear llega por prompt.edit, lo demás (historial, fill, clear) por prompt.change.
async function onDraft($: EngineInterface, text: string, isOwnFill: boolean) {
  await update($, draft, () => text)
  if (!isOwnFill && (await read($, proposal))) void dismiss($)
  if (hasBand) return
  if (!isCoachable(text) || isQuestion(text)) return $.ui.status(undefined)
  const a = assess(text)
  const t = ui(text)
  $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100 · ${t.hint}`)
}


// Mientras el modelo trabaja: el aviso y Cancelar, que corta la llamada.
function busyView($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], t: { busy: string; cancel: string }) {
  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexWrap="wrap" gap={1}>
      <Text dimColor>{t.busy}</Text>
      <Button key="cancel" label={t.cancel} onPress={() => dismiss($, true)} />
    </Box>
  )
}

export const register: Register = (on, options) => {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  uiSetting = pick(options.language, ['auto', ...LANGS] as const, 'auto')
  model = pick(options.model, MODELS, 'haiku')
  verbosity = pick(options.verbosity, ['concise', 'balanced', 'detailed'] as const, 'balanced')

  on('session.start', async ($, e, next) => {
    hasBand = e.surface === 'terminal' || e.surface === 'desktop'
    surface = e.surface
    await update($, proposal, p => (p && p.isBusy ? null : p))
    await $.command.register({
      name: 'coach',
      description: UI[uiSetting === 'auto' ? 'en' : uiSetting].command,
    })
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    await onDraft($, r.text, false)
    return r
  })

  on('prompt.change', async ($, e, next) => {
    await onDraft($, e.text, e.origin.kind === 'plugin' && e.origin.name === 'prompt-coach')
    return next(e)
  })

  // Sin banda (VS Code) el motor no ve las teclas: el único momento de ofrecer la mejora es el Enter.
  // Se retiene solo un prompt flojo con intención de trabajo (no preguntas ni respuestas cortas), sin adjuntos.
  on('prompt.submit', async ($, e, next) => {
    if ((surface !== 'vscode' && surface !== 'mobile') || e.command || e.isMeta || e.attachments?.length) return next(e)
    if (e.origin.kind !== 'composer') return next(e)
    const text = e.text.trim()
    if (!isCoachable(text) || isQuestion(text)) return next(e)
    const a = assess(text)
    const t = ui(text)
    if (!a.weak || a.intent === 'ask' || a.words < 3) {
      $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100`)
      return next(e)
    }
    const done = await improve($, text)
    return { drop: `Prompt Coach: ${t.weak} ${a.score}/100 → ${done.score}/100. ${t.held}\n\n${done.text}` }
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const typed = e.args.trim()
    const text = (typed || (await $.prompt.read()).text).trim()
    const t = ui(text)
    if (!isCoachable(text)) return { text: t.empty }
    if (text.length > MAX_DRAFT) return { text: t.tooLong }
    // Con panel colocado, el comando responde al momento y la propuesta llega al panel. Si el terminal es
    // demasiado estrecho para colocarlo, la propuesta va en la respuesta del comando.
    if (hasBand && (await openPane($)).isPlaced) {
      void improve($, text)
      return { text: t.ready }
    }
    const done = await improve($, text)
    return { text: `${hasBand ? t.narrow : t.ready}\n\n${done.text}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      startPoll($)
      const cols = e.props.bodyColumns
      if (e.props.hasSurvey) return next(e)
      if (await read($, proposal)) return next(e)
      const text = await read($, draft)
      if (!isCoachable(text) || isQuestion(text)) return next(e)
      const a = assess(text)
      const t = ui(text)
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexWrap="wrap" alignItems="center" gap={1}>
          <Text tabular>
            <Text color={tone(a.score)} weight="semibold">{a.score}</Text>
            <Text dimColor>/100</Text>
          </Text>
          {cols >= 40 && <Text color={tone(a.score)}>{a.weak ? t.weak : t.solid}</Text>}
          <Button
            key="improve"
            label={a.weak ? t.improve : t.refine}
            variant={a.weak ? 'primary' : 'secondary'}
            dimColor={!a.weak}
            onPress={() => improveFromBox($)}
          />
        </Box>
      )
    }
    const text = await read($, draft)
    const why = e.props.hasSurvey ? 'pass:survey' : !isCoachable(text) || isQuestion(text) ? 'pass:empty' : 'draw'
    if (why !== 'draw') return next(e)
    const a = assess(text)
    const t = ui(text)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexWrap="wrap" gap={1}>
        {e.props.bodyColumns >= NARROW && <Text color={tone(a.score)}>{a.weak ? t.weak : t.solid}</Text>}
        <Text color={e.props.bodyColumns >= NARROW ? undefined : tone(a.score)} dimColor={e.props.bodyColumns >= NARROW}>{a.score}/100</Text>
        <Button
          key="improve"
          label={a.weak ? t.improve : t.refine}
          hotkey="m"
          variant={a.weak ? 'primary' : 'secondary'}
          onPress={() => improveFromBox($)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await read($, proposal)
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      const { Box, Button, Text } = $.ui.resolve(e)
      if (!p) return <Text dimColor>{ui('').idle}</Text>
      const t = UI[p.lang]
      if (p.isBusy) return busyView($, e, t)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexWrap="wrap" gap={1}>
            <Text weight="semibold">{t.proposal}</Text>
            <Text tabular>
              <Text color={tone(p.before)} weight="semibold">{p.before}</Text>
              <Text dimColor> → </Text>
              <Text color={tone(p.after)} weight="semibold">{p.after}</Text>
              <Text dimColor>/100</Text>
            </Text>
            <Text dimColor>{p.origin === 'model' ? `${t.fromModel}: ${p.model}` : t.fromLocal}</Text>
          </Box>
          {p.note !== undefined && <Text color="warning">{p.note}</Text>}
          {p.missing.length > 0 && <Text dimColor>{t.toFull}: {p.missing.join('; ')}</Text>}
          <Box flexWrap="wrap" gap={1}>
            <Button key="send" label={t.send} variant="primary" onPress={() => sendAs($, p.text)} />
            {p.isApplied ? (
              <Button key="undo" label={t.undo} onPress={() => undo($)} />
            ) : (
              <Button key="apply" label={t.apply} onPress={() => apply($)} />
            )}
            <Button key="again" label={t.again} onPress={() => improve($, p.original)} />
            <Button key="send-original" label={t.sendOriginal} onPress={() => sendAs($, p.original)} />
            <Button key="cancel" label={t.cancel} onPress={() => dismiss($, true)} />
          </Box>
          {p.isApplied && <Text color="success" size="caption">{t.applied}</Text>}
          <Box flexDirection="column">
            {p.text.split('\n').map((line, i) => <Text key={`l${i}`}>{line || ' '}</Text>)}
          </Box>
        </Box>
      )
    }
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    if (!p) {
      const text = await read($, draft)
      if (!isCoachable(text)) return <Text dimColor>{ui('').idle}</Text>
      const a = assess(text)
      const t = ui(text)
      return (
        <Box flexWrap="wrap" gap={1}>
          <Text color={tone(a.score)}>{a.weak ? t.weak : t.solid}</Text>
          <Text dimColor>{a.score}/100</Text>
          <Button
            key="improve"
            label={a.weak ? t.improve : t.refine}
            hotkey="m"
            variant={a.weak ? 'primary' : 'secondary'}
            onPress={() => improveFromBox($)}
          />
        </Box>
      )
    }
    const t = UI[p.lang]
    if (p.isBusy) return busyView($, e, t)
    const cols = e.props.bodyColumns
    // Poco alto: botones encima del editor, para que no queden fuera de la vista. Poco ancho o alto: lo que
    // falta, sin el motivo de cada criterio.
    const short = e.props.scroll.bodyRows < 20
    const reasons = cols >= 60 && !short
    const missing = p.missing.length > 0 ? `${t.toFull}: ${p.missing.map(m => (reasons ? m : m.replace(/ \(.*\)$/, ''))).join('; ')}` : ''
    const changes = p.changes.length > 0 ? `${t.added}: ${p.changes.join(', ')}` : ''
    const labels = p.isApplied ? [t.applied, t.undo, t.again, t.copy, t.cancel] : [t.apply, t.copy, t.cancel]
    const { gap, rows } = paneLayout(e.props.scroll.bodyRows, cols, [
      `${t.proposal} ${p.before}/100 → ${p.after}/100 ${t.fromModel}: ${p.model ?? ''}`, p.note ?? '', changes, missing,
      labels.map(l => `[ ${l} (x) ]`).join(' '),
    ])
    const actions = (
      <Box flexWrap="wrap" gap={1}>
        {p.isApplied ? (
          <Text color="success">{t.applied}</Text>
        ) : (
          <Button key="apply" label={t.apply} hotkey="s" variant="primary" onPress={() => apply($)} />
        )}
        {p.isApplied && <Button key="undo" label={t.undo} hotkey="d" onPress={() => undo($)} />}
        {p.isApplied && <Button key="again" label={t.again} hotkey="m" onPress={() => improve($, p.original)} />}
        <Button
          key="copy"
          label={t.copy}
          hotkey="c"
          onPress={async press => {
            const copied = await $.ui.copy({ text: edited ?? p.text, surface: press.surface })
            $.ui.toast(copied.isCopied ? t.copied : t.notCopied)
          }}
        />
        <Button key="cancel" label={t.cancel} hotkey="x" onPress={() => dismiss($, true)} />
      </Box>
    )
    return (
      <Box flexDirection="column" gap={gap}>
        <Box flexWrap="wrap" gap={1}>
          <Text bold>{t.proposal}</Text>
          <Text dimColor>{p.before}/100 → {p.after}/100</Text>
          <Text color={p.origin === 'model' ? 'success' : 'warning'}>
            {p.origin === 'model' ? `${t.fromModel}: ${p.model}` : t.fromLocal}
          </Text>
        </Box>
        {p.note !== undefined && <Text color="warning">{p.note}</Text>}
        {changes !== '' && <Text dimColor>{changes}</Text>}
        {missing !== '' && <Text dimColor>{missing}</Text>}
        {short && actions}
        <Input
          key="proposal"
          value={p.text}
          rows={rows}
          submitLabel={t.apply}
          onInput={value => { edited = value }}
          onSubmit={value => apply($, value)}
        />
        {!short && actions}
      </Box>
    )
  })
}
