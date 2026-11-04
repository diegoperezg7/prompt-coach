export type Lang = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it'

export type Proposal = {
  original: string
  text: string
  lang: Lang
  before: number
  after: number
  origin: 'model' | 'local'
  model?: string
  note?: string
  changes: string[]
  /** Criterios de la rúbrica por debajo de su máximo, ya redactados ("contexto 8/15 (...)"). */
  missing: string[]
  /** El dato que solo la persona puede dar y que falta para 100, si lo hay: el panel se lo pregunta. */
  ask?: 'contexto' | 'detalle'
  /** Llamadas al modelo que respondieron: 1, o 2 con la pasada de reparación. */
  passes: number
  /** Tokens de entrada y salida sumados de todas las pasadas. */
  tokens?: number
  isBusy: boolean
  isApplied: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { draft: string; proposal: Shaped<Proposal | null> }
  }
}
