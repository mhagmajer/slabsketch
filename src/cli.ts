#!/usr/bin/env node
/**
 * SlabSketch command line interface.
 *
 * Deliberately small: one verb that renders and one that only validates.
 * Everything it does is available from the library API as well.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { type Diagnostic, countBySeverity, formatDiagnostic } from './diagnostics.ts'
import { type OutputFormat, loadDocument, renderDocument } from './index.ts'
import type { Orientation, SheetName } from './model/types.ts'

const VERSION = '0.1.0'

const USAGE = `slabsketch ${VERSION} - dimensioned technical drawings of countertops

Usage:
  slabsketch <input>                     render <input> to an SVG next to it
  slabsketch render <input> [options]    render a drawing
  slabsketch check <input>               validate only, write nothing

Options:
  -o, --output <file>     output path ("-" for stdout)
  -f, --format <fmt>      svg | pdf                        (default: from --output, else svg)
  -s, --scale <scale>     e.g. 1:10, or "auto"             (default: from the input file)
      --sheet <size>      a5 | a4 | a3 | a2 | a1           (default: from the input file)
      --orientation <o>   landscape | portrait             (default: from the input file)
      --dimensions <d>    auto | none                      (default: auto)
      --strict            treat warnings as errors
  -q, --quiet             only print errors
  -h, --help              show this help
  -v, --version           show the version

Examples:
  slabsketch examples/kitchen-countertop.yaml
  slabsketch render countertop.yaml -o drawing.pdf --scale 1:20
  slabsketch check countertop.yaml --strict
`

const SHEETS: readonly string[] = ['a5', 'a4', 'a3', 'a2', 'a1']

async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof optionSpec; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: argv, options: optionSpec, allowPositionals: true })
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed

  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  const isVerb = positionals[0] === 'render' || positionals[0] === 'check'
  const command = isVerb ? positionals[0] : 'render'
  const inputPath = isVerb ? positionals[1] : positionals[0]

  if (!inputPath) {
    process.stderr.write(`error: no input file given\n\n${USAGE}`)
    return 2
  }

  const format = resolveFormat(values.format, values.output)
  if (format === undefined) {
    process.stderr.write(`error: unknown format "${values.format}", expected svg or pdf\n`)
    return 2
  }
  if (values.sheet !== undefined && !SHEETS.includes(values.sheet)) {
    process.stderr.write(
      `error: unknown sheet "${values.sheet}", expected one of ${SHEETS.join(', ')}\n`,
    )
    return 2
  }
  if (
    values.orientation !== undefined &&
    values.orientation !== 'landscape' &&
    values.orientation !== 'portrait'
  ) {
    process.stderr.write(`error: unknown orientation "${values.orientation}"\n`)
    return 2
  }
  if (
    values.dimensions !== undefined &&
    values.dimensions !== 'auto' &&
    values.dimensions !== 'none'
  ) {
    process.stderr.write(
      `error: unknown --dimensions "${values.dimensions}", expected auto or none\n`,
    )
    return 2
  }

  let source: string
  try {
    source = await readFile(inputPath, 'utf8')
  } catch (cause) {
    process.stderr.write(`error: cannot read ${inputPath}: ${(cause as Error).message}\n`)
    return 2
  }

  const loaded = loadDocument(source, {
    filename: inputPath,
    ...(values.scale === undefined
      ? {}
      : { scale: values.scale === 'auto' ? 'auto' : values.scale }),
    ...(values.sheet === undefined ? {} : { sheet: values.sheet as SheetName }),
    ...(values.orientation === undefined ? {} : { orientation: values.orientation as Orientation }),
    ...(values.dimensions === undefined
      ? {}
      : { dimensions: values.dimensions as 'auto' | 'none' }),
  })

  if (!loaded.ok) {
    report(loaded.diagnostics, inputPath, false)
    return 1
  }

  if (command === 'check') {
    report(loaded.diagnostics, inputPath, values.quiet ?? false)
    const { warnings } = countBySeverity(loaded.diagnostics)
    if (values.strict && warnings > 0) return 1
    if (!values.quiet) {
      process.stderr.write(
        `ok: ${inputPath} is valid (${warnings} warning${warnings === 1 ? '' : 's'})\n`,
      )
    }
    return 0
  }

  let rendered: ReturnType<typeof renderDocument>
  try {
    rendered = renderDocument(loaded.document, format)
  } catch (cause) {
    process.stderr.write(`error: ${(cause as Error).message}\n`)
    return 1
  }

  const diagnostics = [...loaded.diagnostics, ...rendered.diagnostics]
  report(diagnostics, inputPath, values.quiet ?? false)
  if (values.strict && countBySeverity(diagnostics).warnings > 0) return 1

  const outputPath = values.output ?? defaultOutput(inputPath, format)
  if (outputPath === '-') {
    process.stdout.write(
      typeof rendered.content === 'string' ? rendered.content : Buffer.from(rendered.content),
    )
    return 0
  }

  try {
    await mkdir(dirname(resolve(outputPath)), { recursive: true })
    await writeFile(outputPath, rendered.content)
  } catch (cause) {
    process.stderr.write(`error: cannot write ${outputPath}: ${(cause as Error).message}\n`)
    return 1
  }

  if (!values.quiet) {
    process.stderr.write(
      `wrote ${outputPath} (${format.toUpperCase()}, scale ${rendered.drawing.scaleLabel}, ` +
        `sheet ${rendered.drawing.sheet.name.toUpperCase()})\n`,
    )
  }
  return 0
}

const optionSpec = {
  output: { type: 'string', short: 'o' },
  format: { type: 'string', short: 'f' },
  scale: { type: 'string', short: 's' },
  sheet: { type: 'string' },
  orientation: { type: 'string' },
  dimensions: { type: 'string' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

function resolveFormat(
  flag: string | undefined,
  output: string | undefined,
): OutputFormat | undefined {
  if (flag !== undefined) {
    const value = flag.toLowerCase()
    return value === 'svg' || value === 'pdf' ? value : undefined
  }
  if (output && output !== '-') {
    return extname(output).toLowerCase() === '.pdf' ? 'pdf' : 'svg'
  }
  return 'svg'
}

function defaultOutput(inputPath: string, format: OutputFormat): string {
  const extension = extname(inputPath)
  const base = extension ? inputPath.slice(0, -extension.length) : inputPath
  return `${base}.${format}`
}

function report(diagnostics: readonly Diagnostic[], inputPath: string, quiet: boolean): void {
  for (const diagnostic of diagnostics) {
    if (quiet && diagnostic.severity !== 'error') continue
    process.stderr.write(`${inputPath}: ${formatDiagnostic(diagnostic)}\n`)
  }
}

const code = await main(process.argv.slice(2))
process.exitCode = code
