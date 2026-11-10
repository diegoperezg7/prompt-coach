import { expect, test } from 'claude-code/testing'

import { FIXTURES } from './rubric.fixtures.ts'
import { assess, completable, completePrompt, detectLang, isSolid, recentContext, shouldRepair, systemPrompt, touchedFiles, turnOf } from './rubric.ts'

test('every rubric fixture keeps its score, its points per criterion and its detected language', async () => {
  for (const f of FIXTURES) {
    const a = assess(f.text)
    const d = detectLang(f.text)
    expect({ id: f.id, score: a.score, points: a.criteria.map(c => c.points), lang: d.sure ? d.lang : null })
      .toEqual({ id: f.id, score: f.score, points: f.points, lang: f.lang })
  }
})

test('mid-conversation drafts: an answer to the agent is a reply, anything else continues, and context is not demanded again', async () => {
  const asked = [{ role: 'user', text: 'arregla el login' }, { role: 'assistant', text: 'He visto dos causas. ¿Sigo con el token o con la cookie?' }]
  const done = [{ role: 'user', text: 'arregla el login' }, { role: 'assistant', text: 'Hecho, tests 3/3.' }]
  expect(turnOf('arregla el login', [])).toBe('new')
  expect(turnOf('con la cookie', asked)).toBe('reply')
  expect(turnOf('ahora haz lo mismo en el registro', done)).toBe('continue')
  const draft = 'ahora haz lo mismo en el registro'
  expect(assess(draft, { turn: 'continue' }).criteria[1]!.points).toBe(15)
  expect(assess(draft).criteria[1]!.points).toBeLessThan(15)
  expect(systemPrompt('es', 'balanced', 'reply')).not.toContain('Fixed structure')
})

test('a section header alone earns nothing: an empty response format scores 0, a stated one 10', async () => {
  const pick = (text: string) => assess(text).criteria.find(c => c.id === 'formato')!.points
  expect(pick('Objetivo:\nArregla el login de src/auth/login.ts.\n\nFormato de respuesta:\n')).toBe(0)
  expect(pick('Goal:\nFix the login in src/auth/login.ts.\n\nResponse format:')).toBe(0)
  expect(pick('Objetivo:\nArregla el login de src/auth/login.ts.\n\nFormato de respuesta:\n- Diff resumido por archivo.')).toBe(10)
  expect(pick('arregla el login y dame un resumen de los cambios')).toBe(10)
})

test('criteria depend on the request: an explanation or a question is not penalised for acceptance or constraints', async () => {
  const explain = assess('explícame cómo funciona el pooler de supabase que usamos en src/db/pool.ts')
  expect(explain.intent).toBe('explain')
  for (const id of ['aceptacion', 'restricciones'] as const) expect(explain.criteria.find(c => c.id === id)!.max).toBe(0)
  expect(explain.missing.map(c => c.id)).not.toContain('aceptacion')
  expect(explain.missing.map(c => c.id)).not.toContain('restricciones')
  // Lo que sí aplica, completo, da 100 aunque no haya criterio de terminado ni restricciones.
  expect(assess('explícame cómo funciona `getPool()` en src/db/pool.ts, por ejemplo cuando hay 30 conexiones, y responde con un resumen').score).toBe(100)
  const question = assess('¿por qué tarda 40 segundos el arranque de src/app/main.ts?')
  expect(question.intent).toBe('ask')
  expect(question.criteria.find(c => c.id === 'aceptacion')!.max).toBe(0)
  expect(assess('revisa src/store/useBudget.ts').criteria.find(c => c.id === 'aceptacion')!.max).toBe(0)
  // Un encargo sigue necesitando las dos.
  const fix = assess('arregla el login de src/auth/login.ts')
  expect(fix.criteria.find(c => c.id === 'aceptacion')!.max).toBe(20)
  expect(fix.criteria.find(c => c.id === 'restricciones')!.max).toBe(15)
})

test('files the agent read or edited are known context: listed for the model and verified in the score', async () => {
  const rows = [
    { role: 'user', text: 'mira el login', toolUses: [] },
    { role: 'assistant', text: 'Hecho.', toolUses: [{ input: { file_path: '/repo/src/auth/login.ts' } }, { input: { path: '/repo/src' } }, { input: { command: 'ls' } }] },
  ]
  expect(touchedFiles(rows, '/repo')).toEqual(['src/auth/login.ts', 'src'])
  const context = recentContext(rows, '/repo')
  expect(context).toContain('Files the agent has read or edited (most recent last): src/auth/login.ts')
  const a = assess('añade un test a src/auth/login.ts', { known: context })
  expect(a.criteria.find(c => c.id === 'contexto')!.points).toBe(15)
})

test('a solid new task is completed, not rewritten: only goal, acceptance, constraints and format can be added, with their headers', async () => {
  const solid = assess('In src/cart/tax.ts the VAT is applied twice when a coupon is used: a 100 € cart with a 10% coupon shows 108.9 instead of 99. Fix calculateTotal() so tax is applied once after the discount, add a unit test for that case, do not change the coupon API and reply with a short diff summary.')
  expect(solid.score).toBeGreaterThanOrEqual(80)
  expect(isSolid(solid, 'new')).toBe(true)
  expect(isSolid(solid, 'continue')).toBe(false)
  expect(isSolid(assess('arregla el login'), 'new')).toBe(false)
  expect(completable(solid)).toEqual(['aceptacion', 'restricciones'])
  // Contexto y detalle no se completan: los tiene que dar la persona.
  expect(completable(assess('arregla el login y no toques el registro'))).not.toContain('contexto')
  expect(completePrompt('arregla X', solid, 'es', {})).toMatch(/Draft to complete:\narregla X[\s\S]*- Criterio de aceptación: acceptance criteria[\s\S]*- Restricciones: constraints/)
})

test('the repair pass follows the turn: always for a new task below 100, only when weak mid-conversation, never for a reply', async () => {
  const weak = assess('arregla el login')
  const solid = assess('arregla el login de src/auth/login.ts: devuelve 500 en vez de entrar. Añade un test y no toques el registro')
  expect(shouldRepair(weak, 'new')).toBe(true)
  expect(shouldRepair(solid, 'new')).toBe(true)
  expect(shouldRepair(weak, 'continue')).toBe(true)
  expect(shouldRepair(solid, 'continue')).toBe(false)
  expect(shouldRepair(weak, 'reply')).toBe(false)
})
