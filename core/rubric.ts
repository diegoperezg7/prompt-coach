// Núcleo de Prompt Coach: rúbrica, motor local y prompts del modelo.
// Sin dependencias de ningún agente, para reutilizarlo en Claude Code, Codex, OpenCode, Cursor o Windsurf.

export type Lang = 'es' | 'en'
export type Intent = 'fix' | 'change' | 'test' | 'review' | 'refactor' | 'explain' | 'design' | 'feature' | 'ask'
export type CriterionId = 'objetivo' | 'contexto' | 'detalle' | 'aceptacion' | 'restricciones' | 'formato' | 'claridad'
export type Criterion = { id: CriterionId; points: number; max: number; why?: string }
export type Assessment = {
  score: number
  weak: boolean
  intent: Intent
  words: number
  criteria: Criterion[]
  /** Criterios por debajo de su máximo, en el orden de la rúbrica. */
  missing: Criterion[]
}

export const WEAK_BELOW = 60

export const MAX: Record<CriterionId, number> = {
  objetivo: 20, contexto: 15, detalle: 15, aceptacion: 20, restricciones: 15, formato: 10, claridad: 5,
}

export const LABEL: Record<Lang, Record<CriterionId, string>> = {
  es: { objetivo: 'objetivo', contexto: 'contexto', detalle: 'detalle concreto', aceptacion: 'criterio de aceptación', restricciones: 'restricciones', formato: 'formato de respuesta', claridad: 'claridad' },
  en: { objetivo: 'goal', contexto: 'context', detalle: 'concrete detail', aceptacion: 'acceptance criteria', restricciones: 'constraints', formato: 'response format', claridad: 'clarity' },
}

const WHY: Record<Lang, Record<string, string>> = {
  es: {
    short: 'demasiado corto', brief: 'falta concretar qué conseguir',
    noAnchor: 'sin ruta, archivo ni símbolo', unverified: 'ruta o símbolo que no aparece en el borrador ni en la conversación',
    discovery: 'pide localizarlo, pero sin ruta concreta', vagueScope: 'zona del código sin ruta concreta',
    oneDetail: 'un solo dato concreto', noDetail: 'sin comportamiento esperado, error, ejemplo ni cifra',
    weakAccept: 'verificación sin criterio explícito de terminado', noAccept: 'sin criterio de terminado',
    oneLimit: 'una sola restricción', noLimit: 'sin restricciones ni alcance',
    noFormat: 'sin decir qué devolver', vague: 'referencias vagas', gaps: 'huecos sin rellenar', long: 'demasiado largo',
  },
  en: {
    short: 'too short', brief: 'what to achieve is not concrete',
    noAnchor: 'no path, file or symbol', unverified: 'path or symbol not found in the draft or the conversation',
    discovery: 'asks to locate it, but no concrete path', vagueScope: 'area of the code without a concrete path',
    oneDetail: 'only one concrete fact', noDetail: 'no expected behaviour, error, example or figure',
    weakAccept: 'verification without an explicit done criterion', noAccept: 'no done criterion',
    oneLimit: 'only one constraint', noLimit: 'no constraints or scope',
    noFormat: 'does not say what to return', vague: 'vague references', gaps: 'unfilled gaps', long: 'too long',
  },
}

export function normalize(text: string): string {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function isSpanish(text: string): boolean {
  const value = ' ' + normalize(text) + ' '
  const es = (value.match(/\b(el|la|los|las|de|que|para|con|una|un|esto|eso|pero|como|mas|sin|y|en|del|al|se|lo)\b/g) || []).length
  const en = (value.match(/\b(the|and|for|with|this|that|from|into|should|please|need|make|is|of|to|it)\b/g) || []).length
  return es >= en
}

export const langOf = (text: string): Lang => (isSpanish(text) ? 'es' : 'en')

const INTENTS: { id: Intent; match: RegExp }[] = [
  { id: 'fix', match: /\b(arregla|arreglar|corrige|corregir|falla|fallo|error|bug|rompe|roto|crash|excepcion|exception|fix|broken|fails|failing)\b/ },
  { id: 'change', match: /\b(que (siempre|se pueda|pueda|haya|aparezca|salga|funcione|se muestre|se vea)|haz que|quiero que|me gustaria|necesito que|deberia|podrias|seria bueno|cambia|modifica|ajusta|permite|siempre|make it|let|should|always|would like|need it to)\b/ },
  { id: 'test', match: /\b(test|tests|prueba|pruebas|cobertura|coverage|unit|spec)\b/ },
  { id: 'review', match: /\b(revisa|revisar|audita|auditar|review|audit|critica|code review)\b/ },
  { id: 'refactor', match: /\b(refactor|refactoriza|refactorizar|limpia|limpiar|reorganiza|renombra|simplifica)\b/ },
  { id: 'explain', match: /\b(explica|explicame|explicar|como funciona|que hace|entiende|explain|how does|how do)\b/ },
  { id: 'design', match: /\b(disena|disenar|diseno|arquitectura|plan|propone|propuesta|design|architecture)\b/ },
  { id: 'feature', match: /\b(anade|agrega|crea|crear|implementa|implementar|construye|add|create|implement|build)\b/ },
]

export function detectIntent(text: string): Intent {
  const value = normalize(text)
  for (const intent of INTENTS) if (intent.match.test(value)) return intent.id
  return 'ask'
}

// ---------- rúbrica ----------

// Chips de adjuntos del compositor ([Image #2], [Pasted text #1 +40 lines]).
export const ATTACHMENT = /\[(?:Image|Pasted text) #\d+[^\]]*\]/g

const EXT = 'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|c|cpp|h|css|scss|html|vue|svelte|md|sql|json|ya?ml|toml|sh|env'
const PATH = new RegExp(String.raw`(?:~\/|\.{1,2}\/|\/)?[\w.-]+(?:\/[\w.-]+)+|\b[\w-]+\.(?:${EXT})\b`, 'g')
const MENTION = /@[\w./-]+/g
const CODE = /`([^`\n]{2,80})`/g
const SYMBOL = /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-zA-Z_]\w*\(\))/g

/** Rutas, @menciones, `código` y símbolos del texto: dónde tiene que actuar el agente. */
export function anchorsOf(text: string, cwd = ''): string[] {
  const raw = String(text || '').replace(ATTACHMENT, ' ')
  const found = new Set<string>()
  for (const re of [PATH, MENTION, SYMBOL]) for (const m of raw.matchAll(re)) found.add(m[0])
  for (const m of raw.matchAll(CODE)) if (m[1]) found.add(m[1])
  // El directorio del proyecto ya lo sabe el agente: repetirlo no concreta nada.
  return [...found].filter(a => a.length > 2 && !(cwd && (cwd === a || cwd.startsWith(a) || cwd.endsWith(a.replace(/^\//, '')))))
}

const has = (re: RegExp, text: string) => re.test(text)
const count = (re: RegExp, text: string) => new Set((text.match(re) || []).map(s => s.trim())).size

/**
 * Puntúa un prompt contra la rúbrica. `known` es lo que el agente ya tiene a mano (borrador original y
 * conversación): una ruta o símbolo de la propuesta solo cuenta como contexto si aparece ahí, para que
 * inventarse una ruta no suba la nota.
 */
export function assess(text: string, opts: { known?: string; cwd?: string; lang?: Lang } = {}): Assessment {
  const trimmed = String(text || '').trim()
  const lang = opts.lang ?? langOf(trimmed)
  const w = WHY[lang]
  const n = normalize(trimmed)
  const words = trimmed.split(/\s+/).filter(Boolean).length
  const intent = detectIntent(trimmed)
  const criteria: Criterion[] = []
  const add = (id: CriterionId, points: number, why?: string) => criteria.push({ id, points, max: MAX[id], why: points < MAX[id] ? why : undefined })

  // Objetivo: qué conseguir, con verbo y objeto.
  if (words < 4) add('objetivo', 0, w.short)
  else if (words < 8 || (intent === 'ask' && words < 12)) add('objetivo', 10, w.brief)
  else add('objetivo', 20)

  // Contexto: dónde actuar, verificado contra lo que el agente ya sabe.
  const anchors = anchorsOf(trimmed, opts.cwd)
  const known = opts.known ?? trimmed
  const verified = anchors.filter(a => known.includes(a))
  const discovery = has(/\b(localiza|busca|encuentra|identifica|averigua|find|locate|search for|identify)\b/, n)
  const scoped = has(/\b(pantalla|vista|modulo|componente|endpoint|servicio|funcion|clase|tabla|pagina|formulario|boton|hook|widget|app|script|hook|screen|view|module|component|service|function|class|page|form|button|api|repo|proyecto|project)\b/, n)
  if (verified.length) add('contexto', 15)
  else if (discovery || scoped) add('contexto', 8, anchors.length ? w.unverified : discovery ? w.discovery : w.vagueScope)
  else add('contexto', anchors.length ? 5 : 0, anchors.length ? w.unverified : w.noAnchor)

  // Detalle concreto: hechos que acotan la tarea.
  const detail = [
    /"[^"\n]{3,}"|«[^»\n]{3,}»|“[^”\n]{3,}”/.test(trimmed),
    has(/\b\d+(?:[.,]\d+)?\s?(?:px|ms|s|%|mb|kb|gb|segundos|minutos|lineas|filas|elementos|usuarios|items|lines|rows|users|seconds|minutes)?\b/, n.replace(PATH, ' ')),
    has(/\b(error|excepcion|exception|traceback|stack trace|mensaje|message|log|warning|aviso)\b/, n),
    has(/\b(por ejemplo|ejemplo|p\. ?ej\.|e\.g\.|for example|example|caso)\b/, n),
    has(/\b(esperado|espero|deberia|en vez de|en lugar de|actualmente|ahora mismo|ahora|antes|despues|expected|should|instead of|currently|right now|before|after)\b/, n),
    new RegExp(ATTACHMENT.source).test(trimmed),
  ].filter(Boolean).length
  add('detalle', detail >= 2 ? 15 : detail === 1 ? 8 : 0, detail === 1 ? w.oneDetail : w.noDetail)

  // Criterio de aceptación: cómo se sabe que está hecho.
  const acceptStrong = has(/\b(criterio|aceptacion|hecho cuando|terminado cuando|esta listo cuando|definition of done|done when|acceptance)\b/, n)
  const acceptWeak = has(/\b(verifica|comprueba|comprobar|test|tests|prueba|pruebas|debe pasar|tiene que pasar|sin errores|check|verify|should pass|must pass|passes)\b/, n)
  add('aceptacion', acceptStrong && words >= 15 ? 20 : acceptStrong || acceptWeak ? 12 : 0, acceptStrong || acceptWeak ? w.weakAccept : w.noAccept)

  // Restricciones: qué no tocar y hasta dónde llegar.
  const limits = count(/\b(no toques|no cambies|no modifiques|no anadas|no uses|no rompas|no borres|no reescribas|no instales|sin anadir|sin cambiar|sin tocar|sin dependencias|sin romper|solo|unicamente|evita|manten|respeta|restricciones|alcance|nunca|don'?t|do not|only|without|avoid|keep|never|constraints|scope)\b/g, n)
  add('restricciones', limits >= 2 ? 15 : limits === 1 ? 8 : 0, limits === 1 ? w.oneLimit : w.noLimit)

  // Formato de respuesta: qué devuelve el agente al terminar.
  add('formato', has(/\b(formato|responde con|responde en|devuelve|devuelveme|entrega|resumen|resume|tabla|diff|en \d+ lineas|output|respond with|reply with|return|format|summary|table|bullet)\b/, n) ? 10 : 0, w.noFormat)

  // Claridad: sin referencias vagas ni huecos por rellenar.
  const vague = count(/\b(esto|eso|aquello|lo de|algo|hazlo|arreglalo|cosas|cosa|etc|stuff|thing|things|whatever|somehow)\b/g, n)
  const gaps = (trimmed.replace(ATTACHMENT, '').match(/\[[^\]\n]{1,60}\](?!\()/g) || []).length + count(/\b(rellena|fill in|tbd|xxx)\b/g, n)
  add('claridad', gaps ? 0 : vague === 0 ? 5 : vague === 1 ? 2 : 0, gaps ? w.gaps : w.vague)

  let score = criteria.reduce((sum, c) => sum + c.points, 0)
  if (gaps) score -= 10
  if (words > 350) score -= 5
  if (words < 4) score = Math.min(score, 20)
  score = Math.max(0, Math.min(100, score))
  return {
    score,
    weak: score < WEAK_BELOW && words > 0,
    intent,
    words,
    criteria,
    missing: criteria.filter(c => c.points < c.max),
  }
}

/** "contexto 8/15 (sin ruta concreta)", una por criterio incompleto. */
export function describeMissing(a: Assessment, lang: Lang): string[] {
  return a.missing.map(c => `${LABEL[lang][c.id]} ${c.points}/${c.max}${c.why ? ` (${c.why})` : ''}`)
}

// ---------- prompts del modelo ----------

export const SYSTEMS: Record<Lang, string> = {
  es: [
    'Eres un ingeniero de prompts senior. Reescribes el borrador de una persona para que un agente de código',
    'lo ejecute bien a la primera.',
    '',
    'El resultado se puntúa con esta rúbrica de 100 puntos. Cúbrela entera, con contenido real:',
    '- Objetivo (20): qué hay que conseguir, con verbo de acción y objeto.',
    '- Contexto (15): dónde actuar: ruta, archivo, `símbolo` o @mención. Solo cuenta si aparece en el borrador o',
    '  en la conversación: NUNCA inventes rutas ni nombres. Si no consta, pide al agente que lo localice primero.',
    '- Detalle (15): comportamiento actual y esperado, mensaje de error literal, ejemplo o cifra; al menos dos,',
    '  deducidos del borrador o de la conversación.',
    '- Criterio de aceptación (20): cómo se comprueba que está hecho: prueba, comando o caso concreto.',
    '- Restricciones (15): al menos dos: qué no tocar, alcance, dependencias.',
    '- Formato de respuesta (10): qué debe devolver el agente al terminar.',
    '- Claridad (5): sin referencias vagas («esto», «eso», «lo de», «algo») ni huecos entre corchetes.',
    '',
    'Reglas:',
    '- Conserva la intención; no añadas requisitos que no se deduzcan de ella.',
    '- Si hay conversación reciente, úsala para concretar (qué archivo, qué cambio, qué comando) sin repetirla.',
    '- Estructura fija, cada sección con su cabecera en su línea: Objetivo:, Contexto:, Detalle:,',
    '  Criterio de aceptación:, Restricciones:, Formato de respuesta:. Viñetas cortas. Máximo 220 palabras.',
    '- Si falta un dato, no lo inventes ni dejes corchetes: indica que el agente lo averigüe o lo pregunte.',
    '- No afirmes hechos del proyecto que no consten (nombres de archivos o tests, puertos, servicios, variables',
    '  de entorno, causas del fallo): pide al agente que los compruebe. Las restricciones prudentes sí valen.',
    '- Conserva tal cual [Image #N], [Pasted text #N ...], menciones @ruta y rutas de archivo.',
    '- Mismo idioma que el borrador. Nada de raya ni guion largo.',
    '',
    'Devuelve SOLO el prompt final, sin comentarios ni bloques de código.',
  ].join('\n'),
  en: [
    'You are a senior prompt engineer. Rewrite a person\'s draft so a coding agent gets it right first time.',
    '',
    'The result is scored with this 100-point rubric. Cover all of it, with real content:',
    '- Goal (20): what to achieve, with an action verb and an object.',
    '- Context (15): where to act: path, file, `symbol` or @mention. It only counts when it appears in the draft',
    '  or the conversation: NEVER invent paths or names. If it is missing, tell the agent to locate it first.',
    '- Detail (15): current and expected behaviour, literal error message, example or figure; at least two,',
    '  taken from the draft or the conversation.',
    '- Acceptance criteria (20): how to check it is done: a test, a command or a concrete case.',
    '- Constraints (15): at least two: what not to touch, scope, dependencies.',
    '- Response format (10): what the agent must return when it finishes.',
    '- Clarity (5): no vague references ("this", "that thing", "stuff") and no bracketed gaps.',
    '',
    'Rules:',
    '- Keep the intent; add no requirement that cannot be inferred from it.',
    '- With recent conversation, use it to make the request concrete (which file, change, command) without repeating it.',
    '- Fixed structure, each section header on its own line: Goal:, Context:, Detail:, Acceptance criteria:,',
    '  Constraints:, Response format:. Short bullets. At most 220 words.',
    '- If a fact is missing, do not invent it or leave brackets: tell the agent to find it out or ask.',
    '- Do not state project facts that are not given (file or test names, ports, services, environment',
    '  variables, causes of the failure): tell the agent to check them. Prudent constraints are fine.',
    '- Keep [Image #N], [Pasted text #N ...], @path mentions and file paths verbatim.',
    '- Same language as the draft. No em dashes.',
    '',
    'Return ONLY the final prompt, with no commentary and no code fences.',
  ].join('\n'),
}

/** Mensaje de usuario de la primera reescritura. */
export function rewritePrompt(draft: string, opts: { lang: Lang; cwd?: string; context?: string }): string {
  const project = opts.cwd ? `${opts.lang === 'es' ? 'Proyecto' : 'Project'}: ${projectName(opts.cwd)} (${opts.cwd})` : ''
  return [project, opts.context || '', `${opts.lang === 'es' ? 'Borrador a reescribir' : 'Draft to rewrite'}:\n${draft}`]
    .filter(Boolean).join('\n\n')
}

/**
 * Segunda pasada: solo si la primera dejó criterios incompletos que el modelo puede cubrir sin inventar.
 * Contexto y detalle dependen de datos: se piden solo si están en el borrador o la conversación.
 */
export function repairPrompt(draft: string, previous: string, a: Assessment, opts: { lang: Lang; cwd?: string; context?: string }): string {
  const es = opts.lang === 'es'
  const gaps = describeMissing(a, opts.lang).map(g => '- ' + g).join('\n')
  return [
    rewritePrompt(draft, opts),
    `${es ? 'Tu versión anterior' : 'Your previous version'} (${a.score}/100):\n${previous}`,
    es
      ? `Le falta:\n${gaps}\n\nDevuelve la versión corregida cubriendo esos puntos. Contexto y detalle solo con datos que estén en el borrador o en la conversación; si no están, no los inventes.`
      : `It is missing:\n${gaps}\n\nReturn the corrected version covering those points. Context and detail only with facts present in the draft or the conversation; if they are not there, do not invent them.`,
  ].join('\n\n')
}

/** Lo que una segunda pasada puede arreglar sin datos nuevos. */
export function isRepairable(a: Assessment): boolean {
  return a.missing.some(c => c.id !== 'contexto' && c.id !== 'detalle') || a.missing.some(c => c.points === 0)
}

export function recentContext(rows: readonly { role: string; text: string }[], lang: Lang): string {
  const tail = rows.filter(r => r.text.trim()).slice(-8)
  if (tail.length === 0) return ''
  const lines = tail.map(r => `${r.role}: ${r.text.replace(/\s+/g, ' ').trim().slice(0, 700)}`)
  return (lang === 'es' ? 'Conversación reciente (el agente ya la conoce):\n' : 'Recent conversation (the agent already knows it):\n') + lines.join('\n')
}

export function keepAttachments(original: string, proposalText: string): string {
  const missing = (original.match(ATTACHMENT) ?? []).filter(chip => !proposalText.includes(chip))
  return missing.length ? proposalText + '\n\n' + missing.join(' ') : proposalText
}

export function unfence(text: string): string {
  return text.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
}

export function projectName(cwd: string): string {
  const parts = String(cwd || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

// ---------- motor local (sin modelo) ----------

type Copy = {
  contexto: string; objetivo: string; necesito: string; aceptacion: string; alcance: string; salida: string
  proyecto: string; askBefore: string
  placeholder: Record<Intent, string>
  blocks: Record<'contexto' | 'objetivo' | 'pasos' | 'aceptacion' | 'restricciones' | 'formato', string>
  steps: Record<Intent, string[]>
  restriction: Record<Intent, string[]>
  output: Record<Intent, string[]>
  acceptance: Record<Intent, string[]>
}

const COPY: Record<Lang, Copy> = {
  es: {
    contexto: 'Contexto', objetivo: 'Objetivo', necesito: 'Qué necesito', aceptacion: 'Criterio de aceptación',
    alcance: 'Restricciones', salida: 'Formato de respuesta', proyecto: 'Proyecto',
    askBefore: 'Si falta un dato para hacerlo bien, pregúntalo antes de asumir.',
    placeholder: {
      fix: 'Rellena: resultado esperado, resultado actual y mensaje de error.',
      change: 'Rellena: cuándo debe estar disponible y qué debe pasar cuando no lo esté.',
      feature: 'Rellena: dónde debe vivir el cambio y cómo sabrás que funciona.',
      refactor: 'Rellena: qué significa "más legible" para ti y el criterio de aceptación.',
      test: 'Rellena: módulo o comportamiento a cubrir y qué riesgo te preocupa.',
      explain: 'Rellena: la parte que quieres entender y el nivel de detalle.',
      review: 'Rellena: alcance (archivos o PR) y qué te preocupa más.',
      design: 'Rellena: restricciones, escala esperada y qué no puede cambiar.',
      ask: 'Rellena: resultado esperado y resultado actual (mensaje de error si lo hay).',
    },
    blocks: { contexto: 'contexto del proyecto', objetivo: 'objetivo explícito', pasos: 'plan de trabajo', aceptacion: 'criterio de aceptación', restricciones: 'restricciones', formato: 'formato de salida' },
    steps: {
      fix: ['Localiza la causa raíz antes de tocar código y cita archivo y línea.', 'Aplica el arreglo mínimo; si hay varias opciones, elige una y justifícala en una frase.', 'Explica qué se rompía y por qué el cambio lo resuelve.', 'Añade o ajusta una prueba que falle antes del arreglo y pase después.'],
      change: ['Describe el comportamiento actual y el deseado, una frase cada uno.', 'Localiza el punto que decide ese comportamiento antes de editar.', 'Aplica el cambio mínimo y revisa los casos límite que toca.', 'Comprueba el antes y el después con un caso concreto.'],
      feature: ['Resume el enfoque y los archivos que vas a tocar antes de editar.', 'Implementa el cambio mínimo que cumpla el objetivo, sin extras.', 'Cubre el caso feliz y un caso límite con pruebas.', 'Señala en una línea cualquier decisión de diseño con trade-off.'],
      refactor: ['Define el criterio de terminado antes de editar.', 'Avanza en pasos pequeños y verificables.', 'Mantén el comportamiento observable idéntico; si cambia algo, dilo.', 'Ejecuta la suite tras cada paso relevante.'],
      test: ['Enumera los comportamientos a cubrir y los bordes que importan.', 'Escribe pruebas que fallen si el comportamiento se rompe.', 'No toques código de producción salvo que sea imprescindible y justifícalo.', 'Indica qué casos quedan fuera y por qué.'],
      explain: ['Explica el modelo mental, no línea a línea.', 'Señala entradas, salidas y efectos secundarios.', 'Da un ejemplo concreto de este repositorio.', 'Termina con las trampas o supuestos que suelen romperlo.'],
      review: ['Prioriza bugs y riesgos sobre estilo.', 'Cada hallazgo: severidad, archivo y línea, por qué importa y arreglo sugerido.', 'Si no hay hallazgos reales, dilo; no inventes.', 'No reescribas el código salvo que lo pida.'],
      design: ['Aclara requisitos y restricciones que falten.', 'Propón dos opciones con trade-offs y recomienda una.', 'Define interfaces y un plan por fases.', 'Cierra con los riesgos y cómo mitigarlos.'],
      ask: ['Reformula la petición en una frase para confirmar que la entiendes.', 'Responde lo pedido sin relleno.', 'Si falta un dato, pide solo ese dato.', 'Si hay varias interpretaciones, elige una y dilo.'],
    },
    restriction: {
      fix: ['No cambies comportamiento fuera del fallo.', 'No refactorices de paso.', 'No inventes reproducciones que no puedas verificar.'],
      change: ['No cambies otros flujos que compartan ese punto.', 'Mantén el comportamiento por defecto cuando no aplique.', 'Si afecta a rendimiento o permisos, dilo antes de aplicarlo.'],
      feature: ['Respeta la API pública existente.', 'Sin dependencias nuevas salvo que se pidan.', 'No reescribas módulos que no hagan falta.'],
      refactor: ['Sin cambios de comportamiento no pedidos.', 'Nada de renombrados masivos sin avisar.', 'No mezcles el refactor con features.'],
      test: ['No modifiques producción para que el test pase.', 'Sin mocks que oculten el comportamiento real.', 'Pruebas deterministas, sin red.'],
      explain: ['Sin inventar comportamiento no visible en el código.', 'Si algo no lo sabes por el código, dilo.', 'Sin volcar archivos enteros.'],
      review: ['No apliques cambios, solo informa.', 'No comentes estilo salvo que rompa una convención.', 'Cita evidencia, no impresiones.'],
      design: ['No implementes todavía, solo diseña.', 'Sin sobreingeniería: la opción más simple que funcione.', 'Explicita lo que queda fuera.'],
      ask: ['No asumas datos que no estén en el contexto.', 'Sin relleno ni disclaimers.', 'Una sola interpretación por respuesta.'],
    },
    output: {
      fix: ['Diagnóstico en 3 líneas.', 'Cambios: archivo, qué cambió y por qué.', 'Verificación: comando o prueba ejecutada y su resultado.'],
      change: ['Antes y después en una línea cada uno.', 'Cambios por archivo.', 'Cómo comprobarlo en la interfaz.'],
      feature: ['Plan breve.', 'Cambios por archivo.', 'Pruebas añadidas y resultado.', 'Riesgos o follow-ups.'],
      refactor: ['Plan por pasos.', 'Diff resumido por archivo.', 'Prueba de que el comportamiento no cambió.'],
      test: ['Tabla caso, entrada y resultado esperado.', 'Código de las pruebas.', 'Qué queda sin cubrir.'],
      explain: ['Resumen en 3 líneas.', 'Flujo paso a paso.', 'Ejemplo del repositorio.', 'Trampas.'],
      review: ['Tabla: severidad, ubicación, problema, arreglo.', 'Prioridad de los hallazgos.', 'Qué revisaste y qué no.'],
      design: ['Opciones con trade-offs.', 'Recomendación.', 'Plan por fases.', 'Riesgos.'],
      ask: ['Respuesta directa.', 'Pasos solo si hay acción.', 'Datos que faltan, si los hay.'],
    },
    acceptance: {
      fix: ['La reproducción falla antes y pasa después.', 'No hay cambios fuera del fallo.'],
      change: ['El comportamiento nuevo ocurre en el caso descrito.', 'El caso anterior sigue funcionando igual.'],
      feature: ['El flujo principal funciona de extremo a extremo.', 'Un caso límite está cubierto por una prueba.'],
      refactor: ['La suite pasa sin cambios de comportamiento.', 'El criterio de legibilidad acordado mejora.'],
      test: ['Las pruebas fallan si el comportamiento se rompe.', 'No hay mocks que oculten la integración.'],
      explain: ['Se entiende sin abrir el código.', 'Incluye un ejemplo verificable.'],
      review: ['Cada hallazgo cita archivo y línea.', 'No se inventan problemas.'],
      design: ['Hay dos opciones con trade-offs.', 'El plan se puede ejecutar por fases.'],
      ask: ['La respuesta se puede verificar.', 'No hay suposiciones sin marcar.'],
    },
  },
  en: {
    contexto: 'Context', objetivo: 'Goal', necesito: 'What I need', aceptacion: 'Acceptance criteria',
    alcance: 'Constraints', salida: 'Response format', proyecto: 'Project',
    askBefore: 'If a missing detail matters, ask before assuming.',
    placeholder: {
      fix: 'Fill in: expected result, actual result and the error message.',
      change: 'Fill in: when it must be available and what happens when it is not.',
      feature: 'Fill in: where the change should live and how you will know it works.',
      refactor: 'Fill in: what "more readable" means to you and the acceptance criterion.',
      test: 'Fill in: module or behaviour to cover and the risk you care about.',
      explain: 'Fill in: the part you want to understand and the level of detail.',
      review: 'Fill in: scope (files or PR) and what worries you most.',
      design: 'Fill in: constraints, expected scale and what cannot change.',
      ask: 'Fill in: expected result and actual result (error message if any).',
    },
    blocks: { contexto: 'project context', objetivo: 'explicit goal', pasos: 'work plan', aceptacion: 'acceptance criteria', restricciones: 'constraints', formato: 'output format' },
    steps: {
      fix: ['Find the root cause before touching code and name file and line.', 'Apply the smallest fix; if several options exist, pick one and justify it in one sentence.', 'Explain what was broken and why the change fixes it.', 'Add or adjust a test that fails before the fix and passes after.'],
      change: ['Describe current behaviour and desired behaviour, one sentence each.', 'Find the point that decides that behaviour before editing.', 'Apply the smallest change and review the edge cases it touches.', 'Check before and after with one concrete case.'],
      feature: ['Summarise the approach and the files you will touch before editing.', 'Implement the smallest change that meets the goal, nothing extra.', 'Cover the happy path and one edge case with tests.', 'Flag any design trade-off in one line.'],
      refactor: ['Define done before editing.', 'Move in small, verifiable steps.', 'Keep observable behaviour identical; if anything changes, say so.', 'Run the suite after each relevant step.'],
      test: ['List the behaviours to cover and the edges that matter.', 'Write tests that fail when the behaviour breaks.', 'Do not touch production code unless unavoidable, and justify it.', 'State what stays out of scope and why.'],
      explain: ['Explain the mental model, not line by line.', 'Name inputs, outputs and side effects.', 'Give one concrete example from this repository.', 'Finish with the traps or assumptions that break it.'],
      review: ['Prioritise bugs and risks over style.', 'Each finding: severity, file and line, why it matters, suggested fix.', 'If there are no real findings, say so; do not invent.', 'Do not rewrite the code unless asked.'],
      design: ['Surface missing requirements and constraints.', 'Propose two options with trade-offs and recommend one.', 'Define interfaces and a phased plan.', 'Close with risks and mitigations.'],
      ask: ['Restate the request in one sentence to confirm you understood it.', 'Answer what was asked without filler.', 'If a detail is missing, ask for just that detail.', 'If there are several readings, pick one and say so.'],
    },
    restriction: {
      fix: ['Do not change behaviour outside the failure.', 'Do not refactor along the way.', 'Do not invent reproductions you cannot verify.'],
      change: ['Do not change other flows that share that point.', 'Keep the default behaviour where it does not apply.', 'If it affects performance or permissions, say so before applying.'],
      feature: ['Respect the existing public API.', 'No new dependencies unless asked.', 'Do not rewrite modules you do not need.'],
      refactor: ['No unrequested behaviour changes.', 'No mass renames without warning.', 'Do not mix the refactor with features.'],
      test: ['Do not change production code to make a test pass.', 'No mocks that hide real behaviour.', 'Deterministic tests, no network.'],
      explain: ['Do not invent behaviour that is not in the code.', 'If the code does not tell you, say so.', 'Do not dump whole files.'],
      review: ['Do not apply changes, only report.', 'Do not comment on style unless it breaks a convention.', 'Cite evidence, not impressions.'],
      design: ['Do not implement yet, only design.', 'No over-engineering: the simplest option that works.', 'Make the out-of-scope explicit.'],
      ask: ['Do not assume facts that are not in the context.', 'No filler or disclaimers.', 'One interpretation per answer.'],
    },
    output: {
      fix: ['Diagnosis in 3 lines.', 'Changes: file, what changed and why.', 'Verification: command or test run and its result.'],
      change: ['Before and after in one line each.', 'Changes per file.', 'How to check it in the interface.'],
      feature: ['Short plan.', 'Changes per file.', 'Tests added and result.', 'Risks or follow-ups.'],
      refactor: ['Plan by steps.', 'Summarised diff per file.', 'Proof that behaviour did not change.'],
      test: ['Table: case, input, expected result.', 'Test code.', 'What stays uncovered.'],
      explain: ['Summary in 3 lines.', 'Step-by-step flow.', 'Example from the repository.', 'Traps.'],
      review: ['Table: severity, location, problem, fix.', 'Priority of findings.', 'What you reviewed and what you did not.'],
      design: ['Options with trade-offs.', 'Recommendation.', 'Phased plan.', 'Risks.'],
      ask: ['Direct answer.', 'Steps only if there is an action.', 'Missing data, if any.'],
    },
    acceptance: {
      fix: ['The reproduction fails before and passes after.', 'Nothing changes outside the failure.'],
      change: ['The new behaviour happens in the described case.', 'The previous case keeps working the same way.'],
      feature: ['The main flow works end to end.', 'One edge case is covered by a test.'],
      refactor: ['The suite passes with no behaviour change.', 'The agreed readability criterion improves.'],
      test: ['The tests fail when the behaviour breaks.', 'No mocks hide the integration.'],
      explain: ['It is understandable without opening the code.', 'It includes a verifiable example.'],
      review: ['Every finding cites file and line.', 'No invented problems.'],
      design: ['Two options with trade-offs exist.', 'The plan can be executed in phases.'],
      ask: ['The answer can be verified.', 'No unmarked assumptions.'],
    },
  },
}

function cleanRequest(text: string): string {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim().replace(/^(y|e|o|pero|and|but|also)\s+/i, '')
  if (!collapsed) return ''
  const first = collapsed.charAt(0).toUpperCase() + collapsed.slice(1)
  return /[.!?]$/.test(first) ? first : first + '.'
}

export function buildPrompt(text: string, cwd: string) {
  const lang: Lang = langOf(text)
  const copy = COPY[lang]
  const intent = detectIntent(text)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const anchored = anchorsOf(text, cwd).length > 0
  const lines: string[] = []
  const changes: string[] = []

  if (cwd) {
    changes.push(copy.blocks.contexto)
    const name = projectName(cwd)
    lines.push(copy.contexto, '- ' + copy.proyecto + ': ' + (name ? name + ' (' + cwd + ')' : cwd), '')
  }
  changes.push(copy.blocks.objetivo)
  lines.push(copy.objetivo, cleanRequest(text))
  if (intent === 'ask' || (words < 10 && !anchored)) lines.push(copy.placeholder[intent])
  lines.push('')
  changes.push(copy.blocks.pasos)
  lines.push(copy.necesito, ...copy.steps[intent].map((step, i) => i + 1 + '. ' + step), '')
  changes.push(copy.blocks.aceptacion)
  lines.push(copy.aceptacion, ...copy.acceptance[intent].map(item => '- ' + item), '')
  changes.push(copy.blocks.restricciones)
  lines.push(copy.alcance, ...copy.restriction[intent].map(rule => '- ' + rule))
  if (intent !== 'ask') lines.push('- ' + copy.askBefore)
  lines.push('')
  changes.push(copy.blocks.formato)
  lines.push(copy.salida, ...copy.output[intent].map(item => '- ' + item))

  return { prompt: lines.join('\n').trim(), changes, intent, lang }
}
