// Texto pegado. En el compositor, un pegado largo (también lo que dicta Wispr Flow, que llega pegado) es solo
// un marcador «[Pasted text #1 +12 lines]»: Claude Code no da su contenido a un mod hasta el Enter. Al enviar,
// el texto llega expandido entre «<pasted_content id="7b0c">» y «</pasted_content id="7b0c">».

/** Marcador de pegado en el compositor; su contenido no se puede leer todavía. */
export const PASTE_CHIP = /\[Pasted text #\d+[^\]]*\]/

const BLOCK = /\n*<pasted_content id="([^"]+)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">\n?/g

export const hasPasteChip = (text: string) => PASTE_CHIP.test(text)
export const hasPastedBlock = (text: string) => new RegExp(BLOCK.source).test(text)

/** El texto enviado sin las etiquetas: lo que se ha pegado queda en su sitio, como texto normal. */
export function expandPastes(text: string): string {
  return text.replace(BLOCK, (_m, _id, body: string) => `\n\n${body}\n\n`).replace(/\n{3,}/g, '\n\n').trim()
}

export type Pasted = {
  /** Lo que la persona escribió fuera de lo pegado, con «[Pasted text #N]» en el sitio de cada pegado. */
  own: string
  /** El contenido de cada pegado, en orden. */
  pastes: string[]
  /**
   * True si lo pegado es el propio encargo (un dictado de Wispr Flow): fuera de ello no se escribió nada. Entonces
   * se reescribe el contenido. Si la persona escribió algo, lo pegado es material de apoyo (un log, un trozo de
   * código) y el agente lo recibe tal cual.
   */
  isDictation: boolean
}

export function splitPastes(text: string): Pasted {
  const pastes: string[] = []
  const own = text.replace(BLOCK, (_m, _id, body: string) => {
    pastes.push(body)
    return ` [Pasted text #${pastes.length}] `
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const words = own.replace(/\[Pasted text #\d+\]/g, ' ').split(/\s+/).filter(Boolean).length
  return { own, pastes, isDictation: pastes.length > 0 && words === 0 }
}

// Lo que se pasa al modelo de un pegado de apoyo: basta para entenderlo sin pagar un log entero.
const CONTEXT_CHARS = 6000

/**
 * El borrador que lee el modelo. Un dictado se reescribe entero. Con material de apoyo, el modelo ve las
 * palabras de la persona con los marcadores y, aparte, el contenido (recortado) para concretar el encargo.
 */
export function draftForModel(p: Pasted): string {
  if (p.isDictation) return [p.own.replace(/\[Pasted text #\d+\]/g, '').trim(), ...p.pastes].filter(Boolean).join('\n\n')
  const blocks = p.pastes.map((body, i) => {
    const cut = body.length > CONTEXT_CHARS ? `${body.slice(0, CONTEXT_CHARS)}\n[... ${body.length - CONTEXT_CHARS} more characters]` : body
    return `Pasted text #${i + 1} (the agent receives it as it is; read it to make the request concrete, do not copy it; keep the [Pasted text #${i + 1}] marker where it goes):\n${cut}`
  })
  return [p.own, ...blocks].join('\n\n')
}

/**
 * La propuesta lista para enviar. Con material de apoyo, cada marcador vuelve a ser el contenido pegado entero,
 * y el que el modelo haya quitado se añade al final, para que el agente lo reciba igual que con el original.
 */
export function restorePastes(proposal: string, p: Pasted): string {
  if (p.isDictation) return proposal
  let out = proposal
  const tail: string[] = []
  p.pastes.forEach((body, i) => {
    const marker = new RegExp(`\\[Pasted text #${i + 1}[^\\]]*\\]`)
    if (marker.test(out)) out = out.replace(marker, () => `\n\n${body}\n\n`)
    else tail.push(body)
  })
  return [out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), ...tail].join('\n\n')
}
