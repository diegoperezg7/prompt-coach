import { expect, test } from 'claude-code/testing'

import { draftForModel, expandPastes, hasPasteChip, hasPastedBlock, restorePastes, splitPastes } from './pastes.ts'

// Tal como lo entrega Claude Code al enviar (capturado de una sesión real).
const block = (id: string, body: string) => `\n\n<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">\n`
const LOG = 'TypeError: Cannot read properties of undefined (reading \'token\')\n    at login (src/auth/login.ts:42:18)'

test('a dictation (almost nothing typed besides the paste) is rewritten whole, without markers or tags', async () => {
  const sent = block('7b0c', 'arregla el login de src/auth/login.ts que devuelve 500 al enviar el formulario').trim()
  expect(hasPastedBlock(sent)).toBe(true)
  const p = splitPastes(sent)
  expect(p.isDictation).toBe(true)
  expect(draftForModel(p)).toBe('arregla el login de src/auth/login.ts que devuelve 500 al enviar el formulario')
  expect(restorePastes('Objetivo: arreglar el login.', p)).toBe('Objetivo: arreglar el login.')
})

test('pasted support material is shown to the model apart, cut when huge, and comes back whole in the proposal', async () => {
  const sent = `mira este error y arréglalo sin tocar el registro${block('a1', LOG)}`
  const p = splitPastes(sent)
  expect(p.isDictation).toBe(false)
  expect(p.own).toBe('mira este error y arréglalo sin tocar el registro [Pasted text #1]')
  expect(draftForModel(p)).toMatch(/\[Pasted text #1\]\n\nPasted text #1 \(the agent receives it as it is[\s\S]*TypeError: Cannot read/)
  expect(restorePastes('Objetivo: arreglar el error.\nContexto: [Pasted text #1]', p)).toBe(`Objetivo: arreglar el error.\nContexto:\n\n${LOG}`)
  expect(restorePastes('Objetivo: arreglar el error.', p)).toBe(`Objetivo: arreglar el error.\n\n${LOG}`)
  const huge = splitPastes(`revisa este log${block('b2', 'x'.repeat(9000))}`)
  expect(draftForModel(huge)).toMatch(/\[\.\.\. 3000 more characters\]/)
  expect(expandPastes(sent)).toBe(`mira este error y arréglalo sin tocar el registro\n\n${LOG}`)
  expect(hasPasteChip('mira esto: [Pasted text #1 +12 lines]')).toBe(true)
  expect(hasPasteChip('mira esto: [Image #1]')).toBe(false)
})
