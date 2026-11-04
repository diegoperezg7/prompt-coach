// Dibujo: banda sobre el compositor y panel de la propuesta, para terminal y escritorio y para VS Code y móvil.
// Cada función devuelve el árbol, o null cuando la banda tiene que dejar pasar al motor.
import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import { assess, isQuestion } from '../core/rubric.ts'
import { addFact, apply, dismiss, improve, improveFromBox, pasteHint, sendAs, startPoll, undo } from './actions.ts'
import { hasPasteChip } from '../core/pastes.ts'
import { UI } from './i18n.ts'
import { usageLine } from './usage.ts'
import { gapHint, HINT_COLS, isCoachable, NARROW, paneLayout, ses, tone, ui } from './state.ts'

// El motor exige que cada fichero declare las referencias de $.state que lee o escribe; actions.ts y
// views.tsx declaran las mismas (misma clave y misma forma).
const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, { shape: 'proposal-4' })

type BandEvent = RenderInput<'AbovePrompt'>
type PaneEvent = RenderInput<'Pane'>

// Mientras el modelo trabaja: el aviso y Cancelar, que corta la llamada.
function busyView($: EngineInterface, e: PaneEvent, t: { busy: string; cancel: string }) {
  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexWrap="wrap" gap={1}>
      <Text dimColor>{t.busy}</Text>
      <Button key="cancel" label={t.cancel} onPress={() => dismiss($, true)} />
    </Box>
  )
}

export async function bandVscode($: EngineInterface, e: BandEvent) {
  startPoll($)
  const cols = e.props.bodyColumns
  if (e.props.hasSurvey) return null
  if (await read($, proposal)) return null
  const text = await read($, draft)
  if (!isCoachable(text) || isQuestion(text)) return null
  if (hasPasteChip(text)) {
    const { Text } = $.ui.resolve(e)
    return <Text key="paste" dimColor>{pasteHint(text)}</Text>
  }
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
      {cols >= HINT_COLS && gapHint(text, a) !== '' && <Text key="gap" dimColor>{gapHint(text, a)}</Text>}
    </Box>
  )
}

export async function bandTerminal($: EngineInterface, e: BandEvent) {
  const text = await read($, draft)
  if (e.props.hasSurvey || !isCoachable(text) || isQuestion(text)) return null
  if (hasPasteChip(text)) {
    const { Text } = $.ui.resolve(e)
    return <Text key="paste" dimColor>{pasteHint(text)}</Text>
  }
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
      {e.props.bodyColumns >= HINT_COLS && gapHint(text, a) !== '' && <Text key="gap" dimColor>{gapHint(text, a)}</Text>}
    </Box>
  )
}

export async function paneVscode($: EngineInterface, e: PaneEvent) {
  const p = await read($, proposal)
  const { Box, Button, Input, Text } = $.ui.resolve(e)
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
      {p.usage !== undefined && <Text key="usage" dimColor>{usageLine(p.usage, p.model ?? '', p.lang)}</Text>}
      {p.note !== undefined && <Text color="warning">{p.note}</Text>}
      {p.missing.length > 0 && <Text dimColor>{t.toFull}: {p.missing.join('; ')}</Text>}
      {p.ask !== undefined && (
        <Input key="fact" placeholder={p.ask === 'contexto' ? t.askContexto : t.askDetalle} submitLabel={t.addFact} onSubmit={value => addFact($, value)} />
      )}
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

export async function paneTerminal($: EngineInterface, e: PaneEvent) {
  const p = await read($, proposal)
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
  const usage = p.usage !== undefined ? usageLine(p.usage, p.model ?? '', p.lang) : ''
  const labels = [...(p.held ? [t.send, t.sendOriginal] : []), ...(p.isApplied ? [t.applied, t.undo, t.again, t.copy, t.cancel] : [t.apply, t.copy, t.cancel])]
  const { gap, rows } = paneLayout(e.props.scroll.bodyRows, cols, [
    `${t.proposal} ${p.before}/100 → ${p.after}/100 ${t.fromModel}: ${p.model ?? ''}`, usage, p.note ?? '', changes, missing,
    labels.map(l => `[ ${l} (x) ]`).join(' '),
    p.ask !== undefined ? t.askContexto : '',
  ])
  const actions = (
    <Box flexWrap="wrap" gap={1}>
      {p.held && <Button key="send" label={t.send} hotkey="e" variant="primary" onPress={() => sendAs($, ses.edited ?? p.text)} />}
      {p.held && <Button key="send-original" label={t.sendOriginal} hotkey="o" onPress={() => sendAs($, p.original)} />}
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
          const copied = await $.ui.copy({ text: ses.edited ?? p.text, surface: press.surface })
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
      {usage !== '' && <Text key="usage" dimColor>{usage}</Text>}
      {p.note !== undefined && <Text color="warning">{p.note}</Text>}
      {changes !== '' && <Text dimColor>{changes}</Text>}
      {missing !== '' && <Text dimColor>{missing}</Text>}
      {p.ask !== undefined && (
        <Input key="fact" placeholder={p.ask === 'contexto' ? t.askContexto : t.askDetalle} submitLabel={t.addFact} onSubmit={value => addFact($, value)} />
      )}
      {short && actions}
      <Input
        key="proposal"
        value={p.text}
        rows={rows}
        submitLabel={t.apply}
        onInput={value => { ses.edited = value }}
        onSubmit={value => apply($, value)}
      />
      {!short && actions}
    </Box>
  )
}
