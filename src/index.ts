/**
 * SlabSketch public API.
 *
 * The pipeline is deliberately explicit, so a caller can stop at any stage:
 *
 *   text -> readInput -> normalizeDocument -> checkDocument -> buildDrawing -> renderSvg / renderPdf
 */

import { type Diagnostic, SlabSketchError, hasErrors } from './diagnostics.ts'
import { readInput } from './input/parse.ts'
import { type NormalizeOverrides, normalizeDocument } from './model/normalize.ts'
import type { CountertopDocument } from './model/types.ts'
import { type Drawing, buildDrawing } from './render/drawing.ts'
import { type PdfOptions, renderPdf } from './render/pdf.ts'
import { type SvgOptions, renderSvg } from './render/svg.ts'
import { checkDocument } from './validate/checks.ts'

export type OutputFormat = 'svg' | 'pdf'

export interface LoadOptions extends NormalizeOverrides {
  /** Used only to pick the parser (YAML vs JSON) and to improve messages. */
  filename?: string
}

export interface LoadSuccess {
  ok: true
  document: CountertopDocument
  /** Warnings only; a load with errors returns `ok: false`. */
  diagnostics: Diagnostic[]
}

export interface LoadFailure {
  ok: false
  diagnostics: Diagnostic[]
  document?: CountertopDocument
}

export type LoadResult = LoadSuccess | LoadFailure

/** Parse, validate and normalise a YAML or JSON source into a document. */
export function loadDocument(source: string, options: LoadOptions = {}): LoadResult {
  const { filename, ...overrides } = options
  const input = readInput(source, filename)
  if (!input.ok) return { ok: false, diagnostics: input.diagnostics }

  let document: CountertopDocument
  try {
    document = normalizeDocument(input.value, overrides)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, diagnostics: [{ severity: 'error', code: 'E_SCHEMA', message }] }
  }
  const diagnostics = checkDocument(document)
  if (hasErrors(diagnostics)) return { ok: false, diagnostics, document }
  return { ok: true, document, diagnostics }
}

export interface RenderResult {
  format: OutputFormat
  /** SVG source, or PDF bytes. */
  content: string | Uint8Array
  drawing: Drawing
  diagnostics: Diagnostic[]
}

export interface RenderOptions {
  svg?: SvgOptions
  pdf?: PdfOptions
  /** Name of the source file, stamped into the drawing's bottom margin. */
  source?: string
}

/** Build the drawing for a document without exporting it. */
export function createDrawing(
  document: CountertopDocument,
  options: { source?: string } = {},
): {
  drawing: Drawing
  diagnostics: Diagnostic[]
} {
  return buildDrawing(document, options)
}

export function renderDocument(
  document: CountertopDocument,
  format: OutputFormat,
  options: RenderOptions = {},
): RenderResult {
  const { drawing, diagnostics } = buildDrawing(document, {
    ...(options.source === undefined ? {} : { source: options.source }),
  })
  if (format === 'svg') {
    return { format, content: renderSvg(drawing, options.svg), drawing, diagnostics }
  }
  const pdfOptions: PdfOptions = {
    title: drawing.title,
    ...(document.metadata.drawnBy ? { author: document.metadata.drawnBy } : {}),
    ...options.pdf,
  }
  return { format, content: renderPdf(drawing, pdfOptions), drawing, diagnostics }
}

/** One-shot convenience: source text in, drawing out. Throws on validation errors. */
export function render(
  source: string,
  format: OutputFormat = 'svg',
  options: LoadOptions & RenderOptions = {},
): RenderResult {
  const { svg, pdf, source: sourceName, ...loadOptions } = options
  const loaded = loadDocument(source, loadOptions)
  if (!loaded.ok) {
    throw new SlabSketchError('the input document has validation errors', loaded.diagnostics)
  }
  const result = renderDocument(loaded.document, format, {
    ...(svg ? { svg } : {}),
    ...(pdf ? { pdf } : {}),
    ...(sourceName === undefined ? {} : { source: sourceName }),
  })
  return { ...result, diagnostics: [...loaded.diagnostics, ...result.diagnostics] }
}

export {
  SlabSketchError,
  hasErrors,
  countBySeverity,
  formatDiagnostic,
} from './diagnostics.ts'
export type { Diagnostic, DiagnosticCode, Severity } from './diagnostics.ts'
export { readInput, parseSource, validateInput, detectFormat } from './input/parse.ts'
export { inputSchema } from './input/schema.ts'
export type { InputFile } from './input/schema.ts'
export { normalizeDocument } from './model/normalize.ts'
export type {
  CountertopDocument,
  Slab,
  Feature,
  RectCutout,
  CircleHole,
  DrawingOptions,
  Metadata,
} from './model/types.ts'
export { checkDocument } from './validate/checks.ts'
export { autoDimensions, packDimensions } from './geometry/dimensions.ts'
export type { Dimension, LinearDimension, DiameterDimension } from './geometry/dimensions.ts'
export { parseScale, formatScale, SCALE_LADDER } from './geometry/scale.ts'
export { LAYOUT, sheetSize } from './geometry/layout.ts'
export { LANGUAGES, strings } from './i18n.ts'
export type { Language, Strings } from './i18n.ts'
export { VERSION, GENERATOR } from './version.ts'
export { buildDrawing, toPaper } from './render/drawing.ts'
export type { Drawing, Entity, Style, Layer } from './render/drawing.ts'
export { renderSvg } from './render/svg.ts'
export { renderPdf } from './render/pdf.ts'
