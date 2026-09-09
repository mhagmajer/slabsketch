/**
 * Drawing scale handling. A scale is stored as a single factor:
 * paper millimetres per model millimetre, so 1:10 is 0.1.
 */

/** Preferred scales, largest first. `auto` picks the first one that fits the sheet. */
export const SCALE_LADDER: readonly number[] = [
  1,
  1 / 2,
  1 / 5,
  1 / 10,
  1 / 20,
  1 / 25,
  1 / 50,
  1 / 100,
  1 / 200,
]

export function parseScale(value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid scale factor: ${value}`)
    }
    return value
  }
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!match) throw new Error(`invalid scale "${value}", expected something like "1:10"`)
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (numerator <= 0 || denominator <= 0) throw new Error(`invalid scale "${value}"`)
  return numerator / denominator
}

/** 0.1 -> "1:10", 1 -> "1:1", 2 -> "2:1". */
export function formatScale(factor: number): string {
  if (factor >= 1) {
    const n = Math.round(factor * 1000) / 1000
    return `${trim(n)}:1`
  }
  const denominator = Math.round((1 / factor) * 1000) / 1000
  return `1:${trim(denominator)}`
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n)
}
