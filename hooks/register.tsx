import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Proposal } from '../types'
import {
  assess, buildPrompt, describeMissing, isRepairable, keepAttachments, langOf, recentContext, repairPrompt,
  rewritePrompt, SYSTEMS, unfence, WEAK_BELOW,
} from '../core/rubric.ts'
import type { Lang } from '../core/rubric.ts'

const PANE = 'prompt-coach'
const MAX_DRAFT = 8000

const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, {
  shape: 'proposal-2',
})

// ---------- textos de la interfaz ----------

const UI = {
  es: {
    weak: 'Prompt flojo', solid: 'Prompt sólido', improve: 'Mejorar prompt', refine: 'Afinar',
    hint: '/coach para mejorarlo', busy: 'Mejorando con el modelo…', proposal: 'Propuesta',
    fromModel: 'modelo', fromLocal: 'reglas locales', added: 'Añade', apply: 'Sustituir borrador',
    applied: 'Borrador sustituido', undo: 'Deshacer', again: 'Mejorar de nuevo', copy: 'Copiar',
    cancel: 'Cancelar', send: 'Enviar propuesta', sendOriginal: 'Enviar original', copied: 'Propuesta copiada', notCopied: 'No se pudo copiar',
    held: 'Retenido, no se ha enviado. En el panel: Enviar propuesta, Enviar original, Mejorar de nuevo o Cancelar.',
    notFilled: 'No se pudo escribir en el borrador', ready: 'Prompt Coach: propuesta lista en el panel.',
    empty: 'Escribe primero un borrador, o pásalo como argumento: /coach <petición>',
    idle: 'Prompt Coach: escribe un borrador y pulsa «Mejorar prompt» o /coach',
    tooLong: 'El borrador supera los 8000 caracteres.',
    noModel: 'El modelo no respondió', emptyReply: 'El modelo devolvió una respuesta vacía',
    timeout: 'El modelo tardó demasiado (30 s)',
    toFull: 'Falta para 100',
  },
  en: {
    weak: 'Weak prompt', solid: 'Solid prompt', improve: 'Improve prompt', refine: 'Refine',
    hint: '/coach to improve it', busy: 'Improving with the model…', proposal: 'Proposal',
    fromModel: 'model', fromLocal: 'local rules', added: 'Adds', apply: 'Replace draft',
    applied: 'Draft replaced', undo: 'Undo', again: 'Improve again', copy: 'Copy',
    cancel: 'Cancel', send: 'Send proposal', sendOriginal: 'Send original', copied: 'Proposal copied', notCopied: 'Could not copy',
    held: 'Held, not sent. In the pane: Send proposal, Send original, Improve again or Cancel.',
    notFilled: 'Could not write the draft', ready: 'Prompt Coach: proposal ready in the pane.',
    empty: 'Type a draft first, or pass it as an argument: /coach <request>',
    idle: 'Prompt Coach: type a draft and press "Improve prompt" or /coach',
    tooLong: 'The draft exceeds 8000 characters.',
    noModel: 'The model did not answer', emptyReply: 'The model returned an empty reply',
    timeout: 'The model took too long (30 s)',
    toFull: 'Missing for 100',
  },
} as const

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
// Última propuesta calculada, para devolverla como salida del comando donde no hay banda.
let improved = ''
let improvedScore = 0

// True en terminal y escritorio, donde la banda sobre el prompt dibuja la puntuación y el botón.
// Sin banda (VS Code, móvil) el panel se abre al arrancar y hace de banda.
let hasBand = false

// Haiku: en bench/ da casi la misma nota y utilidad que Sonnet a 1/16 del coste (README, Benchmark).
const MODEL = 'haiku'

async function improve($: EngineInterface, text: string) {
  const lang = langOf(text)
  const cwd = await $.session.cwd()
  const before = assess(text, { cwd, lang }).score
  edited = null
  await update($, proposal, () => ({
    original: text, text: '', lang, before, after: before, origin: 'local' as const, changes: [], missing: [], passes: 0, isBusy: true, isApplied: false,
  }))
  await $.ui.open({ id: PANE, title: 'Prompt Coach', focus: true, closeOnEscape: true, rows: 24 }).catch(() => undefined)

  const context = recentContext(await $.session.messages(), lang)
  // Lo que el agente ya sabe: una ruta de la propuesta solo puntúa si sale de aquí.
  const known = [text, context].join('\n')
  const opts = { lang, cwd, context }
  const ask = (prompt: string) => $.model.complete({
    model: MODEL, system: SYSTEMS[lang], prompt, maxTokens: 900, effort: 'low', timeoutMs: 30_000,
  })

  const r = await ask(rewritePrompt(text, opts))
  let best = r.isAnswered ? keepAttachments(text, unfence(r.text)) : ''
  let passes = r.isAnswered ? 1 : 0
  let tokens = r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens + r.usage.output_tokens
  // Segunda pasada dirigida: solo si quedan criterios que el modelo puede cubrir sin inventar datos.
  if (best) {
    const a = assess(best, { known, cwd, lang })
    if (a.score < 100 && isRepairable(a)) {
      const r2 = await ask(repairPrompt(text, best, a, opts))
      tokens += r2.usage.input_tokens + r2.usage.cache_read_input_tokens + r2.usage.cache_creation_input_tokens + r2.usage.output_tokens
      if (r2.isAnswered) {
        passes = 2
        const second = keepAttachments(text, unfence(r2.text))
        if (assess(second, { known, cwd, lang }).score > a.score) best = second
      }
    }
  }
  const local = best ? null : buildPrompt(text, cwd)
  const out = best || keepAttachments(text, local!.prompt)
  const after = assess(out, { known, cwd, lang })
  improved = out
  improvedScore = after.score
  await update($, proposal, p =>
    p && p.original === text
      ? {
          ...p,
          text: out,
          after: after.score,
          missing: describeMissing(after, lang),
          passes,
          tokens: passes ? tokens : undefined,
          origin: best ? ('model' as const) : ('local' as const),
          model: best ? MODEL : undefined,
          note: best ? undefined : failureNote(r, lang),
          changes: local ? local.changes : [],
          isBusy: false,
        }
      : p,
  )
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
  await $.prompt.fill({ text: '' }).catch(() => undefined)
  await dismiss($)
  await $.prompt.submit({ text })
}

// VS Code: el compositor de la extensión no manda teclas, así que el botón lee el borrador al pulsarlo.
async function improveFromBox($: EngineInterface) {
  const text = (await $.prompt.read()).text.trim()
  const t = UI[langOf(text)]
  if (!isCoachable(text)) return $.ui.toast(t.empty)
  if (text.length > MAX_DRAFT) return $.ui.toast(t.tooLong)
  await improve($, text)
}

async function dismiss($: EngineInterface) {
  edited = null
  await update($, proposal, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// Lo que hay en el compositor: teclear llega por prompt.edit, lo demás (historial, fill, clear) por prompt.change.
async function onDraft($: EngineInterface, text: string, isOwnFill: boolean) {
  await update($, draft, () => text)
  if (!isOwnFill && (await read($, proposal))) void dismiss($)
  if (hasBand) return
  if (!isCoachable(text)) return $.ui.status(undefined)
  const a = assess(text)
  const t = UI[langOf(text)]
  $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100 · ${t.hint}`)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    hasBand = e.surface === 'terminal' || e.surface === 'desktop'
    await $.command.register({
      name: 'coach',
      description: 'Prompt Coach: mejora el borrador del prompt con el modelo (o con reglas locales)',
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
    if (hasBand || e.command || e.isMeta || e.attachments?.length) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'sdk') return next(e)
    const text = e.text.trim()
    if (!isCoachable(text)) return next(e)
    const a = assess(text)
    const t = UI[langOf(text)]
    if (!a.weak || a.intent === 'ask' || a.words < 3) {
      $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100`)
      return next(e)
    }
    await improve($, text)
    return { drop: `Prompt Coach: ${t.weak} ${a.score}/100 → ${improvedScore}/100. ${t.held}\n\n${improved}` }
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const typed = e.args.trim()
    const text = (typed || (await $.prompt.read()).text).trim()
    const t = UI[langOf(text)]
    if (!isCoachable(text)) return { text: t.empty }
    if (text.length > MAX_DRAFT) return { text: t.tooLong }
    if (hasBand) {
      void improve($, text)
      return { text: t.ready }
    }
    await improve($, text)
    return { text: `${t.ready}\n\n${improved}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      startPoll($)
      const cols = e.props.bodyColumns
      if (e.props.hasSurvey) return next(e)
      if (await read($, proposal)) return next(e)
      const text = await read($, draft)
      if (!isCoachable(text)) return next(e)
      const a = assess(text)
      const t = UI[langOf(text)]
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
    const why = e.props.hasSurvey ? 'pass:survey' : !isCoachable(text) ? 'pass:empty' : 'draw'
    if (why !== 'draw') return next(e)
    const a = assess(text)
    const t = UI[langOf(text)]
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text color={a.weak ? 'warning' : 'success'}>{a.weak ? t.weak : t.solid}</Text>
        <Text dimColor>{a.score}/100</Text>
        <Button
          key="improve"
          label={a.weak ? t.improve : t.refine}
          hotkey="m"
          variant={a.weak ? 'primary' : 'secondary'}
          onPress={async () => improve($, (await $.prompt.read()).text.trim())}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await read($, proposal)
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      const { Box, Button, Text } = $.ui.resolve(e)
      if (!p) return <Text dimColor>{UI.es.idle}</Text>
      const t = UI[p.lang]
      if (p.isBusy) return <Text dimColor>{t.busy}</Text>
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
            <Button key="cancel" label={t.cancel} onPress={() => dismiss($)} />
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
      if (!isCoachable(text)) return <Text dimColor>{UI.es.idle}</Text>
      const a = assess(text)
      const t = UI[langOf(text)]
      return (
        <Box gap={1}>
          <Text color={a.weak ? 'warning' : 'success'}>{a.weak ? t.weak : t.solid}</Text>
          <Text dimColor>{a.score}/100</Text>
          <Button
            key="improve"
            label={a.weak ? t.improve : t.refine}
            hotkey="m"
            variant={a.weak ? 'primary' : 'secondary'}
            onPress={async () => improve($, (await $.prompt.read()).text.trim())}
          />
        </Box>
      )
    }
    const t = UI[p.lang]
    if (p.isBusy) return <Text dimColor>{t.busy}</Text>
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Text bold>{t.proposal}</Text>
          <Text dimColor>{p.before}/100 → {p.after}/100</Text>
          <Text color={p.origin === 'model' ? 'success' : 'warning'}>
            {p.origin === 'model' ? `${t.fromModel}: ${p.model}` : t.fromLocal}
          </Text>
        </Box>
        {p.note !== undefined && <Text color="warning">{p.note}</Text>}
        {p.changes.length > 0 && <Text dimColor>{t.added}: {p.changes.join(', ')}</Text>}
        {p.missing.length > 0 && <Text dimColor>{t.toFull}: {p.missing.join('; ')}</Text>}
        <Input
          key="proposal"
          value={p.text}
          rows={14}
          submitLabel={t.apply}
          onInput={value => { edited = value }}
          onSubmit={value => apply($, value)}
        />
        <Box gap={1}>
          {p.isApplied ? (
            <Text color="success">{t.applied}</Text>
          ) : (
            <Button key="apply" label={t.apply} hotkey="s" variant="primary" onPress={() => apply($)} />
          )}
          {p.isApplied && <Button key="undo" label={t.undo} hotkey="d" onPress={() => undo($)} />}
          {p.isApplied && <Button key="again" label={t.again} hotkey="m" onPress={() => improve($, edited ?? p.text)} />}
          <Button
            key="copy"
            label={t.copy}
            hotkey="c"
            onPress={async press => {
              const copied = await $.ui.copy({ text: edited ?? p.text, surface: press.surface })
              $.ui.toast(copied.isCopied ? t.copied : t.notCopied)
            }}
          />
          <Button key="cancel" label={t.cancel} hotkey="x" onPress={() => dismiss($)} />
        </Box>
      </Box>
    )
  })
}
