/**
 * Diagnostics are the single currency for everything that can be wrong with an
 * input file, whether it was caught by the schema or by a geometric check.
 */

export type Severity = 'error' | 'warning'

export type DiagnosticCode =
  // Structural / schema
  | 'E_PARSE'
  | 'E_SCHEMA'
  // Semantic geometry
  | 'E_DUPLICATE_ID'
  | 'E_CUTOUT_OUT_OF_BOUNDS'
  | 'E_HOLE_OUT_OF_BOUNDS'
  | 'E_HOLE_INSIDE_CUTOUT'
  | 'E_CORNER_RADIUS'
  // Additional services
  | 'E_SERVICE_TARGET'
  | 'E_SERVICE_SCOPE'
  | 'E_SERVICE_RANGE'
  // Heuristic warnings - see README, these are NOT fabrication rules
  | 'W_EDGE_CLEARANCE'
  | 'W_FEATURE_CLEARANCE'
  | 'W_FEATURE_OVERLAP'
  | 'W_SCALE_CLAMPED'
  | 'W_DUPLICATE_SERVICE'
  | 'W_NOTES_TRUNCATED'

export interface Diagnostic {
  severity: Severity
  code: DiagnosticCode
  message: string
  /** Dotted path into the input document, e.g. `cutouts[0].width`. */
  path?: string
  /** Id of the cutout or hole the diagnostic refers to. */
  elementId?: string
}

export function error(
  code: DiagnosticCode,
  message: string,
  extra: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {},
): Diagnostic {
  return { severity: 'error', code, message, ...extra }
}

export function warning(
  code: DiagnosticCode,
  message: string,
  extra: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {},
): Diagnostic {
  return { severity: 'warning', code, message, ...extra }
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): {
  errors: number
  warnings: number
} {
  let errors = 0
  let warnings = 0
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++
    else warnings++
  }
  return { errors, warnings }
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.path ?? d.elementId
  const location = where ? ` (${where})` : ''
  return `${d.severity}: [${d.code}] ${d.message}${location}`
}

/** Thrown by the library entry points when a document cannot be rendered. */
export class SlabSketchError extends Error {
  readonly diagnostics: Diagnostic[]

  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message)
    this.name = 'SlabSketchError'
    this.diagnostics = diagnostics
  }
}
