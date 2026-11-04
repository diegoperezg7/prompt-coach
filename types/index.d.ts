export type Lang = 'es' | 'en'

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
  isBusy: boolean
  isApplied: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { draft: string; proposal: Shaped<Proposal | null> }
  }
}
