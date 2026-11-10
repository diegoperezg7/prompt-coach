// Benchmark de modelos para la reescritura: mismo flujo que el mod (pasada + reparación), coste real por llamada
// y un juez ciego que puntúa fidelidad y datos inventados, lo que la rúbrica local no puede ver.
// Uso: node --experimental-strip-types bench/run.mts [modelos=haiku,sonnet] [juez=opus] [verbosidad=balanced]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { assess, langOf, recentContext, repairPrompt, rewritePrompt, shouldRepair, systemPrompt, turnOf, unfence } from '../core/rubric.ts'
import type { Verbosity } from '../core/rubric.ts'
import { CASES } from './cases.mts'

const MODELS = (process.argv[2] ?? 'haiku,sonnet').split(',')
const JUDGE = process.argv[3] ?? 'opus'
const VERBOSITY = (process.argv[4] ?? 'balanced') as Verbosity
const CWD = '/Users/demo/Proyectos/app'

type Call = { text: string; cost: number; ms: number; tokensIn: number; tokensOut: number }

function claude(model: string, system: string, prompt: string): Promise<Call> {
  const args = ['-p', '--model', model, '--effort', 'low', '--system-prompt', system, '--tools', '', '--output-format', 'json',
    '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', '']
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.on('close', () => {
      try {
        const d = JSON.parse(out)
        const u = d.usage
        resolve({
          text: String(d.result ?? ''), cost: d.total_cost_usd, ms: d.duration_api_ms,
          tokensIn: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, tokensOut: u.output_tokens,
        })
      } catch (e) { reject(new Error(`${model}: ${out.slice(0, 300)}`)) }
    })
    child.stdin.end(prompt)
  })
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = []
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i]!() }
  }))
  return out
}

type Run = { id: string; model: string; text: string; words: number; before: number; first: number; after: number; passes: number; cost: number; ms: number; tokensIn: number; tokensOut: number; missing: string[] }

async function rewrite(c: (typeof CASES)[number], model: string): Promise<Run> {
  const lang = langOf(c.draft)
  // Mismo turno, contexto y regla de reparación que el mod.
  const turn = turnOf(c.draft, c.rows)
  const context = recentContext(c.rows, CWD)
  const opts = { cwd: CWD, context, turn }
  const system = systemPrompt(lang, VERBOSITY, turn)
  const known = [c.draft, context].join('\n')
  const r1 = await claude(model, system, rewritePrompt(c.draft, opts))
  let text = unfence(r1.text)
  let a = assess(text, { known, cwd: CWD, turn })
  const first = a.score
  let cost = r1.cost, ms = r1.ms, tokensIn = r1.tokensIn, tokensOut = r1.tokensOut, passes = 1
  if (shouldRepair(a, turn)) {
    const r2 = await claude(model, system, repairPrompt(c.draft, text, a, opts))
    cost += r2.cost; ms += r2.ms; tokensIn += r2.tokensIn; tokensOut += r2.tokensOut; passes = 2
    const t2 = unfence(r2.text)
    const a2 = assess(t2, { known, cwd: CWD, turn })
    if (a2.score > a.score) { text = t2; a = a2 }
  }
  return {
    id: c.id, model, text, before: assess(c.draft, { cwd: CWD, turn }).score, words: text.split(/\s+/).filter(Boolean).length, first, after: a.score, passes, cost, ms, tokensIn, tokensOut,
    missing: a.missing.map(m => `${m.id} ${m.points}/${m.max}`),
  }
}

const JUDGE_SYSTEM = [
  'Evalúas reescrituras de prompts para un agente de código. Eres estricto y no te dejas impresionar por la longitud.',
  'Para cada candidato puntúa de 1 a 10:',
  '- fidelity: conserva la intención exacta del borrador; no añade requisitos ni cambia el alcance.',
  '- grounded: no inventa hechos del proyecto (rutas, nombres de archivos o funciones, errores, cifras, servicios,',
  '  causas) que no estén en el borrador, la conversación o la ruta del proyecto. Pedir al agente que compruebe',
  '  algo no es inventar, y una restricción prudente (no añadir dependencias) tampoco es un hecho inventado.',
  '- usefulness: un agente lo ejecutaría bien a la primera con menos idas y vueltas que con el borrador.',
  '- sameLanguage: true si el candidato está escrito en el mismo idioma que el borrador.',
  '- repeats: true si repite el proyecto, la conversación o lo que el agente ya hizo, o si convierte una respuesta',
  '  corta en una plantilla con secciones (Objetivo, Contexto...). Sin conversación previa, false.',
  'Lista en invented cada hecho inventado, literal. Devuelve SOLO JSON con una clave por candidato:',
  '{"A":{"fidelity":n,"grounded":n,"usefulness":n,"sameLanguage":true,"repeats":false,"invented":[]},"B":{...}}',
].join('\n')

type Verdict = { fidelity: number; grounded: number; usefulness: number; sameLanguage: boolean; repeats: boolean; invented: string[] }

async function judge(c: (typeof CASES)[number], runs: Run[]): Promise<Record<string, Verdict & { cost: number }>> {
  const order = [...runs].sort(() => Math.random() - 0.5)
  const labels = ['A', 'B', 'C', 'D', 'E'].slice(0, order.length)
  const prompt = [
    `Proyecto (lo conoce el agente): ${CWD}`,
    `Borrador:\n${c.draft}`,
    c.rows.length ? `Conversación previa:\n${recentContext(c.rows, CWD)}` : 'Sin conversación previa.',
    ...order.map((r, i) => `Candidato ${labels[i]}:\n${r.text}`),
  ].join('\n\n')
  const r = await claude(JUDGE, JUDGE_SYSTEM, prompt)
  const json = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1))
  return Object.fromEntries(order.map((run, i) => [run.model, { ...json[labels[i]!], cost: r.cost / order.length }]))
}

const runs = await pool(CASES.flatMap(c => MODELS.map(m => () => rewrite(c, m))), 4)
const verdicts = await pool(CASES.map(c => () => judge(c, runs.filter(r => r.id === c.id))), 4)

const rows = runs.map(r => ({ ...r, judge: verdicts[CASES.findIndex(c => c.id === r.id)]![r.model]! }))
writeFileSync(new URL(`./results-${VERBOSITY}.json`, import.meta.url), JSON.stringify(rows, null, 2))

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
console.log('\nPor caso (antes → 1ª pasada → final):')
for (const c of CASES) {
  console.log(c.id.padEnd(15), MODELS.map(m => {
    const r = rows.find(x => x.id === c.id && x.model === m)!
    return `${m}: ${r.before}→${r.first}→${r.after} p${r.passes} ${r.words}w fid ${r.judge.fidelity} gr ${r.judge.grounded} us ${r.judge.usefulness}${r.judge.sameLanguage ? '' : ' IDIOMA'}${r.judge.repeats ? ' REPITE' : ''}${r.judge.invented.length ? ' inv ' + r.judge.invented.length : ''}`
  }).join(' | '))
}
console.log('\nResumen:')
for (const m of MODELS) {
  const rs = rows.filter(r => r.model === m)
  console.log(m.padEnd(8), {
    notaMedia: avg(rs.map(r => r.after)).toFixed(1),
    a100: `${rs.filter(r => r.after === 100).length}/${rs.length}`,
    pasadas: avg(rs.map(r => r.passes)).toFixed(2),
    fidelidad: avg(rs.map(r => r.judge.fidelity)).toFixed(1),
    sinInventar: avg(rs.map(r => r.judge.grounded)).toFixed(1),
    utilidad: avg(rs.map(r => r.judge.usefulness)).toFixed(1),
    inventados: rs.reduce((s, r) => s + r.judge.invented.length, 0),
    repiteContexto: `${rs.filter(r => r.judge.repeats).length}/${rs.length}`,
    idiomaCorrecto: `${rs.filter(r => r.judge.sameLanguage).length}/${rs.length}`,
    palabras: Math.round(avg(rs.map(r => r.words))),
    costeMedioUSD: avg(rs.map(r => r.cost)).toFixed(5),
    latenciaMediaS: (avg(rs.map(r => r.ms)) / 1000).toFixed(1),
    tokensMedios: `${Math.round(avg(rs.map(r => r.tokensIn)))} in / ${Math.round(avg(rs.map(r => r.tokensOut)))} out`,
  })
}
