import { expect, test } from 'claude-code/testing'

import { codexHook, scoreReport, shouldHold } from './coach.ts'

test('the Codex hook holds a weak work prompt with the reason in its language, and lets the rest through', async () => {
  const es = codexHook({ prompt: 'arregla el login' })
  expect(es?.decision).toBe('block')
  expect(es?.reason).toMatch(/^Prompt Coach: Prompt flojo 5\/100\. Falta para 100: objetivo 0\/20[\s\S]*Usa \$coach[\s\S]*raw:/)
  expect(codexHook({ prompt: 'fix the login' })?.reason).toMatch(/^Prompt Coach: Weak prompt 5\/100[\s\S]*Run \$coach/)
  expect(codexHook({ prompt: 'raw: arregla el login' })).toBeNull()
  expect(codexHook({ prompt: '/review' })).toBeNull()
  // La skill $coach se invoca con un borrador flojo: el hook no puede bloquearla.
  expect(codexHook({ prompt: '$coach arregla el login' })).toBeNull()
  expect(codexHook({ prompt: '¿cómo funciona el pooler de supabase?' })).toBeNull()
  expect(codexHook({ prompt: 'ok' })).toBeNull()
  expect(codexHook({ prompt: 'Revisa src/auth/login.ts: el login devuelve 500 al enviar el formulario; localiza la causa y añade un test que lo cubra.' })).toBeNull()
  expect(codexHook({})).toBeNull()
})

test('score reports the score, the language and what is missing for 100', async () => {
  const r = scoreReport('fix the login in src/auth/login.ts, it returns 500')
  expect(r.lang).toBe('en')
  expect(r.weak).toBe(true)
  expect(r.missing.map(m => m.id)).toContain('aceptacion')
  expect(shouldHold('fix the login in src/auth/login.ts, it returns 500')).toBe(true)
})
