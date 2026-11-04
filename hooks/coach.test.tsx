import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const ORIGIN = { kind: 'person' } as const

const PANE = {
  plugin: 'prompt-coach',
  component: 'Pane',
  requestId: 'prompt-coach',
  props: { title: 'Prompt Coach', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const asked: string[] = []
const opened: string[] = []
const statuses: (string | undefined)[] = []
const submitted: string[] = []
let box = 'arregla el login'
let placed = true

function engine(on: Parameters<Parameters<typeof test>[1]>[1], model: unknown, fills: string[] = [], rows: { role: 'user' | 'assistant'; text: string; toolUses: never[] }[] = []) {
  on('session.messages', () => ({ value: rows }))
  on('session.id', () => ({ value: 'test-session' }))
  on('ui.status', (_, e) => { statuses.push(e.text); return { value: undefined } })
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'coach' } }))
  on('ui.open', (_, e) => { opened.push(e.id); return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } } })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/demo-app' }))
  on('session.model', () => ({ value: 'opus' }))
  on('model.complete', (_, e) => { asked.push(String(e.prompt)); return { value: typeof model === 'function' ? model(String(e.prompt)) : model } })
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => { submitted.push(e.text); return { text: e.text } })
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.fill', (_, e) => { fills.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
}

const BAND = {
  plugin: 'prompt-coach',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 48, scroll: { offset: 0, bodyRows: 12 } },
} as const

test('on vscode the band follows the composer by polling: nothing when empty or while a proposal is open, score with a primary button when weak, score with a secondary Refine button when solid; the terminal band is untouched', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })
  const clock = mock.clock(on)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  opened.length = 0
  box = ''
  const at = (bodyColumns: number) => $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface: 'vscode' })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  let ui = await at(48)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'improve' })).toBeUndefined()

  box = 'arregla el login'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: '5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Prompt flojo' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'improve' })).toBeDefined()
  await ui.unmount()

  ui = await at(30)
  expect(await ui.find({ type: 'Text', text: '5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Prompt flojo' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'improve' })).toBeDefined()
  await ui.unmount()

  ui = await at(80)
  box = SOLID
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: 'Prompt sólido' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'improve' }))?.text).toBe('Afinar')

  box = 'arregla el login'
  await clock.advance(1000)
  await ui.press({ plugin: 'prompt-coach', key: 'improve' })
  expect(opened).toContain('prompt-coach')
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'improve' })).toBeUndefined()
  await ui.unmount()

  await $.prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Button', key: 'improve' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await term.unmount()
})

test('a weak draft shows its score in the status line on vscode', async ($, on) => {
  engine(on, { isAnswered: false, reason: 'empty-reply', usage: USAGE })
  statuses.length = 0

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'arregla el logi', cursor: 15, start: 15, end: 15, inputText: 'n' })
  expect(statuses.at(-1)).toMatch(/Prompt flojo \d+\/100/)

  await $.prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  expect(statuses.at(-1)).toBeUndefined()
})

test('/coach falls back to the local engine and Replace fills the draft', async ($, on) => {
  const fills: string[] = []
  engine(on, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, fills)

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: '', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/Prompt Coach/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /reglas locales/ }))?.text).toBe('reglas locales')
  expect((await ui.find({ type: 'Text', text: /overloaded/ }))?.text).toMatch(/529/)
  const field = await ui.find({ type: 'Input', key: 'proposal' })
  expect(String(field?.props.value)).toMatch(/^Contexto\n- Proyecto: demo-app/)
  expect(String(field?.props.value)).toMatch(/Qué necesito\n1\. Localiza la causa raíz/)

  await ui.press({ plugin: 'prompt-coach', key: 'apply' })
  expect(fills.at(-1)).toMatch(/^Contexto/)
  expect((await ui.find({ type: 'Text', text: /Borrador sustituido/ }))?.text).toBe('Borrador sustituido')
  await ui.unmount()
})

test('on vscode the command returns the whole proposal, the pane draws it as text lines and Send clears the composer', async ($, on) => {
  const fills: string[] = []
  engine(on, { isAnswered: true, text: '```\nObjetivo\nArregla el login.\n```', usage: USAGE }, fills, [
    { role: 'user', text: 'acabo de cambiar el hook de prompt.edit en register.tsx', toolUses: [] },
    { role: 'assistant', text: 'Hecho, tests 3/3.', toolUses: [] },
  ])

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toBe('Prompt Coach: propuesta lista en el panel.\n\nObjetivo\nArregla el login.')
  expect(asked.at(-2)).toMatch(/Conversación reciente[\s\S]*user: acabo de cambiar el hook de prompt.edit[\s\S]*Borrador a reescribir:\narregla el login$/)
  expect(asked.at(-1)).toMatch(/Tu versión anterior \(\d+\/100\)[\s\S]*Le falta:\n- objetivo/)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /modelo: haiku/ }))?.text).toBe('modelo: haiku')
  expect(await ui.find({ type: 'Input', key: 'proposal' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Objetivo$/ }))?.text).toBe('Objetivo')
  expect((await ui.find({ type: 'Text', text: /^Arregla el login\.$/ }))?.text).toBe('Arregla el login.')
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeDefined()

  await ui.press({ plugin: 'prompt-coach', key: 'send' })
  expect(submitted.at(-1)).toBe('Objetivo\nArregla el login.')
  expect(fills.at(-1)).toBe('')
  expect((await ui.find({ type: 'Text', text: /escribe un borrador/ }))?.text).toMatch(/escribe un borrador/)
  await ui.unmount()
})

test('an image chip the model dropped is put back at the end of the proposal', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login [Image #2]', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/\n\n\[Image #2\]$/)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /\[Image #2\]/ }))?.text).toBe('[Image #2]')
  await ui.unmount()
})

test('on the terminal the command answers at once and the pane keeps its editor', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toBe('Prompt Coach: propuesta lista en el panel.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(String((await ui.find({ type: 'Input', key: 'proposal' }))?.props.value)).toBe('Objetivo\nArregla el login.')
  expect(await ui.find({ type: 'Button', key: 'copy' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'send' })).toBeUndefined()
  await ui.unmount()
})

const SOLID = 'Revisa src/auth/login.ts: el login devuelve 500 al enviar el formulario; localiza la causa y añade un test que lo cubra.'

test('on vscode a weak work prompt is held with its proposal; solid or short ones pass; terminal never holds', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const held = await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'composer' }, wait: false })
  expect(held.drop).toMatch(/^Prompt Coach: Prompt flojo 5\/100 → \d+\/100\. Retenido[\s\S]*\n\nObjetivo\nArregla el login\.$/)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /^Arregla el login\.$/ }))?.text).toBe('Arregla el login.')
  expect(await ui.find({ type: 'Button', key: 'send-original' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'again' })).toBeDefined()
  await ui.unmount()

  expect((await $.prompt.submit({ text: SOLID, origin: { kind: 'composer' }, wait: false })).text).toBe(SOLID)
  expect((await $.prompt.submit({ text: 'ok', origin: { kind: 'composer' }, wait: false })).text).toBe('ok')
  expect((await $.prompt.submit({ text: 'que tal vamos', origin: { kind: 'composer' }, wait: false })).text).toBe('que tal vamos')
  expect((await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'plugin', name: 'prompt-coach' }, wait: false })).text).toBe('arregla el login')
})

test('on the terminal the same weak prompt is never held', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  expect((await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'composer' }, wait: false })).text).toBe('arregla el login')
})

// Propuesta que cubre la rúbrica entera con una ruta que sí está en la conversación.
const FULL = [
  'Objetivo:',
  'Arreglar que el login no muestre el error cuando la contraseña es incorrecta en `hooks/register.tsx`.',
  'Contexto:',
  '- Archivo: hooks/register.tsx, que se acaba de cambiar en el hook de prompt.edit.',
  'Detalle:',
  '- Actualmente la vista no cambia al fallar.',
  '- Esperado: aparece el mensaje "Contraseña incorrecta".',
  'Criterio de aceptación:',
  '- Un test con contraseña errónea encuentra el mensaje y la suite pasa.',
  'Restricciones:',
  '- No toques el flujo de registro.',
  '- Sin dependencias nuevas.',
  'Formato de respuesta:',
  '- Diff resumido por archivo y resultado de los tests.',
].join('\n')
const ROWS = [
  { role: 'user' as const, text: 'acabo de cambiar el hook de prompt.edit en hooks/register.tsx', toolUses: [] as never[] },
]

test('a weak first rewrite gets one targeted repair pass and the better version wins at a real 100', async ($, on) => {
  asked.length = 0
  engine(on, (prompt: string) => ({ isAnswered: true, text: /Tu versión anterior/.test(prompt) ? FULL : 'Objetivo\nArregla el login.', usage: USAGE }), [], ROWS)

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(asked.length).toBe(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: 'Criterio de aceptación:' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '100' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Falta para 100/ })).toBeUndefined()
  await ui.unmount()
})

test('a full first rewrite is not sent back for repair', async ($, on) => {
  asked.length = 0
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, [], ROWS)

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(asked.length).toBe(1)
})

test('a path the model invented does not count as context, and the pane says what is missing for 100', async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/Prompt Coach/)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Falta para 100/ }))?.text).toMatch(/contexto 8\/15 \(ruta o símbolo que no aparece/)
  await ui.unmount()
})

test('terminal and desktop adapt to the room: narrow band keeps score and button, short pane shrinks the editor and keeps every button', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ cwd: '/tmp/demo-app', surface, isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'arregla el logi', cursor: 15, start: 15, end: 15, inputText: 'n' })

    for (const [bodyColumns, label] of [[30, false], [80, true]] as const) {
      const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns }, surface })
      expect(await band.find({ type: 'Text', text: '5/100' })).toBeDefined()
      expect(Boolean(await band.find({ type: 'Text', text: 'Prompt flojo' }))).toBe(label)
      expect(await band.find({ type: 'Button', key: 'improve' })).toBeDefined()
      await band.unmount()
    }

    await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
    for (const [bodyColumns, bodyRows, editor] of [[30, 10, 3], [60, 18, 13], [120, 40, 14]] as const) {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns, scroll: { offset: 0, bodyRows } }, surface })
      expect((await ui.find({ type: 'Input', key: 'proposal' }))?.props.rows).toBe(editor)
      for (const key of ['apply', 'copy', 'cancel']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('on a terminal too narrow for the pane, /coach puts the proposal in its answer instead of promising a pane', async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })
  placed = false

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/demasiado estrecho para el panel[\s\S]*\n\nObjetivo\nArregla el login\.$/)
  placed = true
})

test('language: en draws the interface in English even for a Spanish draft; the proposal keeps the draft language', { options: { language: 'en' } }, async ($, on) => {
  engine(on, { isAnswered: true, text: 'Objetivo\nArregla el login.', usage: USAGE })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'arregla el logi', cursor: 15, start: 15, end: 15, inputText: 'n' })
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'Weak prompt' })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'improve' }))?.text).toBe('Improve prompt')
  await band.unmount()

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toBe('Prompt Coach: proposal ready in the pane.\n\nObjetivo\nArregla el login.')
  expect(asked.at(-2)).toMatch(/Borrador a reescribir:\narregla el login$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /Missing for 100/ }))?.text).toMatch(/goal 10\/20/)
  expect((await ui.find({ type: 'Button', key: 'send' }))?.text).toBe('Send proposal')
  await ui.unmount()
})

test('language: es draws the interface in Spanish for an English draft', { options: { language: 'es' } }, async ($, on) => {
  engine(on, { isAnswered: false, reason: 'empty-reply', usage: USAGE })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'fix the logi', cursor: 12, start: 12, end: 12, inputText: 'n' })
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'Prompt flojo' })).toBeDefined()
  await band.unmount()
})
