import { expect, test } from 'claude-code/testing'

import { FIXTURES } from './rubric.fixtures.ts'
import { assess, detectLang } from './rubric.ts'

test('every rubric fixture keeps its score, its points per criterion and its detected language', async () => {
  for (const f of FIXTURES) {
    const a = assess(f.text)
    const d = detectLang(f.text)
    expect({ id: f.id, score: a.score, points: a.criteria.map(c => c.points), lang: d.sure ? d.lang : null })
      .toEqual({ id: f.id, score: f.score, points: f.points, lang: f.lang })
  }
})
