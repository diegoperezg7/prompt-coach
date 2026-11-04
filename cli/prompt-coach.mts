#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// prompt-coach score [--known <borrador>] [texto]
//                              puntúa el texto (o lo que llegue por stdin) y escribe el informe en JSON. La carpeta
//                              actual no cuenta como contexto; con --known (el borrador original, al puntuar una
//                              reescritura) una ruta que no aparezca en él tampoco
// prompt-coach hook codex      hook UserPromptSubmit de Codex: lee el JSON del evento por stdin y, si el
//                              prompt es flojo, escribe {"decision":"block","reason":...}; si no, nada
import { codexHook, scoreReport } from './coach.ts'

async function stdin(): Promise<string> {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

const [command, arg] = process.argv.slice(2)
if (command === 'score') {
  const args = process.argv.slice(3)
  const k = args.indexOf('--known')
  const known = k >= 0 ? args[k + 1] ?? '' : undefined
  if (k >= 0) args.splice(k, 2)
  const text = args.join(' ') || (await stdin())
  process.stdout.write(JSON.stringify(scoreReport(text, { cwd: process.cwd(), known }), null, 2) + '\n')
} else if (command === 'hook' && arg === 'codex') {
  let input: { prompt?: unknown } = {}
  try { input = JSON.parse(await stdin()) } catch { process.exit(0) }
  const out = codexHook(input)
  if (out) process.stdout.write(JSON.stringify(out) + '\n')
} else {
  process.stderr.write('Usage: prompt-coach score [--known <draft>] [text] | prompt-coach hook codex\n')
  process.exit(1)
}
