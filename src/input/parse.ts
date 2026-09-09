/**
 * Layer 1-2: read a YAML or JSON source and turn it into a validated `InputFile`.
 * Nothing here knows about geometry or rendering.
 */

import { parse as parseYaml } from 'yaml'
import type { ZodIssue } from 'zod'
import { type Diagnostic, error } from '../diagnostics.ts'
import { type InputFile, inputSchema } from './schema.ts'

export type SourceFormat = 'yaml' | 'json'

export interface ValidationSuccess {
  ok: true
  value: InputFile
}

export interface ValidationFailure {
  ok: false
  diagnostics: Diagnostic[]
}

export type ValidationResult = ValidationSuccess | ValidationFailure

/**
 * JSON is a subset of YAML, so the YAML parser could handle both. We still pick
 * explicitly, because the JSON parser gives much better messages for JSON typos.
 */
export function detectFormat(filename: string | undefined, text: string): SourceFormat {
  if (filename) {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.json')) return 'json'
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml'
  }
  return text.trimStart().startsWith('{') ? 'json' : 'yaml'
}

/** Parse raw text into a plain object. Returns a diagnostic instead of throwing. */
export function parseSource(
  text: string,
  format: SourceFormat,
): { ok: true; value: unknown } | ValidationFailure {
  try {
    const value = format === 'json' ? JSON.parse(text) : parseYaml(text)
    if (value === null || value === undefined) {
      return { ok: false, diagnostics: [error('E_PARSE', 'the input file is empty')] }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        diagnostics: [error('E_PARSE', 'the input file must contain a mapping at the top level')],
      }
    }
    return { ok: true, value }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, diagnostics: [error('E_PARSE', `${format.toUpperCase()}: ${message}`)] }
  }
}

/** Render a Zod issue path as `cutouts[0].width`. */
export function formatIssuePath(path: ReadonlyArray<string | number>): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out === '' ? segment : `.${segment}`
  }
  return out
}

function issueToDiagnostic(issue: ZodIssue): Diagnostic {
  const path = formatIssuePath(issue.path)
  return error('E_SCHEMA', issue.message, path === '' ? {} : { path })
}

export function validateInput(raw: unknown): ValidationResult {
  const result = inputSchema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, diagnostics: result.error.issues.map(issueToDiagnostic) }
}

/** Convenience: text -> validated input, in one step. */
export function readInput(text: string, filename?: string): ValidationResult {
  const parsed = parseSource(text, detectFormat(filename, text))
  if (!parsed.ok) return parsed
  return validateInput(parsed.value)
}
