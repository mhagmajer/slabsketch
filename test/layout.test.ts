import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LAYOUT, frameArea, notesCapacity, sheetSize, stripHeight } from '../src/geometry/layout.ts'
import { loadDocument } from '../src/index.ts'
import type { SheetName } from '../src/model/types.ts'
import { buildDrawing, drawingPaperBounds } from '../src/render/drawing.ts'

const examplesDir = fileURLToPath(new URL('../examples', import.meta.url))
const examples = readdirSync(examplesDir)
  .filter((name) => name.endsWith('.yaml'))
  .sort()

function documentOf(name: string, sheet?: SheetName) {
  const source = readFileSync(join(examplesDir, name), 'utf8')
  const loaded = loadDocument(source, { filename: name, ...(sheet ? { sheet } : {}) })
  assert.ok(loaded.ok, `${name}: ${loaded.diagnostics.map((d) => d.message).join('; ')}`)
  return loaded.document
}

describe('sheet margins', () => {
  it('finds example inputs to check', () => {
    assert.ok(examples.length >= 4, `expected several examples, found ${examples.join(', ')}`)
  })

  for (const name of examples) {
    for (const sheet of ['a4', 'a3', 'a2'] as SheetName[]) {
      it(`keeps ${name} inside the page on ${sheet.toUpperCase()}`, () => {
        const { drawing, diagnostics } = buildDrawing(documentOf(name, sheet), { source: name })
        assert.ok(
          !diagnostics.some((d) => d.code === 'W_SCALE_CLAMPED'),
          'auto scale should always find a fit on these sheets',
        )

        const bounds = drawingPaperBounds(drawing)
        const page = drawing.sheet
        // Nothing may reach the paper edge: the frame is inset, and the only
        // thing outside it is the generator stamp in the bottom margin.
        const margin = 2
        assert.ok(bounds.minX >= margin, `left margin is ${bounds.minX.toFixed(2)} mm`)
        assert.ok(bounds.minY >= margin, `top margin is ${bounds.minY.toFixed(2)} mm`)
        assert.ok(
          page.width - bounds.maxX >= margin,
          `right margin is ${(page.width - bounds.maxX).toFixed(2)} mm`,
        )
        assert.ok(
          page.height - bounds.maxY >= margin,
          `bottom margin is ${(page.height - bounds.maxY).toFixed(2)} mm`,
        )
      })
    }
  }

  it('keeps the part and its dimensions inside the frame', () => {
    for (const name of examples) {
      const { drawing } = buildDrawing(documentOf(name))
      const frame = frameArea(drawing.sheet)
      const model = drawingPaperBounds({ ...drawing, paper: [] })
      assert.ok(
        model.minX >= frame.x &&
          model.minY >= frame.y &&
          model.maxX <= frame.x + frame.width &&
          model.maxY <= frame.y + frame.height,
        `${name}: drawing content escapes the frame`,
      )
    }
  })

  it('keeps the drawing clear of the title block strip', () => {
    for (const name of examples) {
      const { drawing } = buildDrawing(documentOf(name))
      const frame = frameArea(drawing.sheet)
      const stripTop = frame.y + frame.height - LAYOUT.titleBlockHeight - LAYOUT.titleBlockGap
      const model = drawingPaperBounds({ ...drawing, paper: [] })
      assert.ok(model.maxY <= stripTop, `${name}: drawing overlaps the title block strip`)
    }
  })

  it('narrows the title block on a small sheet so the notes still have room', () => {
    const a2 = sheetSize('a2', 'landscape')
    const a5 = sheetSize('a5', 'landscape')
    assert.equal(
      Math.min(LAYOUT.titleBlockWidth, frameArea(a2).width * LAYOUT.titleBlockMaxFraction),
      LAYOUT.titleBlockWidth,
    )
    assert.ok(
      frameArea(a5).width * LAYOUT.titleBlockMaxFraction < LAYOUT.titleBlockWidth,
      'A5 should get a narrowed title block',
    )
  })

  it('grows the strip for a longer list of notes, up to a share of the sheet', () => {
    const sheet = sheetSize('a3', 'landscape')
    // The strip starts at the title block's height and only grows when it must.
    assert.equal(stripHeight(sheet, 3), LAYOUT.titleBlockHeight)
    assert.ok(stripHeight(sheet, 12) > LAYOUT.titleBlockHeight)
    assert.ok(notesCapacity(sheet, 12) >= 12, 'twelve notes should simply fit')

    // But it stops: the drawing itself needs the sheet.
    const frame = frameArea(sheet)
    assert.ok(stripHeight(sheet, 200) <= frame.height * LAYOUT.stripMaxFraction + 1e-9)
  })

  it('says when notes will not all fit, rather than dropping them quietly', () => {
    const sheet = sheetSize('a3', 'landscape')
    // Enough notes to exceed even the grown strip.
    const many = 200
    const capacity = notesCapacity(sheet, many)
    assert.ok(capacity > 7 && capacity < many, `implausible capacity: ${capacity}`)

    const notes = Array.from({ length: capacity + 2 }, (_, i) => `Uwaga numer ${i + 1}`)
    const source = `
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
notes:
${notes.map((n) => `  - ${n}`).join('\n')}
`
    const loaded = loadDocument(source)
    assert.ok(loaded.ok)
    const { diagnostics } = buildDrawing(loaded.document)
    const warning = diagnostics.find((d) => d.code === 'W_NOTES_TRUNCATED')
    assert.ok(warning, 'expected a warning when notes overflow the strip')
    assert.match(warning.message, new RegExp(String(capacity)))

    // And a list that fits raises nothing.
    const fits = loadDocument(`
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
notes:
${notes
  .slice(0, capacity)
  .map((n) => `  - ${n}`)
  .join('\n')}
`)
    assert.ok(fits.ok)
    assert.ok(!buildDrawing(fits.document).diagnostics.some((d) => d.code === 'W_NOTES_TRUNCATED'))
  })

  it('reports honestly when a drawing cannot fit', () => {
    const { diagnostics } = buildDrawing(documentOf('kitchen-countertop.yaml', 'a5'))
    assert.ok(diagnostics.some((d) => d.code === 'W_SCALE_CLAMPED'))
  })
})
