// Coste de una llamada a partir de sus tokens, a precio de lista de la API de Anthropic (USD por millón de tokens).
// Fuente: tabla de modelos de la referencia oficial de la API, cacheada el 2026-10-06. Comprobado contra el
// total_cost_usd de Claude Code para Haiku 5.5 y Sonnet 5.5: coincide.
// Las llamadas del mod no entran en /cost (el registro de la sesión no las cuenta): por eso se calcula aquí.

type Price = { input: number; output: number; cacheRead: number }

// Escrituras en caché: Claude Code escribe con la duración de 1 hora, 2× el precio de entrada.
const CACHE_WRITE = 2

const PRICES: Record<string, Price> = {
  haiku: { input: 0.10, output: 0.50, cacheRead: 0.01 },
  sonnet: { input: 2, output: 10, cacheRead: 0.20 },
  opus: { input: 4, output: 20, cacheRead: 0.20 },
  fable: { input: 10, output: 50, cacheRead: 0.25 },
}
// Haiku 5.5 con un prompt de más de 100.000 tokens.
const HAIKU_LONG: Price = { input: 0.50, output: 2.50, cacheRead: 0.05 }

/** La familia del modelo actual (5.5; Fable 5.1), por alias o id; null para otro modelo o versión. */
export function priceFamily(model: string): keyof typeof PRICES | null {
  const m = model.toLowerCase().replace(/\[.*\]$/, '')
  if (m in PRICES) return m as keyof typeof PRICES
  const id = /^claude-(haiku|sonnet|opus)-5-5$|^claude-(fable)-5-1$/.exec(m)
  return id ? ((id[1] ?? id[2]) as keyof typeof PRICES) : null
}

/**
 * Dólares de una llamada. `uncached` son los tokens de entrada sin caché, `cacheRead` los servidos por la caché y
 * `cacheWrite` los escritos en ella. null si el modelo no está en la tabla (otra versión): mejor sin coste que
 * con uno inventado.
 */
export function callCost(model: string, t: { uncached: number; cacheRead: number; cacheWrite: number; output: number }): number | null {
  const family = priceFamily(model)
  if (!family) return null
  const totalIn = t.uncached + t.cacheRead + t.cacheWrite
  const p = family === 'haiku' && totalIn > 100_000 ? HAIKU_LONG : PRICES[family]!
  return (t.uncached * p.input + t.cacheRead * p.cacheRead + t.cacheWrite * p.input * CACHE_WRITE + t.output * p.output) / 1e6
}
