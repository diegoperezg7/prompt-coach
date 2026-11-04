// Resumen versionable del benchmark: vuelve a puntuar las propuestas guardadas (results-*.json, que no se suben)
// con la rúbrica actual y escribe summary.json, que sí se sube y respalda las tablas del README.
// Uso: node --experimental-strip-types bench/summary.mts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { assess } from '../core/rubric.ts'
import { CASES } from './cases.mts'

const CWD = '/Users/demo/Proyectos/app'
const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10

const runs: Record<string, unknown>[] = []
const cases: Record<string, unknown>[] = []
for (const verbosity of ['concise', 'balanced', 'detailed']) {
  const file = new URL(`./results-${verbosity}.json`, import.meta.url)
  if (!existsSync(file)) continue
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  for (const model of [...new Set(rows.map((r: { model: string }) => r.model))] as string[]) {
    const rs = rows.filter((r: { model: string }) => r.model === model)
    const scored = rs.map((r: { id: string; text: string }) => {
      const c = CASES.find(x => x.id === r.id)!
      return assess(r.text, { known: c.draft + '\n' + c.context, cwd: CWD }).score
    })
    runs.push({
      model, verbosity, drafts: rs.length,
      avgScore: avg(scored),
      at100: scored.filter((s: number) => s === 100).length,
      fidelity: avg(rs.map((r: any) => r.judge.fidelity)),
      grounded: avg(rs.map((r: any) => r.judge.grounded)),
      usefulness: avg(rs.map((r: any) => r.judge.usefulness)),
      invented: rs.reduce((s: number, r: any) => s + r.judge.invented.length, 0),
      rightLanguage: rs.filter((r: any) => r.judge.sameLanguage).length,
      avgWords: Math.round(avg(rs.map((r: any) => r.words))),
      avgCostUSD: Number((rs.reduce((s: number, r: any) => s + r.cost, 0) / rs.length).toFixed(5)),
      avgLatencyS: avg(rs.map((r: any) => r.ms / 1000)),
    })
    rs.forEach((r: any, i: number) => cases.push({
      id: r.id, model, verbosity, before: r.before, after: scored[i], passes: r.passes, words: r.words,
      fidelity: r.judge.fidelity, grounded: r.judge.grounded, usefulness: r.judge.usefulness,
      sameLanguage: r.judge.sameLanguage, invented: r.judge.invented.length,
    }))
  }
}

writeFileSync(new URL('./summary.json', import.meta.url), JSON.stringify({
  judge: 'opus', drafts: CASES.length, languages: ['en', 'es', 'fr', 'de', 'pt', 'it'], runs, cases,
}, null, 2) + '\n')
console.table(runs)
