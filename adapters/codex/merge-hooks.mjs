// Añade el hook de Prompt Coach a hooks.json de Codex sin tocar los que ya haya. Idempotente.
// Uso: node merge-hooks.mjs <ruta de hooks.json> <ruta de cli/prompt-coach.mts>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [file, cli] = process.argv.slice(2)
const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
const command = `node --experimental-strip-types --no-warnings "${cli}" hook codex`
config.hooks ??= {}
config.hooks.UserPromptSubmit ??= []
const groups = config.hooks.UserPromptSubmit
const present = groups.some(g => (g.hooks ?? []).some(h => String(h.command ?? '').includes('prompt-coach.mts" hook codex')))
if (!present) groups.push({ hooks: [{ type: 'command', command, timeout: 10, statusMessage: 'Prompt Coach' }] })
writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
console.log(present ? `Prompt Coach was already in ${file}` : `Prompt Coach added to ${file}`)
