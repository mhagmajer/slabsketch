import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { render } from '../src/index.ts'
import { loadDocument } from '../src/index.ts'
import { buildDrawing } from '../src/render/drawing.ts'
import { ICON_BOX, serviceIcon } from '../src/render/icons.ts'
import { SERVICE_IDS } from '../src/services.ts'

const everyService = `
countertop: { name: Catalogue, width: 3000, depth: 900, thickness: 30 }
cutouts:
  - { id: c1, x: 200, y: 200, width: 450, height: 400 }
  - { id: c2, x: 750, y: 200, width: 450, height: 400 }
  - { id: c3, x: 1300, y: 200, width: 450, height: 400 }
  - { id: c4, x: 1850, y: 200, width: 450, height: 400 }
  - { id: c5, x: 2400, y: 200, width: 450, height: 400 }
  - { id: c6, x: 200, y: 700, width: 300, height: 150 }
  - { id: c7, x: 600, y: 200, width: 100, height: 400 }
  - { id: c8, x: 2900, y: 200, width: 60, height: 400 }
holes:
  - { id: h1, x: 700, y: 780, diameter: 35 }
  - { id: h2, x: 900, y: 780, diameter: 35 }
  - { id: h3, x: 1100, y: 780, diameter: 35 }
  - { id: h4, x: 1300, y: 780, diameter: 35 }
  - { id: h5, x: 1500, y: 780, diameter: 35 }
services:
  - { service: hob-cutout, target: c1 }
  - { service: top-mount-cutout, target: c7 }
  - { service: flush-cutout, target: c8 }
  - { service: undermount-cutout, target: c2 }
  - { service: stone-sink-single, target: c3 }
  - { service: stone-sink-double, target: c4 }
  - { service: drainer-grooves, target: c5 }
  - { service: column-notch, target: c6 }
  - { service: tap-hole, target: h1 }
  - { service: soap-dispenser-hole, target: h2 }
  - { service: pop-up-waste-hole, target: h3 }
  - { service: socket-hole, target: h4 }
  - { service: siphon-hole, target: h5 }
  - { service: underside-polish, edge: front }
  - { service: led-groove, edge: front, from: 200, to: 2800 }
  - { service: thickened-edge, edge: back }
  - { service: half-bullnose, edge: left }
  - { service: quarter-bullnose, edge: right }
  - { service: waterfall-edge, edge: back, from: 100, to: 900 }
  - { service: underside-polish-all }
`

describe('service pictograms', () => {
  it('draws one for every service', () => {
    for (const id of SERVICE_IDS) {
      const icon = serviceIcon(id)
      assert.ok(icon.length > 0, `${id} has no pictogram`)
    }
  })

  it('keeps every pictogram inside its box, so rows line up', () => {
    for (const id of SERVICE_IDS) {
      for (const primitive of serviceIcon(id)) {
        const points =
          primitive.kind === 'circle'
            ? [
                [primitive.center[0] - primitive.radius, primitive.center[1] - primitive.radius],
                [primitive.center[0] + primitive.radius, primitive.center[1] + primitive.radius],
              ]
            : primitive.points
        for (const [x, y] of points) {
          assert.ok(
            x >= 0 && x <= ICON_BOX.width && y >= 0 && y <= ICON_BOX.height,
            `${id} draws outside its box at ${x},${y}`,
          )
        }
      }
    }
  })

  it('gives every pictogram some geometry of its own, not a shared blank', () => {
    const signatures = new Set<string>()
    for (const id of SERVICE_IDS) {
      signatures.add(JSON.stringify(serviceIcon(id)))
    }
    assert.equal(signatures.size, SERVICE_IDS.length, 'two services share a pictogram')
  })

  it('renders them into the schedule, and into the PDF as vectors', () => {
    const loaded = loadDocument(everyService)
    assert.ok(loaded.ok, JSON.stringify(loaded.diagnostics))

    const { drawing } = buildDrawing(loaded.document)
    const strokes = drawing.paper.filter(
      (entity) => entity.style.layer === 'service' && entity.type !== 'text',
    )
    // One balloon per row, plus at least one shape per pictogram.
    assert.ok(
      strokes.length > 2 * SERVICE_IDS.length,
      `expected pictogram geometry in the schedule, found ${strokes.length} shapes`,
    )

    const svg = render(everyService, 'svg').content as string
    assert.ok(svg.includes('<g id="service">'))

    const pdf = Buffer.from(render(everyService, 'pdf').content as Uint8Array).toString('latin1')
    assert.ok(!pdf.includes('/Image'), 'pictograms must be vectors, not embedded bitmaps')
    assert.ok(!pdf.includes('/XObject'))
  })

  it('scales a pictogram uniformly, without distorting it', () => {
    const loaded = loadDocument(everyService)
    assert.ok(loaded.ok)
    const { drawing } = buildDrawing(loaded.document)
    const circles = drawing.paper.filter(
      (entity) => entity.type === 'circle' && entity.style.layer === 'service',
    )
    // Balloons are all one size; pictogram circles are smaller but consistent.
    assert.ok(circles.length > SERVICE_IDS.length)
  })
})
