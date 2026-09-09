/**
 * PDF exporter, written directly against the PDF 1.4 file format.
 *
 * The drawing only needs stroked paths, filled triangles and single-line text in
 * one standard font, so a full PDF library would be a large dependency for a
 * small job. The output is uncompressed (readable, and byte-stable) and uses the
 * base-14 Helvetica faces, so no font data is embedded.
 *
 * Everything is deterministic: no creation date unless one is supplied, and the
 * file ID is a hash of the page content rather than a random value.
 */

import { round } from '../geometry/primitives.ts'
import { baselineOffset, glyphWidth, textWidth } from '../text.ts'
import { GENERATOR } from '../version.ts'
import type { Drawing, Entity, Style, TextEntity } from './drawing.ts'
import { projectEntity } from './drawing.ts'

const MM_TO_PT = 72 / 25.4
/** Bezier circle constant: 4/3 * (sqrt(2) - 1). */
const KAPPA = 0.5522847498307936

export interface PdfOptions {
  title?: string
  author?: string
  /** PDF date string such as `D:20260101120000Z`. Omitted when absent. */
  creationDate?: string
}

export function renderPdf(drawing: Drawing, options: PdfOptions = {}): Uint8Array {
  const encoding = buildEncoding(collectText(drawing))
  const content = buildContentStream(drawing, encoding)
  const pageWidth = drawing.sheet.width * MM_TO_PT
  const pageHeight = drawing.sheet.height * MM_TO_PT

  // Object numbers are fixed so the page dictionary can refer to them directly.
  const catalogId = 1
  const pagesId = 2
  const pageId = 3
  const contentId = 4
  const encodingId = 5
  const regularId = 6
  const boldId = 7
  const infoId = 8

  // The widths matter: without them a viewer falls back to the standard
  // Helvetica metrics, which have no entry for the glyphs the /Differences
  // table introduces, so Polish letters are advanced by zero and collide with
  // whatever follows them.
  const font = (base: string, bold: boolean): string =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding ${encodingId} 0 R ` +
    `/FirstChar ${FIRST_CHAR} /LastChar ${LAST_CHAR} ` +
    `/Widths [${widthsArray(encoding, bold).join(' ')}] >>`

  const infoParts = [
    `/Title (${escapeString(options.title ?? drawing.title, encoding)})`,
    `/Producer (${GENERATOR})`,
    `/Creator (${GENERATOR})`,
  ]
  if (options.author) infoParts.push(`/Author (${escapeString(options.author, encoding)})`)
  if (options.creationDate) {
    infoParts.push(`/CreationDate (${escapeString(options.creationDate, encoding)})`)
  }

  const objects: string[] = [
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
      `/Resources << /Font << /F1 ${regularId} 0 R /F2 ${boldId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    encodingObject(encoding),
    font('Helvetica', false),
    font('Helvetica-Bold', true),
    `<< ${infoParts.join(' ')} >>`,
  ]

  let pdf = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const id = hash16(content)
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R `
  pdf += `/ID [<${id}> <${id}>] >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

// ---------------------------------------------------------------------------
// Content stream
// ---------------------------------------------------------------------------

function buildContentStream(drawing: Drawing, encoding: Encoding): string {
  const height = drawing.sheet.height
  const ops: string[] = []

  // Page background
  ops.push('1 1 1 rg')
  ops.push(`0 0 ${num(drawing.sheet.width * MM_TO_PT)} ${num(height * MM_TO_PT)} re f`)
  ops.push('1 J 1 j')

  const entities: Entity[] = [
    ...drawing.model.map((entity) => projectEntity(entity, drawing.transform)),
    ...drawing.paper,
  ]

  for (const entity of entities) {
    emitEntity(ops, entity, height, encoding)
  }
  return ops.join('\n')
}

function emitEntity(ops: string[], entity: Entity, sheetHeight: number, encoding: Encoding): void {
  switch (entity.type) {
    case 'line': {
      applyStroke(ops, entity.style)
      ops.push(`${pt(entity.a.x)} ${pt(sheetHeight - entity.a.y)} m`)
      ops.push(`${pt(entity.b.x)} ${pt(sheetHeight - entity.b.y)} l S`)
      return
    }
    case 'polyline': {
      if (entity.points.length === 0) return
      applyStroke(ops, entity.style)
      emitPath(ops, entity.points, sheetHeight)
      ops.push(entity.closed ? 'h S' : 'S')
      return
    }
    case 'polygon': {
      if (entity.points.length === 0) return
      const [r, g, b] = parseColor(entity.style.fill ?? '#000000')
      ops.push(`${num(r)} ${num(g)} ${num(b)} rg`)
      emitPath(ops, entity.points, sheetHeight)
      ops.push('h f')
      return
    }
    case 'circle': {
      applyStroke(ops, entity.style)
      if (entity.style.fill) {
        const [r, g, b] = parseColor(entity.style.fill)
        ops.push(`${num(r)} ${num(g)} ${num(b)} rg`)
      }
      emitCircle(ops, entity.center.x, sheetHeight - entity.center.y, entity.radius)
      // B fills and strokes; S strokes only.
      ops.push(entity.style.fill ? 'B' : 'S')
      return
    }
    case 'text':
      emitText(ops, entity, sheetHeight, encoding)
  }
}

function emitPath(
  ops: string[],
  points: readonly { x: number; y: number }[],
  sheetHeight: number,
): void {
  points.forEach((p, index) => {
    ops.push(`${pt(p.x)} ${pt(sheetHeight - p.y)} ${index === 0 ? 'm' : 'l'}`)
  })
}

function emitCircle(ops: string[], cx: number, cy: number, r: number): void {
  const k = r * KAPPA
  const x = (v: number) => pt(v)
  ops.push(`${x(cx + r)} ${x(cy)} m`)
  ops.push(`${x(cx + r)} ${x(cy + k)} ${x(cx + k)} ${x(cy + r)} ${x(cx)} ${x(cy + r)} c`)
  ops.push(`${x(cx - k)} ${x(cy + r)} ${x(cx - r)} ${x(cy + k)} ${x(cx - r)} ${x(cy)} c`)
  ops.push(`${x(cx - r)} ${x(cy - k)} ${x(cx - k)} ${x(cy - r)} ${x(cx)} ${x(cy - r)} c`)
  ops.push(`${x(cx + k)} ${x(cy - r)} ${x(cx + r)} ${x(cy - k)} ${x(cx + r)} ${x(cy)} c`)
}

function emitText(
  ops: string[],
  entity: TextEntity,
  sheetHeight: number,
  encoding: Encoding,
): void {
  const fontSize = entity.style.fontSize ?? 2.5
  const width = textWidth(entity.text, fontSize, entity.style.bold ?? false)
  const offsetX = entity.anchor === 'start' ? 0 : entity.anchor === 'middle' ? -width / 2 : -width
  const offsetY = baselineOffset(entity.baseline, fontSize)

  // Rotate the local offset in screen space (y down, positive angle clockwise),
  // exactly as the SVG renderer does, then flip into PDF space.
  const degrees = entity.rotate ?? 0
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const baseX = entity.at.x + offsetX * cos - offsetY * sin
  const baseY = entity.at.y + offsetX * sin + offsetY * cos

  // Screen-clockwise degrees become counter-clockwise in PDF's y-up space.
  const theta = -radians
  const [r, g, b] = parseColor(entity.style.fill ?? '#000000')
  const font = entity.style.bold ? '/F2' : '/F1'

  ops.push('BT')
  ops.push(`${font} ${num(fontSize * MM_TO_PT)} Tf`)
  ops.push(`${num(r)} ${num(g)} ${num(b)} rg`)
  ops.push(
    `${num(Math.cos(theta))} ${num(Math.sin(theta))} ${num(-Math.sin(theta))} ${num(
      Math.cos(theta),
    )} ${pt(baseX)} ${pt(sheetHeight - baseY)} Tm`,
  )
  ops.push(`(${escapeString(entity.text, encoding)}) Tj`)
  ops.push('ET')
}

function applyStroke(ops: string[], style: Style): void {
  const [r, g, b] = parseColor(style.stroke ?? '#000000')
  ops.push(`${num(r)} ${num(g)} ${num(b)} RG`)
  ops.push(`${num((style.strokeWidth ?? 0.25) * MM_TO_PT)} w`)
  if (style.dash && style.dash.length > 0) {
    ops.push(`[${style.dash.map((d) => num(d * MM_TO_PT)).join(' ')}] 0 d`)
  } else {
    ops.push('[] 0 d')
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Millimetres to PDF points, rounded for stable output. */
function pt(valueMm: number): string {
  return num(valueMm * MM_TO_PT)
}

function num(value: number): string {
  return String(round(value, 3))
}

function parseColor(color: string): [number, number, number] {
  const hex = color.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return [0, 0, 0]
  return [
    round(((value >> 16) & 0xff) / 255, 4),
    round(((value >> 8) & 0xff) / 255, 4),
    round((value & 0xff) / 255, 4),
  ]
}

/**
 * Text encoding.
 *
 * The base-14 fonts are used with WinAnsiEncoding, which covers Western
 * European text but not Polish - `ł`, `ą`, `ę`, `ś`, `ż`, `ź`, `ć` and `ń` are
 * all absent. Rather than embedding a font, the drawing's own characters are
 * collected and any that WinAnsi cannot express are mapped, by their standard
 * PostScript glyph names, onto spare codes through an /Encoding /Differences
 * table. Viewers resolve those names against the substituted font, and the
 * advance widths of accented Latin letters match their base letters, so the
 * metrics this package computes stay correct.
 */

/** WinAnsi codes for the characters in 0x80-0x9F, which are not Latin-1. */
const WIN_ANSI_SPECIALS: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
}

/** Glyph names for characters WinAnsiEncoding cannot express. */
const EXTRA_GLYPH_NAMES: Record<string, string> = {
  ą: 'aogonek',
  Ą: 'Aogonek',
  ć: 'cacute',
  Ć: 'Cacute',
  ę: 'eogonek',
  Ę: 'Eogonek',
  ł: 'lslash',
  Ł: 'Lslash',
  ń: 'nacute',
  Ń: 'Nacute',
  ś: 'sacute',
  Ś: 'Sacute',
  ź: 'zacute',
  Ź: 'Zacute',
  ż: 'zdotaccent',
  Ż: 'Zdotaccent',
  č: 'ccaron',
  Č: 'Ccaron',
  ě: 'ecaron',
  Ě: 'Ecaron',
  ř: 'rcaron',
  Ř: 'Rcaron',
  š: 'scaron',
  Š: 'Scaron',
  ť: 'tcaron',
  Ť: 'Tcaron',
  ů: 'uring',
  Ů: 'Uring',
  ž: 'zcaron',
  Ž: 'Zcaron',
}

/** Codes WinAnsiEncoding leaves undefined, so they are handed out first. */
const SPARE_CODES = [0x81, 0x8d, 0x8f, 0x90, 0x9d]

export interface Encoding {
  /** Characters that needed a code of their own. */
  extra: Map<string, number>
  /** `code /glyphname` pairs for the /Differences array. */
  differences: Array<[number, string]>
}

/** Every character the drawing will ask the font for. */
function collectText(drawing: Drawing): string[] {
  const texts: string[] = [drawing.title]
  for (const entity of [...drawing.model, ...drawing.paper]) {
    if (entity.type === 'text') texts.push(entity.text)
  }
  return texts
}

function winAnsiCode(char: string): number | undefined {
  const code = char.codePointAt(0)
  if (code === undefined) return undefined
  if (code >= 32 && code <= 126) return code
  if (code >= 0xa0 && code <= 0xff) return code
  return WIN_ANSI_SPECIALS[char]
}

export function buildEncoding(texts: readonly string[]): Encoding {
  const used = new Set<number>()
  const missing: string[] = []
  for (const text of texts) {
    for (const char of text) {
      const code = winAnsiCode(char)
      if (code !== undefined) used.add(code)
      else if (EXTRA_GLYPH_NAMES[char] && !missing.includes(char)) missing.push(char)
    }
  }

  // Deterministic order: by code point, not by order of appearance.
  missing.sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0))

  const free: number[] = [...SPARE_CODES]
  for (let code = 0x80; code <= 0xff; code++) {
    if (!used.has(code) && !SPARE_CODES.includes(code)) free.push(code)
  }

  const extra = new Map<string, number>()
  const differences: Array<[number, string]> = []
  missing.forEach((char, index) => {
    const code = free[index]
    const name = EXTRA_GLYPH_NAMES[char]
    if (code === undefined || name === undefined) return
    extra.set(char, code)
    differences.push([code, name])
  })
  differences.sort((a, b) => a[0] - b[0])
  return { extra, differences }
}

const FIRST_CHAR = 32
const LAST_CHAR = 255

/** Character each code stands for, once /Differences has been applied. */
function decodeTable(encoding: Encoding): Map<number, string> {
  const table = new Map<number, string>()
  for (let code = FIRST_CHAR; code <= 126; code++) table.set(code, String.fromCharCode(code))
  for (const [char, code] of Object.entries(WIN_ANSI_SPECIALS)) table.set(code, char)
  for (let code = 0xa0; code <= LAST_CHAR; code++) table.set(code, String.fromCharCode(code))
  for (const [char, code] of encoding.extra) table.set(code, char)
  return table
}

/** Advance width of every code in the font's range, in 1/1000 em. */
function widthsArray(encoding: Encoding, bold: boolean): number[] {
  const table = decodeTable(encoding)
  const widths: number[] = []
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    const char = table.get(code)
    widths.push(char === undefined ? 0 : glyphWidth(char, bold))
  }
  return widths
}

function encodingObject(encoding: Encoding): string {
  const base = '<< /Type /Encoding /BaseEncoding /WinAnsiEncoding'
  if (encoding.differences.length === 0) return `${base} >>`
  const entries = encoding.differences.map(([code, name]) => `${code} /${name}`).join(' ')
  return `${base} /Differences [${entries}] >>`
}

function escapeString(text: string, encoding: Encoding): string {
  let out = ''
  for (const char of text) {
    if (char === '(' || char === ')' || char === '\\') {
      out += `\\${char}`
      continue
    }
    const code = winAnsiCode(char) ?? encoding.extra.get(char)
    if (code === undefined) {
      out += '?'
      continue
    }
    if (code >= 32 && code <= 126) out += char
    else out += `\\${code.toString(8).padStart(3, '0')}`
  }
  return out
}

/** FNV-1a, rendered as 16 hex characters. Keeps the file ID deterministic. */
function hash16(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase()
}
