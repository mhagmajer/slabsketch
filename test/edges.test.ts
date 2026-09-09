import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hatchLines } from '../src/geometry/primitives.ts'
import { strings } from '../src/i18n.ts'
import { loadDocument, render } from '../src/index.ts'
import { readInput } from '../src/input/parse.ts'
import { normalizeDocument } from '../src/model/normalize.ts'
import { buildDrawing } from '../src/render/drawing.ts'
import { checkDocument } from '../src/validate/checks.ts'

const slab = (edges: string) => `
countertop:
  name: Blat
  width: 1400
  depth: 1000
  thickness: 20
  edges: { ${edges} }
`

function codes(source: string): string[] {
  const input = readInput(source, 'test.yaml')
  assert.ok(input.ok, JSON.stringify(input))
  return checkDocument(normalizeDocument(input.value)).map((d) => d.code)
}

describe('edge constraints', () => {
  it('leaves every edge open unless told otherwise', () => {
    const loaded = loadDocument(`
countertop: { name: Blat, width: 1400, depth: 1000, thickness: 20 }
`)
    assert.ok(loaded.ok)
    assert.deepEqual(loaded.document.slabs[0]?.edges, {
      back: 'open',
      front: 'open',
      left: 'open',
      right: 'open',
    })
  })

  it('records what each edge abuts', () => {
    const loaded = loadDocument(slab('back: wall, left: wall, right: cabinet'))
    assert.ok(loaded.ok)
    assert.deepEqual(loaded.document.slabs[0]?.edges, {
      back: 'wall',
      front: 'open',
      left: 'wall',
      right: 'cabinet',
    })
  })

  it('rejects an unknown kind of obstruction', () => {
    const result = readInput(slab('back: curtain'), 'test.yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_SCHEMA')
  })

  it('draws a band for a constrained edge and nothing for an open one', () => {
    const open = loadDocument(slab('front: open'))
    assert.ok(open.ok)
    assert.equal(
      buildDrawing(open.document).drawing.model.filter((e) => e.style.layer === 'boundary').length,
      0,
    )

    const walled = loadDocument(slab('back: wall'))
    assert.ok(walled.ok)
    const band = buildDrawing(walled.document).drawing.model.filter(
      (e) => e.style.layer === 'boundary',
    )
    // An outline, a label, and the hatching in between.
    assert.ok(band.some((e) => e.type === 'polyline'))
    assert.ok(band.some((e) => e.type === 'text'))
    assert.ok(band.filter((e) => e.type === 'line').length > 3, 'a wall should be hatched')
  })

  it('hatches masonry but leaves a unit as a dashed outline', () => {
    const cabinet = loadDocument(slab('back: cabinet'))
    assert.ok(cabinet.ok)
    const band = buildDrawing(cabinet.document).drawing.model.filter(
      (e) => e.style.layer === 'boundary',
    )
    assert.equal(band.filter((e) => e.type === 'line').length, 0, 'a unit is not hatched')
    const outline = band.find((e) => e.type === 'polyline')
    assert.ok(outline?.style.dash, 'a unit is outlined with a dashed line')
  })

  it('names the obstruction in the drawing language', () => {
    const source = slab('back: wall, right: cabinet')
    const pl = render(source, 'svg', { language: 'pl' }).content as string
    assert.ok(pl.includes(strings('pl').edgeConstraints.wall))
    assert.ok(pl.includes(strings('pl').edgeConstraints.cabinet))
    const en = render(source, 'svg', { language: 'en' }).content as string
    assert.ok(en.includes('WALL'))
    assert.ok(en.includes('CABINET'))
  })

  it('keeps the dimensions clear of the bands', () => {
    const walled = loadDocument(slab('back: wall, left: wall'))
    assert.ok(walled.ok)
    const { drawing } = buildDrawing(walled.document)
    const bandTop = Math.min(
      ...drawing.model
        .filter((e) => e.style.layer === 'boundary' && e.type === 'polyline')
        .flatMap((e) => (e.type === 'polyline' ? e.points.map((p) => p.y) : [])),
    )
    const dimTop = Math.min(
      ...drawing.model
        .filter((e) => e.style.layer === 'dimension' && e.type === 'line')
        .flatMap((e) => (e.type === 'line' ? [e.a.y, e.b.y] : [])),
    )
    assert.ok(dimTop < bandTop, 'dimension bands must sit beyond the wall band')
  })

  it('sends a leader clear of the band, not onto its hatching', () => {
    // A hole tight against a walled edge has to label itself outside the part,
    // and the band marking the wall is in the way.
    const source = `
countertop:
  name: Blat
  width: 1400
  depth: 710
  thickness: 20
  edges: { back: wall }
cutouts: [{ id: plyta, label: Płyta, x: 40, y: 100, width: 315, height: 495 }]
holes: [{ id: gaz, label: Rura gazowa, x: 110, y: 40, diameter: 35 }]
`
    const loaded = loadDocument(source)
    assert.ok(loaded.ok)
    const { drawing } = buildDrawing(loaded.document)
    const label = drawing.model.find((e) => e.type === 'text' && e.text === 'Rura gazowa')
    assert.ok(label?.type === 'text')

    const bandOuterEdge = Math.min(
      ...drawing.model
        .filter((e) => e.style.layer === 'boundary' && e.type === 'polyline')
        .flatMap((e) => (e.type === 'polyline' ? e.points.map((p) => p.y) : [])),
    )
    assert.ok(
      label.at.y <= bandOuterEdge,
      `label sits at y=${label.at.y.toFixed(0)}, on a band that ends at ${bandOuterEdge.toFixed(0)}`,
    )
  })

  it('warns when an edge service is applied to an edge nobody will see', () => {
    const found = codes(`${slab('front: wall')}
services: [{ service: half-bullnose, edge: front }]
`)
    assert.ok(found.includes('W_SERVICE_ON_HIDDEN_EDGE'), found.join(', '))

    assert.deepEqual(
      codes(`${slab('back: wall')}
services: [{ service: half-bullnose, edge: front }]
`),
      [],
      'a service on an open edge is fine',
    )
  })
})

describe('hatching', () => {
  it('stays inside the box it fills', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 20 }
    const lines = hatchLines(box, 4)
    assert.ok(lines.length > 10)
    for (const [a, b] of lines) {
      for (const p of [a, b]) {
        assert.ok(p.x >= -1e-9 && p.x <= 100 + 1e-9 && p.y >= -1e-9 && p.y <= 20 + 1e-9)
      }
    }
  })

  it('is deterministic', () => {
    const box = { minX: 5, minY: 5, maxX: 60, maxY: 25 }
    assert.deepEqual(hatchLines(box, 3), hatchLines(box, 3))
  })
})
