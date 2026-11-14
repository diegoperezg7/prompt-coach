// Estado del mod: valores de $.state, ajustes del plugin, estado de la sesión y utilidades de idioma y nota.
import type { EngineInterface } from 'claude-code'

import { assess, detectLang, isQuestion, LABEL, topGap, turnOf, WEAK_BELOW } from '../core/rubric.ts'
import type { Lang, Verbosity } from '../core/rubric.ts'
import { UI } from './i18n.ts'

export const PANE = 'prompt-coach'
export const MAX_DRAFT = 8000


// `session`: el modelo de la propia sesión, sea el que sea en ese momento.
export const MODELS = ['haiku', 'sonnet', 'opus', 'session'] as const
export const RULE_FILES = ['CLAUDE.md', 'AGENTS.md']
export const LAST_LANG = 'lastLang'

/** Ajustes del plugin (userConfig); register() los fija en cada carga. */
export const cfg = {
  // Idioma de la interfaz; en `auto`, el del borrador. La propuesta va siempre en el idioma del borrador.
  language: 'auto' as 'auto' | Lang,
  model: 'haiku' as string,
  verbosity: 'balanced' as Verbosity,
  // Leer CLAUDE.md y AGENTS.md del proyecto como contexto de la reescritura.
  projectRules: true,
  // Retener al pulsar Enter un prompt flojo con texto pegado, en cualquier superficie: es el único momento en
  // que Claude Code deja leer lo pegado (también lo que dicta Wispr Flow).
  holdPasted: true,
}

/** Estado de la sesión que no se dibuja: se pierde con una recarga, y no pasa nada. */
export const ses = {
  // True en terminal y escritorio, donde la banda sobre el prompt dibuja la puntuación y el botón.
  // Sin banda (VS Code, móvil) el panel se abre al arrancar y hace de banda.
  hasBand: false,
  // Superficie de la sesión; null en `claude -p` y el SDK, donde nadie elige y no se retiene nada.
  surface: null as string | null,
  // Último idioma detectado con seguridad, recordado entre sesiones.
  lastLang: null as Lang | null,
  // Lo que la persona teclea en el editor del panel; no es estado para no redibujar a cada tecla.
  edited: null as string | null,
  // Una mejora a la vez: la nueva o Cancelar cortan la anterior, que deja de escribir en el panel.
  run: 0,
  stop: null as AbortController | null,
  // El borrador de la persona antes de «Sustituir borrador», para devolverlo con /coach undo.
  lastOriginal: null as string | null,
  // La conversación al empezar el borrador actual: decide si es un encargo nuevo, una respuesta o una continuación.
  talk: [] as readonly { role: string; text: string }[],
  // Ancho del cuerpo del panel en su último dibujo, para pedir al abrirlo el alto que necesita la propuesta.
  paneCols: 80,
  // La persona cerró el panel (Escape o la marca de cierre) durante esta mejora: no se vuelve a abrir solo.
  paneClosed: false,
}

/** Nota del borrador según dónde cae en la conversación. */
export const scoreOf = (text: string) => assess(text, { turn: turnOf(text, ses.talk) })
/** Ni las preguntas ni las respuestas a una pregunta del agente se puntúan: la rúbrica mide encargos. */
export const skipScore = (text: string) => isQuestion(text) || turnOf(text, ses.talk) === 'reply'

// En `auto`, el idioma del borrador solo cuando la detección es segura; si no, el último seguro. Así la interfaz
// no salta de idioma con las primeras palabras («fix» sin más se leería como español).
export const uiLang = (text: string): Lang => {
  if (cfg.language !== 'auto') return cfg.language
  const d = detectLang(text)
  // Sin pistas y sin idioma recordado (la primera vez de todas, o el panel vacío), inglés.
  return d.sure ? d.lang : ses.lastLang ?? 'en'
}
export const ui = (text: string) => UI[uiLang(text)]

// Fija el último idioma seguro y lo recuerda entre sesiones; desde eventos, nunca mientras se dibuja.
export function noteLang($: EngineInterface, text: string) {
  // Ni comandos ni textos de menos de tres palabras: al teclear «/coach undo» pasa por «/coach und», y «und» es
  // alemán; con tan poco texto la detección no es de fiar.
  const t = text.trim()
  if (t.startsWith('/') || t.split(/\s+/).filter(Boolean).length < 3) return
  const d = detectLang(t)
  if (!d.sure || d.lang === ses.lastLang) return
  ses.lastLang = d.lang
  void $.store.set(LAST_LANG, d.lang).catch(() => undefined)
}

export const isCoachable = (text: string) => text.trim().length > 0 && !text.trimStart().startsWith('/')

export const tone = (score: number) => (score < WEAK_BELOW ? 'warning' : 'success')

// Por debajo de este ancho la banda deja solo la nota y el botón.
export const NARROW = 40
// Desde este ancho la banda añade el criterio que más resta, para enseñar mientras se escribe.
export const HINT_COLS = 60
export const gapHint = (text: string, a: ReturnType<typeof assess>) => {
  const gap = topGap(a)
  return gap ? `${ui(text).gap}: ${LABEL[uiLang(text)][gap.id]}` : ''
}

// Filas que ocupa un texto en `cols` columnas, contando el ajuste de línea.
export const wrappedRows = (text: string, cols: number) =>
  text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, cols))), 0)

// Filas del panel aparte del editor: cabecera, avisos, botones y huecos. Al abrirlo se pide esto más la propuesta.
export const PANE_CHROME = 8

// Alto del editor del panel en terminal: la propuesta entera si cabe, para leerla sin scroll interno; si no,
// lo que deja libre el resto (al menos 3 filas). En poco alto, sin huecos.
export function paneLayout(bodyRows: number, cols: number, lines: string[], text = '') {
  const shown = lines.filter(Boolean)
  const gap = bodyRows < 20 ? 0 : 1
  const used = shown.reduce((sum, line) => sum + wrappedRows(line, cols), 0) + gap * shown.length
  // +1: la línea en la que el cursor queda al final del texto.
  const wanted = text ? wrappedRows(text, cols) + 1 : 14
  return { gap, rows: Math.max(3, Math.min(wanted, bodyRows - used)) }
}
