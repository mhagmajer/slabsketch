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
      it(`never overflows ${sheet.toUpperCase()} without saying so for ${name}`, () => {
        const { drawing, diagnostics } = buildDrawing(documentOf(name, sheet), { source: name })
        const clamped = diagnostics.some((d) => d.code === 'W_SCALE_CLAMPED')

        const bounds = drawingPaperBounds(drawing)
        const page = drawing.sheet
        const margin = 2
        const fits =
          bounds.minX >= margin &&
          bounds.minY >= margin &&
          page.width - bounds.maxX >= margin &&
          page.height - bounds.maxY >= margin

        // A drawing may be too big for a sheet - a long note list and a full
        // schedule can leave too little room. What it may never do is run off
        // the paper while claiming to have fitted.
        assert.ok(
          fits || clamped,
          `${name} on ${sheet} runs off the page with no W_SCALE_CLAMPED ` +
            `(x ${bounds.minX.toFixed(1)}..${bounds.maxX.toFixed(1)} of ${page.width})`,
        )
      })
    }
  }

  it('fits every example on A3, the sheet they are drawn for', () => {
    for (const name of examples) {
      const { diagnostics } = buildDrawing(documentOf(name, 'a3'), { source: name })
      assert.ok(!diagnostics.some((d) => d.code === 'W_SCALE_CLAMPED'), `${name} does not fit A3`)
    }
  })

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
