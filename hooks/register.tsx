import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { Lang, Proposal } from '../types'

const PANE = 'prompt-coach'
const WEAK_BELOW = 60
const MAX_DRAFT = 8000

const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, '')
const proposal = atom({ plugin: 'prompt-coach', key: 'proposal' } as const, null, {
  shape: 'proposal-1',
})

// ---------- motor local (determinista) ----------

type Intent = 'fix' | 'change' | 'test' | 'review' | 'refactor' | 'explain' | 'design' | 'feature' | 'ask'

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function isSpanish(text: string): boolean {
  const value = ' ' + normalize(text) + ' '
  const es = (value.match(/\b(el|la|los|las|de|que|para|con|una|un|esto|eso|pero|como|mas|sin)\b/g) || []).length
  const en = (value.match(/\b(the|and|for|with|this|that|from|into|should|please|need|make)\b/g) || []).length
  return es >= en
}

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

function detectIntent(text: string): Intent {
  const value = normalize(text)
  for (const intent of INTENTS) if (intent.match.test(value)) return intent.id
  return 'ask'
}

export function assess(text: string) {
  const trimmed = String(text || '').trim()
  const words = trimmed.split(/\s+/).filter(Boolean)
  let score = 42
  if (words.length >= 6) score += 8
  if (words.length >= 15) score += 8
  if (words.length > 70) score -= 6
  if (/[.;:]\s/.test(trimmed)) score += 4
  if (/(\/|@|\.(ts|tsx|js|jsx|py|go|rs|java|css|md|sql|json)\b)/i.test(trimmed)) score += 8
  if (/(archivo|fichero|ruta|carpeta|file|path|folder)/i.test(trimmed)) score += 6
  if (/(formato|json|tabla|lista|codigo|diff|resumen|md|markdown|format|table)/i.test(trimmed)) score += 8
  if (/(no |sin |solo |sólo |maximo|máximo|evita|no toques|without|only|avoid)/i.test(trimmed)) score += 6
  if (/(verifica|verificar|comprueba|prueba|criterio|aceptacion|aceptación|verif|acceptance|check)/i.test(trimmed)) score += 6
  if (/\b(esto|eso|aquello|algo|lo de|mejorar|hazlo|arreglalo|rapido|it|this|stuff|thing)\b/.test(normalize(trimmed))) score -= 9
  if (words.length < 5) score -= 14
  score = Math.max(5, Math.min(95, score))
  return { score, weak: score < WEAK_BELOW && words.length > 0, intent: detectIntent(trimmed), words: words.length }
}

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

function projectName(cwd: string): string {
  const parts = String(cwd || '').split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

export function buildPrompt(text: string, cwd: string) {
  const lang: Lang = isSpanish(text) ? 'es' : 'en'
  const copy = COPY[lang]
  const intent = detectIntent(text)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const anchored = /[\/@]|\.(ts|tsx|js|jsx|py|go|rs|java|css|md|sql|json)\b/i.test(text)
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

// ---------- modelo ----------

const SYSTEMS: Record<Lang, string> = {
  es: [
    'Eres un ingeniero de prompts senior. Reescribes la petición de una persona para que un agente de código',
    'la ejecute bien a la primera. Trabajas rápido y sin relleno.',
    '',
    'Reglas:',
    '- Conserva intacta la intención; no añadas requisitos que no se deduzcan de ella.',
    '- Si hay conversación reciente, el agente ya la conoce: no repitas contexto, proyecto ni restricciones que ya',
    '  estén dichos. Usa esa conversación para concretar la petición (qué cambio, qué archivo, qué comando) en vez',
    '  de dejar huecos. Solo deja un hueco entre corchetes si el dato no está en ningún sitio.',
    '- Sin conversación previa, añade lo mínimo que el agente necesita: contexto en una línea, objetivo, criterio',
    '  de aceptación y formato de respuesta.',
    '- Añade lo que la persona suele olvidar y aquí falta: criterio de aceptación verificable, qué no tocar,',
    '  cómo comprobarlo, y «si falta un dato, pregunta antes de asumir». Una línea por cosa, solo si aporta.',
    '- Usa solo las secciones que aporten; omite las vacías. En una conversación en curso, entre 40 y 120',
    '  palabras; sin conversación, máximo 200.',
    '- Conserva tal cual, sin cambiarlos ni quitarlos, los adjuntos y referencias del borrador: `[Image #N]`,',
    '  `[Pasted text #N ...]`, menciones `@ruta` y rutas de archivo.',
    '- Mismo idioma que el borrador. Nada de raya ni guion largo.',
    '',
    'Devuelve SOLO el prompt final, sin comentarios ni bloques de código.',
  ].join('\n'),
  en: [
    'You are a senior prompt engineer. Rewrite the user request so a coding agent gets it right first time.',
    'Work fast, no filler.',
    '',
    'Rules:',
    '- Keep the intent intact; add no requirement that cannot be inferred from it.',
    '- When there is recent conversation, the agent already knows it: do not repeat context, project or',
    '  constraints already stated. Use that conversation to make the request concrete (which change, which',
    '  file, which command) instead of leaving gaps. Leave a bracketed gap only when the fact is nowhere.',
    '- With no prior conversation, add the minimum the agent needs: one line of context, goal, acceptance',
    '  criterion and response format.',
    '- Add what people usually forget and is missing here: a verifiable acceptance criterion, what not to',
    '  touch, how to check it, and "ask before assuming if a detail is missing". One line each, only if useful.',
    '- Use only the sections that add value; omit empty ones. In an ongoing conversation, 40 to 120 words;',
    '  with no conversation, at most 200.',
    '- Keep the draft\'s attachments and references verbatim, never changed or dropped: `[Image #N]`,',
    '  `[Pasted text #N ...]`, `@path` mentions and file paths.',
    '- Same language as the draft. No em dashes.',
    '',
    'Return ONLY the final prompt, with no commentary and no code fences.',
  ].join('\n'),
}

// Las últimas filas de la conversación, recortadas, para que la propuesta no repita lo que el agente ya sabe.
function recentContext(rows: readonly { role: string; text: string }[], lang: Lang): string {
  const tail = rows.filter(r => r.text.trim()).slice(-8)
  if (tail.length === 0) return ''
  const lines = tail.map(r => `${r.role}: ${r.text.replace(/\s+/g, ' ').trim().slice(0, 700)}`)
  return (lang === 'es' ? 'Conversación reciente (el agente ya la conoce):\n' : 'Recent conversation (the agent already knows it):\n') + lines.join('\n')
}

// Chips de adjuntos del compositor ([Image #2], [Pasted text #1 +40 lines]); si la propuesta los pierde, se pierde el adjunto.
const ATTACHMENT = /\[(?:Image|Pasted text) #\d+[^\]]*\]/g

function keepAttachments(original: string, proposalText: string): string {
  const missing = (original.match(ATTACHMENT) ?? []).filter(chip => !proposalText.includes(chip))
  return missing.length ? proposalText + '\n\n' + missing.join(' ') : proposalText
}

function unfence(text: string): string {
  return text.trim().replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
}

// ---------- textos de la interfaz ----------

const UI = {
  es: {
    weak: 'Prompt flojo', solid: 'Prompt sólido', improve: 'Mejorar prompt', refine: 'Afinar',
    hint: '/coach para mejorarlo', busy: 'Mejorando con el modelo…', proposal: 'Propuesta',
    fromModel: 'modelo', fromLocal: 'reglas locales', added: 'Añade', apply: 'Sustituir borrador',
    applied: 'Borrador sustituido', undo: 'Deshacer', again: 'Mejorar de nuevo', copy: 'Copiar',
    cancel: 'Cancelar', send: 'Enviar propuesta', sendOriginal: 'Enviar original', copied: 'Propuesta copiada', notCopied: 'No se pudo copiar',
    held: 'Retenido, no se ha enviado. En el panel: Enviar propuesta, Enviar original, Mejorar de nuevo o Cancelar.',
    notFilled: 'No se pudo escribir en el borrador', ready: 'Prompt Coach: propuesta lista en el panel.',
    empty: 'Escribe primero un borrador, o pásalo como argumento: /coach <petición>',
    idle: 'Prompt Coach: escribe un borrador y pulsa «Mejorar prompt» o /coach',
    tooLong: 'El borrador supera los 8000 caracteres.',
    noModel: 'El modelo no respondió', emptyReply: 'El modelo devolvió una respuesta vacía',
    timeout: 'El modelo tardó demasiado (30 s)',
  },
  en: {
    weak: 'Weak prompt', solid: 'Solid prompt', improve: 'Improve prompt', refine: 'Refine',
    hint: '/coach to improve it', busy: 'Improving with the model…', proposal: 'Proposal',
    fromModel: 'model', fromLocal: 'local rules', added: 'Adds', apply: 'Replace draft',
    applied: 'Draft replaced', undo: 'Undo', again: 'Improve again', copy: 'Copy',
    cancel: 'Cancel', send: 'Send proposal', sendOriginal: 'Send original', copied: 'Proposal copied', notCopied: 'Could not copy',
    held: 'Held, not sent. In the pane: Send proposal, Send original, Improve again or Cancel.',
    notFilled: 'Could not write the draft', ready: 'Prompt Coach: proposal ready in the pane.',
    empty: 'Type a draft first, or pass it as an argument: /coach <request>',
    idle: 'Prompt Coach: type a draft and press "Improve prompt" or /coach',
    tooLong: 'The draft exceeds 8000 characters.',
    noModel: 'The model did not answer', emptyReply: 'The model returned an empty reply',
    timeout: 'The model took too long (30 s)',
  },
} as const

const langOf = (text: string): Lang => (isSpanish(text) ? 'es' : 'en')
const isCoachable = (text: string) => text.trim().length > 0 && !text.trimStart().startsWith('/')

function failureNote(r: ModelCompleteResult, lang: Lang): string {
  const t = UI[lang]
  if (r.isAnswered) return t.emptyReply
  if (r.reason === 'api-error') return `${t.noModel} (${r.error}${r.status ? ' ' + r.status : ''})`
  if (r.reason === 'aborted') return t.timeout
  return t.emptyReply
}

// ---------- acciones ----------

// Lo que la persona teclea en el editor del panel; no es estado para no redibujar a cada tecla.
let edited: string | null = null
// Última propuesta calculada, para devolverla como salida del comando donde no hay banda.
let improved = ''

// True en terminal y escritorio, donde la banda sobre el prompt dibuja la puntuación y el botón.
// Sin banda (VS Code, móvil) el panel se abre al arrancar y hace de banda.
let hasBand = false

async function improve($: EngineInterface, text: string) {
  const lang = langOf(text)
  const before = assess(text).score
  const cwd = await $.session.cwd()
  edited = null
  await update($, proposal, () => ({
    original: text, text: '', lang, before, after: before, origin: 'local', changes: [], isBusy: true, isApplied: false,
  }))
  await $.ui.open({ id: PANE, title: 'Prompt Coach', focus: true, closeOnEscape: true, rows: 24 }).catch(() => undefined)

  // ponytail: Sonnet fijo por coste y velocidad; configurable vía userConfig si algún día hace falta.
  const model = 'sonnet'
  const copy = COPY[lang]
  const context = recentContext(await $.session.messages(), lang)
  const r = await $.model.complete({
    model,
    system: SYSTEMS[lang],
    prompt: [
      `${copy.proyecto}: ${projectName(cwd)} (${cwd})`,
      context,
      `${lang === 'es' ? 'Borrador a reescribir' : 'Draft to rewrite'}:\n${text}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 600,
    effort: 'low',
    timeoutMs: 30_000,
  })
  const fromModel = r.isAnswered ? unfence(r.text) : ''
  const local = fromModel ? null : buildPrompt(text, cwd)
  const out = keepAttachments(text, fromModel || local!.prompt)
  improved = out
  await update($, proposal, p =>
    p && p.original === text
      ? {
          ...p,
          text: out,
          after: assess(out).score,
          origin: fromModel ? 'model' : 'local',
          model: fromModel ? model : undefined,
          note: fromModel ? undefined : failureNote(r, lang),
          changes: local ? local.changes : [],
          isBusy: false,
        }
      : p,
  )
}

async function apply($: EngineInterface, text?: string) {
  const p = await read($, proposal)
  if (!p || p.isBusy) return
  const final = text ?? edited ?? p.text
  const filled = await $.prompt.fill({ text: final })
  if (!filled.isFilled) return $.ui.toast(UI[p.lang].notFilled)
  await update($, proposal, q => (q ? { ...q, text: final, isApplied: true } : q))
}

async function undo($: EngineInterface) {
  const p = await read($, proposal)
  if (!p) return
  await $.prompt.fill({ text: p.original })
  await update($, proposal, q => (q ? { ...q, isApplied: false } : q))
}

// Descarta la propuesta. Donde hay banda (terminal, escritorio) el panel se abrió a demanda y se cierra;
// en VS Code el panel es fijo, con el botón, y solo vuelve al estado inicial.
const tone = (score: number) => (score < WEAK_BELOW ? 'warning' : 'success')

// ponytail: sondeo del compositor cada segundo porque la extensión de VS Code no envía prompt.edit; quitar cuando lo envíe.
const POLL_MS = 1000
let isPolling = false
let lastPolled: string | null = null
async function pollComposer($: EngineInterface) {
  const box = await $.prompt.read().catch(() => null)
  if (!box || box.text === lastPolled) return
  lastPolled = box.text
  await update($, draft, () => box.text)
}
function startPoll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  $.clock.every(POLL_MS, () => { void pollComposer($) })
}

// $.prompt.submit no pasa por el compositor: se vacía antes para que no quede el borrador viejo.
async function sendAs($: EngineInterface, text: string) {
  await $.prompt.fill({ text: '' }).catch(() => undefined)
  await dismiss($)
  await $.prompt.submit({ text })
}

// VS Code: el compositor de la extensión no manda teclas, así que el botón lee el borrador al pulsarlo.
async function improveFromBox($: EngineInterface) {
  const text = (await $.prompt.read()).text.trim()
  const t = UI[langOf(text)]
  if (!isCoachable(text)) return $.ui.toast(t.empty)
  if (text.length > MAX_DRAFT) return $.ui.toast(t.tooLong)
  await improve($, text)
}

async function dismiss($: EngineInterface) {
  edited = null
  await update($, proposal, () => null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

// Lo que hay en el compositor: teclear llega por prompt.edit, lo demás (historial, fill, clear) por prompt.change.
async function onDraft($: EngineInterface, text: string, isOwnFill: boolean) {
  await update($, draft, () => text)
  if (!isOwnFill && (await read($, proposal))) void dismiss($)
  if (hasBand) return
  if (!isCoachable(text)) return $.ui.status(undefined)
  const a = assess(text)
  const t = UI[langOf(text)]
  $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100 · ${t.hint}`)
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    hasBand = e.surface === 'terminal' || e.surface === 'desktop'
    await $.command.register({
      name: 'coach',
      description: 'Prompt Coach: mejora el borrador del prompt con el modelo (o con reglas locales)',
    })
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    await onDraft($, r.text, false)
    return r
  })

  on('prompt.change', async ($, e, next) => {
    await onDraft($, e.text, e.origin.kind === 'plugin' && e.origin.name === 'prompt-coach')
    return next(e)
  })

  // Sin banda (VS Code) el motor no ve las teclas: el único momento de ofrecer la mejora es el Enter.
  // Se retiene solo un prompt flojo con intención de trabajo (no preguntas ni respuestas cortas), sin adjuntos.
  on('prompt.submit', async ($, e, next) => {
    if (hasBand || e.command || e.isMeta || e.attachments?.length) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'sdk') return next(e)
    const text = e.text.trim()
    if (!isCoachable(text)) return next(e)
    const a = assess(text)
    const t = UI[langOf(text)]
    if (!a.weak || a.intent === 'ask' || a.words < 3) {
      $.ui.status(`${a.weak ? t.weak : t.solid} ${a.score}/100`)
      return next(e)
    }
    await improve($, text)
    return { drop: `Prompt Coach: ${t.weak} ${a.score}/100 → ${assess(improved).score}/100. ${t.held}\n\n${improved}` }
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const typed = e.args.trim()
    const text = (typed || (await $.prompt.read()).text).trim()
    const t = UI[langOf(text)]
    if (!isCoachable(text)) return { text: t.empty }
    if (text.length > MAX_DRAFT) return { text: t.tooLong }
    if (hasBand) {
      void improve($, text)
      return { text: t.ready }
    }
    await improve($, text)
    return { text: `${t.ready}\n\n${improved}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      startPoll($)
      const cols = e.props.bodyColumns
      if (e.props.hasSurvey) return next(e)
      if (await read($, proposal)) return next(e)
      const text = await read($, draft)
      if (!isCoachable(text)) return next(e)
      const a = assess(text)
      const t = UI[langOf(text)]
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexWrap="wrap" alignItems="center" gap={1}>
          <Text tabular>
            <Text color={tone(a.score)} weight="semibold">{a.score}</Text>
            <Text dimColor>/100</Text>
          </Text>
          {cols >= 40 && <Text color={tone(a.score)}>{a.weak ? t.weak : t.solid}</Text>}
          <Button
            key="improve"
            label={a.weak ? t.improve : t.refine}
            variant={a.weak ? 'primary' : 'secondary'}
            dimColor={!a.weak}
            onPress={() => improveFromBox($)}
          />
        </Box>
      )
    }
    const text = await read($, draft)
    const why = e.props.hasSurvey ? 'pass:survey' : !isCoachable(text) ? 'pass:empty' : 'draw'
    if (why !== 'draw') return next(e)
    const a = assess(text)
    const t = UI[langOf(text)]
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text color={a.weak ? 'warning' : 'success'}>{a.weak ? t.weak : t.solid}</Text>
        <Text dimColor>{a.score}/100</Text>
        <Button
          key="improve"
          label={a.weak ? t.improve : t.refine}
          hotkey="m"
          variant={a.weak ? 'primary' : 'secondary'}
          onPress={async () => improve($, (await $.prompt.read()).text.trim())}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await read($, proposal)
    if (e.surface === 'vscode' || e.surface === 'mobile') {
      const { Box, Button, Text } = $.ui.resolve(e)
      if (!p) return <Text dimColor>{UI.es.idle}</Text>
      const t = UI[p.lang]
      if (p.isBusy) return <Text dimColor>{t.busy}</Text>
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexWrap="wrap" gap={1}>
            <Text weight="semibold">{t.proposal}</Text>
            <Text tabular>
              <Text color={tone(p.before)} weight="semibold">{p.before}</Text>
              <Text dimColor> → </Text>
              <Text color={tone(p.after)} weight="semibold">{p.after}</Text>
              <Text dimColor>/100</Text>
            </Text>
            <Text dimColor>{p.origin === 'model' ? `${t.fromModel}: ${p.model}` : t.fromLocal}</Text>
          </Box>
          {p.note !== undefined && <Text color="warning">{p.note}</Text>}
          <Box flexWrap="wrap" gap={1}>
            <Button key="send" label={t.send} variant="primary" onPress={() => sendAs($, p.text)} />
            {p.isApplied ? (
              <Button key="undo" label={t.undo} onPress={() => undo($)} />
            ) : (
              <Button key="apply" label={t.apply} onPress={() => apply($)} />
            )}
            <Button key="again" label={t.again} onPress={() => improve($, p.original)} />
            <Button key="send-original" label={t.sendOriginal} onPress={() => sendAs($, p.original)} />
            <Button key="cancel" label={t.cancel} onPress={() => dismiss($)} />
          </Box>
          {p.isApplied && <Text color="success" size="caption">{t.applied}</Text>}
          <Box flexDirection="column">
            {p.text.split('\n').map((line, i) => <Text key={`l${i}`}>{line || ' '}</Text>)}
          </Box>
        </Box>
      )
    }
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    if (!p) {
      const text = await read($, draft)
      if (!isCoachable(text)) return <Text dimColor>{UI.es.idle}</Text>
      const a = assess(text)
      const t = UI[langOf(text)]
      return (
        <Box gap={1}>
          <Text color={a.weak ? 'warning' : 'success'}>{a.weak ? t.weak : t.solid}</Text>
          <Text dimColor>{a.score}/100</Text>
          <Button
            key="improve"
            label={a.weak ? t.improve : t.refine}
            hotkey="m"
            variant={a.weak ? 'primary' : 'secondary'}
            onPress={async () => improve($, (await $.prompt.read()).text.trim())}
          />
        </Box>
      )
    }
    const t = UI[p.lang]
    if (p.isBusy) return <Text dimColor>{t.busy}</Text>
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Text bold>{t.proposal}</Text>
          <Text dimColor>{p.before}/100 → {p.after}/100</Text>
          <Text color={p.origin === 'model' ? 'success' : 'warning'}>
            {p.origin === 'model' ? `${t.fromModel}: ${p.model}` : t.fromLocal}
          </Text>
        </Box>
        {p.note !== undefined && <Text color="warning">{p.note}</Text>}
        {p.changes.length > 0 && <Text dimColor>{t.added}: {p.changes.join(', ')}</Text>}
        <Input
          key="proposal"
          value={p.text}
          rows={14}
          submitLabel={t.apply}
          onInput={value => { edited = value }}
          onSubmit={value => apply($, value)}
        />
        <Box gap={1}>
          {p.isApplied ? (
            <Text color="success">{t.applied}</Text>
          ) : (
            <Button key="apply" label={t.apply} hotkey="s" variant="primary" onPress={() => apply($)} />
          )}
          {p.isApplied && <Button key="undo" label={t.undo} hotkey="d" onPress={() => undo($)} />}
          {p.isApplied && <Button key="again" label={t.again} hotkey="m" onPress={() => improve($, edited ?? p.text)} />}
          <Button
            key="copy"
            label={t.copy}
            hotkey="c"
            onPress={async press => {
              const copied = await $.ui.copy({ text: edited ?? p.text, surface: press.surface })
              $.ui.toast(copied.isCopied ? t.copied : t.notCopied)
            }}
          />
          <Button key="cancel" label={t.cancel} hotkey="x" onPress={() => dismiss($)} />
        </Box>
      </Box>
    )
  })
}
