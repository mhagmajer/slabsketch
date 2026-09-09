/**
 * Text helpers shared by dimensioning (which needs widths to avoid collisions)
 * and by the renderers (SVG centres text itself; the PDF writer must do it).
 *
 * Widths are the Adobe AFM advance widths of Helvetica, in 1/1000 em. Only the
 * characters a technical drawing actually emits are tabulated; anything else
 * falls back to the width of a digit, which is a safe over-estimate for the
 * narrow glyphs and close enough for collision tests.
 */

/** U+00D8. Present in WinAnsiEncoding, so SVG and PDF render the same glyph. */
export const DIAMETER_SIGN = 'Ø'

const WIDTHS: Record<string, number> = {
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  '[': 278,
  '\\': 278,
  ']': 278,
  '^': 469,
  _: 556,
  '`': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '{': 334,
  '|': 260,
  '}': 334,
  '~': 584,
  Ø: 778, // Ø
  '×': 584, // ×
  '°': 400, // °
}

const FALLBACK_WIDTH = 556

/**
 * The unaccented letter a character is built from, so that accented Latin
 * characters measure correctly - in Helvetica they have the same advance width
 * as their base letter. Stroked letters have no combining form, so they are
 * listed explicitly.
 */
const STROKED: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o' }

export function baseLetter(char: string): string {
  const stroked = STROKED[char]
  if (stroked) return stroked
  const stripped = char.normalize('NFD').replace(/\p{M}+/gu, '')
  return stripped === '' ? char : stripped
}

/** Advance width of `text` when set in Helvetica at `fontSize`, in the same unit. */
export function textWidth(text: string, fontSize: number): number {
  let total = 0
  for (const char of text) {
    total += WIDTHS[char] ?? WIDTHS[baseLetter(char)] ?? FALLBACK_WIDTH
  }
  return (total / 1000) * fontSize
}

/**
 * Format a length for annotation: whole millimetres stay whole, fractions keep
 * at most two decimals, and trailing zeros are trimmed so output is stable.
 */
export function formatLength(value: number): string {
  const rounded = Math.round(value * 100) / 100
  const normalised = rounded === 0 ? 0 : rounded
  if (Number.isInteger(normalised)) return String(normalised)
  return String(normalised)
}

export function formatDiameter(value: number): string {
  return `${DIAMETER_SIGN}${formatLength(value)}`
}

/** Helvetica cap height, in em. Used to convert a text box edge to a baseline. */
export const CAP_HEIGHT = 0.716

export type VerticalAlign = 'top' | 'middle' | 'bottom'

/**
 * Offset to add to the anchor's y to land on the text baseline, given where the
 * anchor sits relative to the cap-height box. Both renderers use this so SVG and
 * PDF place text identically.
 */
export function baselineOffset(align: VerticalAlign, fontSize: number): number {
  const cap = CAP_HEIGHT * fontSize
  if (align === 'top') return cap
  if (align === 'middle') return cap / 2
  return 0
}
