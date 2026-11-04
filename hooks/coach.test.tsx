import { expect, mock, test } from 'claude-code/testing'
import { callCost } from '../core/pricing.ts'
import { assess } from '../core/rubric.ts'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const ORIGIN = { kind: 'person' } as const

const PANE = {
  plugin: 'prompt-coach',
  component: 'Pane',
  requestId: 'prompt-coach',
  props: { title: 'Prompt Coach', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const asked: string[] = []
const systems: string[] = []
const models: string[] = []
const opened: string[] = []
const statuses: (string | undefined)[] = []
const submitted: string[] = []
let box = 'arregla el login'
let placed = true
let submitDrop = false

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
  on('model.complete', (_, e) => { asked.push(String(e.prompt)); systems.push(String(e.system)); models.push(e.model); return { value: typeof model === 'function' ? model(String(e.prompt)) : model } })
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('prompt.submit', (_, e) => { submitted.push(e.text); return submitDrop ? { drop: 'blocked by a settings hook' } : { text: e.text } })
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
  expect(asked.at(-2)).toMatch(/Recent conversation[\s\S]*user: acabo de cambiar el hook de prompt.edit[\s\S]*Draft to rewrite:\narregla el login$/)
  expect(asked.at(-1)).toMatch(/Your previous version \(\d+\/100\)[\s\S]*It is missing:\n- goal/)
  expect(systems.at(-1)).toMatch(/language of the draft\. It looks like Spanish[\s\S]*Objetivo:, Contexto:/)

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
  engine(on, (prompt: string) => ({ isAnswered: true, text: /Your previous version/.test(prompt) ? FULL : 'Objetivo\nArregla el login.', usage: USAGE }), [], ROWS)

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
    for (const [bodyColumns, bodyRows, editor] of [[30, 10, 3], [60, 18, 10], [120, 40, 14]] as const) {
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
  expect(asked.at(-2)).toMatch(/Draft to rewrite:\narregla el login$/)
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

test('a status code the draft "returns" is not a response format, in either language', async () => {
  const es = assess('arregla el login de src/auth/login.ts: al enviar el formulario devuelve 500 en vez de entrar. Añade un test que lo cubra y no toques el registro')
  const en = assess("fix the login in src/auth/login.ts: submitting the form returns 500 instead of signing in. Add a test that covers it and don't touch signup")
  expect(es.criteria.find(c => c.id === 'formato')?.points).toBe(0)
  expect(en.criteria.find(c => c.id === 'formato')?.points).toBe(0)
  expect(es.score).toBe(en.score)
  expect(assess('Formato de respuesta: diff resumido por archivo.').criteria.find(c => c.id === 'formato')?.points).toBe(10)
})

test('model and verbosity options reach the rewrite: opus, concise', { options: { model: 'opus', verbosity: 'concise' } }, async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, [], ROWS)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(models.at(-1)).toBe('opus')
  expect(systems.at(-1)).toMatch(/At most 110 words in total/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /modelo: opus/ })).toBeDefined()
  await ui.unmount()
})

test('defaults: haiku and balanced length; an unknown stored value falls back to the default', { options: { model: 'gpt-9', verbosity: 'chatty' } }, async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, [], ROWS)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(models.at(-1)).toBe('haiku')
  expect(systems.at(-1)).toMatch(/At most 220 words/)
})

test('a French draft gets a French interface on auto, a French rewrite and a fair score', async ($, on) => {
  const FR = [
    'Objectif :', '- Corriger la connexion dans src/auth/login.ts qui renvoie une erreur 500 au lieu de connecter.',
    'Contexte :', '- Fichier : src/auth/login.ts.',
    'Détail :', "- Actuellement la page renvoie 500 ; attendu : l'utilisateur est connecté.",
    "Critères d'acceptation :", '- Un test avec des identifiants valides passe et la suite est verte.',
    'Contraintes :', "- Ne touche pas à l'inscription.", '- Sans nouvelles dépendances.',
    'Format de réponse :', '- Diff résumé par fichier et résultat des tests.',
  ].join('\n')
  engine(on, { isAnswered: true, text: FR, usage: USAGE })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'corrige la connexion dans src/auth/login.ts qui renvoie une erreur 50', cursor: 69, start: 69, end: 69, inputText: '0' })
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await band.find({ type: 'Button', key: 'improve' })).toBeDefined()
  expect((await band.find({ type: 'Button', key: 'improve' }))?.text).toMatch(/Améliorer le prompt|Affiner/)
  await band.unmount()

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'corrige la connexion dans src/auth/login.ts qui renvoie une erreur 500', origin: ORIGIN, presentation: 'transcript' })
  expect(systems.at(-1)).toMatch(/It looks like French[\s\S]*Objectif:, Contexte:/)
  expect(assess(FR, { known: 'corrige la connexion dans src/auth/login.ts qui renvoie une erreur 500' }).score).toBe(100)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Button', key: 'send' }))?.text).toBe('Envoyer la proposition')
  await ui.unmount()
})

test('keyword stuffing without content scores weak; real negative imperatives count as constraints, bug descriptions do not', async () => {
  expect(assess('Objetivo: algo. Contexto: esto. Criterio de aceptación: test. Restricciones: solo, nunca. Formato: tabla.').weak).toBe(true)
  expect(assess('Goal: stuff. Acceptance criteria: test. Constraints: only, never. Format: table. Context: the thing.').weak).toBe(true)
  const limits = (t: string) => assess(t).criteria.find(c => c.id === 'restricciones')?.points
  expect(limits('Restricciones:\n- No modificar reconcile.py.\n- No añadir dependencias.')).toBe(15)
  expect(limits("Contraintes :\n- Ne pas changer les dépendances.\n- Ne toucher que la connexion.")).toBe(15)
  expect(limits('Vincoli:\n- Non modificare il codice di produzione.\n- Non aggiungere dipendenze.')).toBe(15)
  expect(limits('Einschränkungen:\n- Keine neuen Abhängigkeiten.\n- Ändere nur den Export.')).toBe(15)
  expect(limits('el login no funciona y la app no arranca desde ayer en el simulador')).toBe(0)
})

test('the band does not score a short question; /coach still improves it', async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, [], ROWS)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'what does useBudget.ts return when the list is empty', cursor: 52, start: 52, end: 52, inputText: '?' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Button', key: 'improve' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'what does useBudget.ts return when the list is empty?', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/proposal ready in the pane/)
})

test('an engine failure in the middle never leaves the pane busy: the draft comes back with a note', async ($, on) => {
  engine(on, () => { throw new Error('model blocked') })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const ran = await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/arregla el login$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Mejorando/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /El modelo no respondió/ })).toBeDefined()
  await ui.unmount()
})

test('claude -p and the SDK never hold a prompt: there is nobody to choose', async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  await $.session.start({ cwd: '/tmp/demo-app', surface: null, isInteractive: false })
  expect((await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'sdk' }, wait: false })).text).toBe('arregla el login')
  expect((await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'composer' }, wait: false })).text).toBe('arregla el login')
})

test('if sending the proposal is refused, the person gets the original draft back in the composer', async ($, on) => {
  const fills: string[] = []
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, fills, ROWS)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  submitDrop = true
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ plugin: 'prompt-coach', key: 'send' })
  submitDrop = false
  expect(fills.at(-1)).toBe('arregla el login')
  await ui.unmount()
})

test('the acceptance header alone scores nothing; checkable content under it does, in any language', async () => {
  const acc = (t: string) => assess(t).criteria.find(c => c.id === 'aceptacion')?.points
  expect(acc('Criterio de aceptación: sí. ' + 'palabra '.repeat(14))).toBe(0)
  expect(acc('Acceptance criteria: yes. ' + 'word '.repeat(14))).toBe(0)
  expect(acc('Arregla el login de src/auth/login.ts.\nCriterio de aceptación:\n- El login con credenciales válidas ya no devuelve 500.')).toBe(20)
  expect(acc("Corrige la connexion dans src/auth/login.ts.\nCritères d'acceptation :\n- La page affiche le tableau de bord après la connexion.")).toBe(20)
  expect(acc('Explica el pooler de Supabase del proyecto.\nCriterio de aceptación:\n- La explicación cita el archivo y la línea de la configuración.')).toBe(20)
  expect(acc('Fix the login in src/auth/login.ts, it is done when the dashboard loads after signing in')).toBe(20)
})

test('from 60 columns the band names the criterion that costs the most; narrower, it stays out', async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  const clock = mock.clock(on)
  for (const surface of ['terminal', 'vscode'] as const) {
    await $.session.start({ cwd: '/tmp/demo-app', surface, isInteractive: true })
    box = 'arregla el login'
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'arregla el logi', cursor: 15, start: 15, end: 15, inputText: 'n' })
    await clock.advance(1000)
    const wide = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface })
    expect((await wide.find({ type: 'Text', text: /^falta: / }))?.text).toBe('falta: objetivo')
    await wide.unmount()
    const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 50 }, surface })
    expect(await narrow.find({ type: 'Text', text: /^falta: / })).toBeUndefined()
    await narrow.unmount()
  }
})

test('on auto the interface keeps its language while the first words are ambiguous', async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'fix the logi', cursor: 12, start: 12, end: 12, inputText: 'n' })
  await $.prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'fi', cursor: 2, start: 2, end: 2, inputText: 'x' })
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 80 }, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'Weak prompt' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'Prompt flojo' })).toBeUndefined()
  await band.unmount()
})

test('with nothing typed, the pane speaks the last language used, remembered across sessions; English the very first time', async ($, on) => {
  const stored = new Map<string, unknown>()
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => { stored.set(e.key, e.value); return { value: undefined } })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Prompt Coach/ }))?.text).toMatch(/type a draft/)
  await ui.unmount()

  await $.prompt.edit({ origin: { kind: 'composer' }, text: 'corrige la connexion du formulair', cursor: 33, start: 33, end: 33, inputText: 'e' })
  expect(stored.get('lastLang')).toBe('fr')
  await $.prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Prompt Coach/ }))?.text).toMatch(/écrivez un brouillon/)
  await ui.unmount()
})

test('model: session rewrites with the session own model and the pane names it', { options: { model: 'session' } }, async ($, on) => {
  engine(on, { isAnswered: true, text: FULL, usage: USAGE }, [], ROWS)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(models.at(-1)).toBe('opus')
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /modelo: opus/ })).toBeDefined()
  await ui.unmount()
})

test('when context is missing the pane asks for it; the answer joins the draft and counts as verified', async ($, on) => {
  engine(on, (prompt: string) => ({ isAnswered: true, text: /src\/auth\/login\.ts/.test(prompt) ? FULL.replace(/hooks\/register\.tsx/g, 'src/auth/login.ts') : FULL, usage: USAGE }))
  for (const surface of ['terminal', 'vscode'] as const) {
    asked.length = 0
    await $.session.start({ cwd: '/tmp/demo-app', surface, isInteractive: true })
    await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Input', key: 'fact' }))?.props.placeholder).toMatch(/Qué archivo, ruta o símbolo/)
    await ui.input({ plugin: 'prompt-coach', key: 'fact', text: 'src/auth/login.ts' })
    expect(asked.some(a => /Draft to rewrite:\narregla el login\n\nsrc\/auth\/login\.ts/.test(a))).toBe(true)
    expect(await ui.find({ type: 'Input', key: 'fact' })).toBeUndefined()
    await ui.unmount()
  }
})

const RULES = '# Reglas\n- Nunca uses Tailwind.\n- El login vive en src/auth/login.ts.'
const readsRules = (on: Parameters<Parameters<typeof test>[1]>[1], reads: string[]) =>
  on('fs.read', (_, e) => { reads.push(String(e.path)); if (String(e.path).endsWith('/CLAUDE.md')) return { value: RULES }; throw new Error('ENOENT') })

test('projectRules (default on) sends CLAUDE.md to the rewrite and its paths count as known', async ($, on) => {
  const reads: string[] = []
  engine(on, { isAnswered: true, text: FULL.replace(/hooks\/register\.tsx/g, 'src/auth/login.ts'), usage: USAGE })
  readsRules(on, reads)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(reads).toEqual(['/tmp/demo-app/CLAUDE.md', '/tmp/demo-app/AGENTS.md'])
  expect(asked.at(-1)).toMatch(/Project rules \(from CLAUDE\.md;[\s\S]*Nunca uses Tailwind[\s\S]*Draft to rewrite:\narregla el login$/)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /Falta para 100/ })).toBeUndefined()
  await ui.unmount()
})

test('projectRules off reads nothing from the project', { options: { projectRules: false } }, async ($, on) => {
  const reads: string[] = []
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  readsRules(on, reads)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })
  expect(reads).toEqual([])
  expect(asked.at(-1)).not.toMatch(/Project rules/)
})

test('/coach stats compares this week with the previous one and names the most missed criterion; held prompts are not counted', async ($, on) => {
  const stored = new Map<string, unknown>()
  engine(on, { isAnswered: true, text: FULL, usage: USAGE })
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => { stored.set(e.key, e.value); return { value: undefined } })
  const clock = mock.clock(on)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'terminal', isInteractive: true })
  let ran = await $.command.run({ command: 'coach', args: 'stats', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/no hay prompts registrados|no prompts recorded/)

  await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'composer' }, wait: false })
  await clock.advance(8 * 24 * 60 * 60 * 1000)
  await $.prompt.submit({ text: SOLID, origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '/help', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '¿cómo funciona el pooler de supabase?', origin: { kind: 'composer' }, wait: false })
  ran = await $.command.run({ command: 'coach', args: 'stats', origin: ORIGIN, presentation: 'transcript' })
  expect(ran.text).toMatch(/This week: \d+\/100 \(1 prompts\) · previous week: 5\/100 \(1 prompts\), \+\d+\. Most missed criterion: /)

  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const held = await $.prompt.submit({ text: 'arregla el login', origin: { kind: 'composer' }, wait: false })
  expect(held.drop).toBeDefined()
  expect((stored.get('history') as unknown[]).length).toBe(2)
})

test('without a model, the local engine answers in the draft language in all six; its gaps are marked and penalised', async ($, on) => {
  const fills: string[] = []
  engine(on, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, fills)
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  const cases: [string, RegExp][] = [
    ['corrige la connexion du formulaire', /^Contexte\n[\s\S]*Objectif\n[\s\S]*À remplir :[\s\S]*Critères d’acceptation\n[\s\S]*Format de réponse\n/],
    ['behebe den Login mit dem Formular', /^Kontext\n[\s\S]*Ziel\n[\s\S]*Ausfüllen:[\s\S]*Akzeptanzkriterien\n[\s\S]*Antwortformat\n/],
    ['conserta o login do formulário que não funciona', /^Contexto\n[\s\S]*Objetivo\n[\s\S]*Preencha:[\s\S]*Critério de aceitação\n[\s\S]*Formato de resposta\n/],
    ['correggi il login del modulo che non funziona', /^Contesto\n[\s\S]*Obiettivo\n[\s\S]*Da completare:[\s\S]*Criterio di accettazione\n[\s\S]*Formato della risposta\n/],
  ]
  for (const [draftText, shape] of cases) {
    const ran = await $.command.run({ command: 'coach', args: draftText, origin: ORIGIN, presentation: 'transcript' })
    const proposalText = String(ran.text).split('\n\n').slice(1).join('\n\n')
    expect(proposalText).toMatch(shape)
    expect(assess(proposalText).criteria.find(c => c.id === 'claridad')?.points).toBe(0)
  }
})

test('each model call records its exact tokens and its cost at list price; the pane totals them and /coach usage lists them', async ($, on) => {
  const stored = new Map<string, unknown>()
  const CALL = { input_tokens: 600, output_tokens: 300, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 }
  engine(on, (prompt: string) => {
    return { isAnswered: true, text: /Your previous version/.test(prompt) ? FULL : 'Objetivo\nArregla el login.', usage: CALL }
  }, [], ROWS)
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => { stored.set(e.key, e.value); return { value: undefined } })
  await $.session.start({ cwd: '/tmp/demo-app', surface: 'vscode', isInteractive: true })
  await $.command.run({ command: 'coach', args: 'arregla el login', origin: ORIGIN, presentation: 'transcript' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // haiku: 600 × 0,10 + 400 × 0,01 + 300 × 0,50 = 214 $ por millón = 0,000214 $ por llamada
  expect((await ui.find({ type: 'Text', text: /llamadas/ }))?.text).toBe('haiku · 2 llamadas · 2000 in (800 en caché) · 600 out · 0,0004 $ · 0,0 s')
  await ui.unmount()

  const calls = stored.get('usage') as { pass: number; input: number; cached: number; output: number; usd: number }[]
  expect(calls.map(c => [c.pass, c.input, c.cached, c.output, Number(c.usd.toFixed(6))])).toEqual([[1, 1000, 400, 300, 0.000214], [2, 1000, 400, 300, 0.000214]])
  const report = await $.command.run({ command: 'coach', args: 'usage', origin: ORIGIN, presentation: 'transcript' })
  expect(report.text).toMatch(/Hoy: 2 llamadas · 2000 in · 600 out · 0,0004 \$/)
  expect(report.text).toMatch(/Por modelo \(7 días\): haiku 2 llamadas/)
  expect(report.text).toMatch(/haiku · pasada 2 · 1000 in \(400 en caché\) · 300 out · 0,0002 \$/)
})

test('list prices: the rewrite cost matches what Claude Code charges, and an unknown model gets no invented price', async () => {
  // Haiku 5.5, llamada real de claude -p: 2 de entrada, 637 escritos en caché (1 h), 11 de salida = 0,0001331 $
  expect(Number(callCost('claude-haiku-5-5', { uncached: 2, cacheRead: 0, cacheWrite: 637, output: 11 })!.toFixed(7))).toBe(0.0001331)
  // Sonnet 5.5, llamada real: 2, 616 escritos, 20 de salida = 0,002668 $
  expect(Number(callCost('sonnet', { uncached: 2, cacheRead: 0, cacheWrite: 616, output: 20 })!.toFixed(6))).toBe(0.002668)
  expect(callCost('opus', { uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(4)
  expect(callCost('claude-opus-4-8', { uncached: 1000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBeNull()
  expect(callCost('haiku', { uncached: 200_000, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0.1)
})
