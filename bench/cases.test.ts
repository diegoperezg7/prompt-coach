import { expect, test } from 'claude-code/testing'

import { turnOf } from '../core/rubric.ts'
import { CASES } from './cases.mts'

test('every bench case is read as the turn it is meant to exercise, and replies and continuations are covered', async () => {
  for (const c of CASES) expect({ id: c.id, turn: turnOf(c.draft, c.rows) }).toEqual({ id: c.id, turn: c.turn })
  expect(CASES.filter(c => c.turn === 'reply').length).toBeGreaterThanOrEqual(2)
  expect(CASES.filter(c => c.turn === 'continue').length).toBeGreaterThanOrEqual(2)
})
