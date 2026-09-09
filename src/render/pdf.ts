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
import { baselineOffset, textWidth } from '../text.ts'
import type { Drawing, Entity, Style, TextEntity } from './drawing.ts'
import { toPaper } from './drawing.ts'

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
  const content = buildContentStream(drawing)
  const pageWidth = drawing.sheet.width * MM_TO_PT
  const pageHeight = drawing.sheet.height * MM_TO_PT

  const objects: string[] = []
  const add = (body: string): number => {
    objects.push(body)
    return objects.length
  }

  const catalogId = add('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesId = add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  const pageId = add(
    `<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> ' +
      '/Contents 4 0 R >>',
  )
  const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  const regularId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  )
  const boldId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  )

  const infoParts = [
    `/Title (${escapeString(options.title ?? drawing.title)})`,
    '/Producer (SlabSketch)',
    '/Creator (SlabSketch)',
  ]
  if (options.author) infoParts.push(`/Author (${escapeString(options.author)})`)
  if (options.creationDate) infoParts.push(`/CreationDate (${escapeString(options.creationDate)})`)
  const infoId = add(`<< ${infoParts.join(' ')} >>`)

  // Sanity: object numbering must match the hard-coded references above.
  if (catalogId !== 1 || pageId !== 3 || contentId !== 4 || regularId !== 5 || boldId !== 6) {
    throw new Error('renderPdf: object numbering drifted from the page dictionary')
  }

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

function buildContentStream(drawing: Drawing): string {
  const height = drawing.sheet.height
  const ops: string[] = []

  // Page background
  ops.push('1 1 1 rg')
  ops.push(`0 0 ${num(drawing.sheet.width * MM_TO_PT)} ${num(height * MM_TO_PT)} re f`)
  ops.push('1 J 1 j')

  const entities: Entity[] = [
    ...drawing.model.map((entity) => transformEntity(entity, drawing)),
    ...drawing.paper,
  ]

  for (const entity of entities) {
    emitEntity(ops, entity, height)
  }
  return ops.join('\n')
}

function transformEntity(entity: Entity, drawing: Drawing): Entity {
  const t = drawing.transform
  switch (entity.type) {
    case 'line':
      return { ...entity, a: toPaper(t, entity.a), b: toPaper(t, entity.b) }
    case 'polyline':
    case 'polygon':
      return { ...entity, points: entity.points.map((p) => toPaper(t, p)) }
    case 'circle':
      return { ...entity, center: toPaper(t, entity.center), radius: entity.radius * t.scale }
    case 'text':
      return { ...entity, at: toPaper(t, entity.at) }
  }
}

function emitEntity(ops: string[], entity: Entity, sheetHeight: number): void {
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
      emitCircle(ops, entity.center.x, sheetHeight - entity.center.y, entity.radius)
      ops.push('S')
      return
    }
    case 'text':
      emitText(ops, entity, sheetHeight)
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

function emitText(ops: string[], entity: TextEntity, sheetHeight: number): void {
  const fontSize = entity.style.fontSize ?? 2.5
  const width = textWidth(entity.text, fontSize)
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
  ops.push(`(${escapeString(entity.text)}) Tj`)
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

/** Characters beyond ASCII that the drawing style may emit, in WinAnsiEncoding. */
const WIN_ANSI: Record<string, number> = {
  Ø: 0xd8,
  ø: 0xf8,
  '×': 0xd7,
  '°': 0xb0,
  '–': 0x96,
  '—': 0x97,
  '“': 0x93,
  '”': 0x94,
  '‘': 0x91,
  '’': 0x92,
  '…': 0x85,
}

function escapeString(text: string): string {
  let out = ''
  for (const char of text) {
    if (char === '(' || char === ')' || char === '\\') {
      out += `\\${char}`
      continue
    }
    const code = char.codePointAt(0) ?? 63
    if (code >= 32 && code <= 126) {
      out += char
      continue
    }
    const mapped = WIN_ANSI[char]
    if (mapped !== undefined) {
      out += `\\${mapped.toString(8).padStart(3, '0')}`
      continue
    }
    if (code < 256) {
      out += `\\${code.toString(8).padStart(3, '0')}`
      continue
    }
    out += '?'
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
