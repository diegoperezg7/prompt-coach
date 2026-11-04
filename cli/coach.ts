// Prompt Coach fuera de Claude Code: puntuar un texto y hacer de hook para otros agentes (por ahora, Codex).
// Funciones puras sobre core/; la entrada y salida estándar están en prompt-coach.mts.
import { assess, describeMissing, detectLang, isQuestion, LABEL } from '../core/rubric.ts'
import type { Lang } from '../core/rubric.ts'
import { UI } from '../hooks/i18n.ts'

/** Prefijo para enviar un prompt tal cual aunque sea flojo: el hook no puede reescribirlo, solo dejarlo pasar. */
export const BYPASS = /^\s*raw:/i

export function scoreReport(text: string) {
  const a = assess(text)
  const { lang, sure } = detectLang(text)
  return {
    score: a.score,
    weak: a.weak,
    lang: sure ? lang : null,
    missing: a.missing.map(c => ({ id: c.id, label: LABEL.en[c.id], points: c.points, max: c.max })),
  }
}

/** Prompt que invoca una skill de Codex (`$coach …`): no se retiene, o el hook bloquearía la propia skill. */
const SKILL = /^\s*\$[a-z][\w-]*/i

/** Lo mismo que retiene la extensión de VS Code: un encargo flojo, no una pregunta, un comando ni una respuesta corta. */
export function shouldHold(text: string): boolean {
  const t = text.trim()
  if (!t || t.startsWith('/') || SKILL.test(t) || BYPASS.test(t) || isQuestion(t)) return false
  const a = assess(t)
  return a.weak && a.intent !== 'ask' && a.words >= 3
}

/**
 * Hook UserPromptSubmit de Codex: recibe `{ prompt, ... }` y devuelve `{ decision: 'block', reason }` para un
 * prompt flojo, o null para dejarlo pasar. El motivo va en el idioma del borrador.
 */
export function codexHook(input: { prompt?: unknown }): { decision: 'block'; reason: string } | null {
  const text = typeof input.prompt === 'string' ? input.prompt : ''
  if (!shouldHold(text)) return null
  const a = assess(text)
  const d = detectLang(text)
  const lang: Lang = d.sure ? d.lang : 'en'
  const t = UI[lang]
  return {
    decision: 'block',
    reason: `Prompt Coach: ${t.weak} ${a.score}/100. ${t.toFull}: ${describeMissing(a, lang).join('; ')}. ${t.heldCli}`,
  }
}
