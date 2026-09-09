#!/usr/bin/env node
/**
 * Render every example input into examples/output/.
 *
 * Doubles as a worked example of the library API: load, then render, with the
 * diagnostics reported rather than swallowed.
 */

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatDiagnostic, loadDocument, renderDocument } from '../src/index.ts'
import type { OutputFormat } from '../src/index.ts'

const examplesDir = fileURLToPath(new URL('../examples', import.meta.url))
const outputDir = join(examplesDir, 'output')
const docsDir = fileURLToPath(new URL('../docs', import.meta.url))

/**
 * The one generated drawing that is committed: the README shows it, so it has
 * to be in the repository. CI regenerates it and fails on a dirty tree, which
 * is what stops it drifting away from the code that made it.
 */
const README_DRAWING = { source: 'kitchen-countertop.yaml', target: 'example-drawing.svg' }

const formats: OutputFormat[] = ['svg', 'pdf']

async function main(): Promise<number> {
  await mkdir(outputDir, { recursive: true })

  const inputs = (await readdir(examplesDir)).filter((name) => name.endsWith('.yaml')).sort()

  await mkdir(docsDir, { recursive: true })

  let failures = 0
  for (const name of inputs) {
    const source = await readFile(join(examplesDir, name), 'utf8')
    const loaded = loadDocument(source, { filename: name })

    for (const diagnostic of loaded.diagnostics) {
      process.stderr.write(`${name}: ${formatDiagnostic(diagnostic)}\n`)
    }
    if (!loaded.ok) {
      failures++
      continue
    }

    for (const format of formats) {
      const { content, drawing } = renderDocument(loaded.document, format, { source: name })
      const outputName = `${basename(name, extname(name))}.${format}`
      await writeFile(join(outputDir, outputName), content)
      process.stdout.write(
        `examples/output/${outputName}  ${drawing.scaleLabel}  ${drawing.sheet.name.toUpperCase()}\n`,
      )
    }

    if (name === README_DRAWING.source) {
      await copyFile(
        join(outputDir, `${basename(name, extname(name))}.svg`),
        join(docsDir, README_DRAWING.target),
      )
      process.stdout.write(`docs/${README_DRAWING.target}\n`)
    }
  }
  return failures === 0 ? 0 : 1
}

process.exitCode = await main()
