import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boundsOfPoints, rectToPolygon, roundedRectToPolygon } from '../src/geometry/primitives.ts'
import { loadDocument, render } from '../src/index.ts'
import { readInput } from '../src/input/parse.ts'
import { normalizeDocument } from '../src/model/normalize.ts'
import { buildDrawing } from '../src/render/drawing.ts'
import { checkDocument } from '../src/validate/checks.ts'

const rect = { x: 100, y: 200, width: 310, height: 390 }

function codes(source: string): string[] {
  const input = readInput(source, 'test.yaml')
  assert.ok(input.ok, JSON.stringify(input))
  return checkDocument(normalizeDocument(input.value)).map((d) => d.code)
}

describe('rounded cutout corners', () => {
  it('falls back to a plain rectangle without a radius', () => {
    assert.deepEqual(roundedRectToPolygon(rect, 0), rectToPolygon(rect))
  })

  it('keeps the opening inside the rectangle it was given', () => {
    const points = roundedRectToPolygon(rect, 20)
    assert.ok(points.length > 4)
    assert.deepEqual(boundsOfPoints(points), {
      minX: 100,
      minY: 200,
      maxX: 410,
      maxY: 590,
    })
    for (const p of points) {
      assert.ok(p.x >= 100 - 1e-9 && p.x <= 410 + 1e-9, `x out of range: ${p.x}`)
      assert.ok(p.y >= 200 - 1e-9 && p.y <= 590 + 1e-9, `y out of range: ${p.y}`)
    }
  })

  it('rounds every corner, and nothing else', () => {
    const radius = 20
    const points = roundedRectToPolygon(rect, radius)
    // No point may sit in the square region a sharp corner would occupy.
    for (const [cx, cy] of [
      [100, 200],
      [410, 200],
      [410, 590],
      [100, 590],
    ] as Array<[number, number]>) {
      for (const p of points) {
        const inCornerBox = Math.abs(p.x - cx) < radius - 1e-6 && Math.abs(p.y - cy) < radius - 1e-6
        if (!inCornerBox) continue
        const distance = Math.hypot(p.x - (cx === 100 ? 120 : 390), p.y - (cy === 200 ? 220 : 570))
        assert.ok(
          Math.abs(distance - radius) < 1e-6,
          `point ${p.x},${p.y} is inside the corner but not on its arc`,
        )
      }
    }
  })

  it('is deterministic', () => {
    assert.deepEqual(roundedRectToPolygon(rect, 20), roundedRectToPolygon(rect, 20))
  })

  it('carries the radius through to the model', () => {
    const loaded = loadDocument(`
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, label: Zlew, x: 990, y: 530, width: 310, height: 390, cornerRadius: 20 }]
`)
    assert.ok(loaded.ok)
    const cutout = loaded.document.slabs[0]?.features[0]
    assert.ok(cutout?.kind === 'rect-cutout')
    assert.equal(cutout.cornerRadius, 20)
    assert.ok(cutout.outline.length > 4)
    // The bounding box is unchanged, so every clearance check still holds.
    assert.deepEqual(cutout.bounds, { minX: 990, minY: 530, maxX: 1300, maxY: 920 })
  })

  it('defaults to square corners', () => {
    const loaded = loadDocument(`
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: plyta, x: 150, y: 340, width: 495, height: 315 }]
`)
    assert.ok(loaded.ok)
    const cutout = loaded.document.slabs[0]?.features[0]
    assert.ok(cutout?.kind === 'rect-cutout')
    assert.equal(cutout.cornerRadius, 0)
    assert.equal(cutout.outline.length, 4)
  })

  it('rejects a radius larger than half the shorter side', () => {
    assert.ok(
      codes(`
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, x: 300, y: 300, width: 310, height: 390, cornerRadius: 200 }]
`).includes('E_CORNER_RADIUS'),
    )
    assert.deepEqual(
      codes(`
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, x: 300, y: 300, width: 310, height: 390, cornerRadius: 155 }]
`),
      [],
      'exactly half the shorter side is allowed',
    )
  })

  it('rejects a negative radius at the schema', () => {
    const result = readInput(
      `
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, x: 300, y: 300, width: 310, height: 390, cornerRadius: -5 }]
`,
      'test.yaml',
    )
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_SCHEMA')
  })

  it('draws the arc and calls the radius out on the drawing', () => {
    const source = `
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, label: Zlew, x: 990, y: 530, width: 310, height: 390, cornerRadius: 20 }]
`
    const loaded = loadDocument(source)
    assert.ok(loaded.ok)
    const { drawing } = buildDrawing(loaded.document)
    const outline = drawing.model.find(
      (entity) => entity.type === 'polyline' && entity.style.layer === 'cutout',
    )
    assert.ok(outline?.type === 'polyline')
    assert.ok(outline.points.length > 4, 'the opening should be drawn with arcs')

    const svg = render(source, 'svg').content as string
    assert.ok(
      svg.includes('4&#215; R20') || svg.includes('4× R20'),
      'the radius should say how many corners carry it',
    )

    // The callout has to point at the arc, or it says nothing about which
    // curve it means: an arrowhead within a whisker of the front-left corner.
    const radius = 20
    const arcCentre = { x: 990 + radius, y: 920 - radius }
    const onArc = {
      x: arcCentre.x - Math.SQRT1_2 * radius,
      y: arcCentre.y + Math.SQRT1_2 * radius,
    }
    const arrows = drawing.model.filter((e) => e.type === 'polygon')
    assert.ok(
      arrows.some((a) =>
        a.type === 'polygon'
          ? a.points.some((p) => Math.hypot(p.x - onArc.x, p.y - onArc.y) < 1)
          : false,
      ),
      'no arrowhead touches the arc it dimensions',
    )
  })

  it('says nothing about a radius when there is none', () => {
    const svg = render(
      `
countertop: { name: S, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: plyta, label: Plyta, x: 150, y: 340, width: 495, height: 315 }]
`,
      'svg',
    ).content as string
    assert.ok(!svg.includes('R0'))
    assert.ok(!/R\d/.test(svg))
  })
})
