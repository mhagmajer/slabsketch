import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LAYOUT, scheduleLayout, sheetSize } from '../src/geometry/layout.ts'
import { strings } from '../src/i18n.ts'
import { loadDocument, render } from '../src/index.ts'
import { readInput } from '../src/input/parse.ts'
import { normalizeDocument, serviceTag } from '../src/model/normalize.ts'
import type { CountertopDocument } from '../src/model/types.ts'
import { buildDrawing } from '../src/render/drawing.ts'
import { SERVICE_IDS, serviceDefinition, serviceName } from '../src/services.ts'
import { checkDocument } from '../src/validate/checks.ts'

const slab = `
countertop: { name: Blat, width: 2000, depth: 600, thickness: 30 }
cutouts: [{ id: zlew, label: Zlew, x: 800, y: 100, width: 500, height: 400 }]
holes: [{ id: bateria, label: Bateria, x: 600, y: 80, diameter: 35 }]
`

function documentOf(source: string): CountertopDocument {
  const input = readInput(source, 'test.yaml')
  assert.ok(input.ok, JSON.stringify(input))
  return normalizeDocument(input.value)
}

function codes(source: string): string[] {
  return checkDocument(documentOf(source)).map((d) => d.code)
}

describe('service catalogue', () => {
  it('covers every service on the order form', () => {
    assert.equal(SERVICE_IDS.length, 18)
    const byScope = new Map<string, number>()
    for (const id of SERVICE_IDS) {
      const scope = serviceDefinition(id).scope
      byScope.set(scope, (byScope.get(scope) ?? 0) + 1)
    }
    assert.deepEqual([...byScope.entries()].sort(), [
      ['cutout', 6],
      ['edge', 6],
      ['hole', 5],
      ['slab', 1],
    ])
  })

  it('names every service in both languages', () => {
    for (const id of SERVICE_IDS) {
      for (const language of ['en', 'pl'] as const) {
        assert.ok(serviceName(id, language).length > 3, `${id} has no ${language} name`)
      }
    }
  })

  it('numbers marks A, B ... Z, AA', () => {
    assert.equal(serviceTag(0), 'A')
    assert.equal(serviceTag(25), 'Z')
    assert.equal(serviceTag(26), 'AA')
  })
})

describe('resolving a selection', () => {
  it('measures an edge run in millimetres', () => {
    const doc = documentOf(`${slab}
services: [{ service: half-bullnose, edge: front }]
`)
    const selected = doc.slabs[0]?.services[0]
    assert.ok(selected)
    assert.equal(selected.tag, 'A')
    assert.equal(selected.scope, 'edge')
    assert.deepEqual(selected.quantity, { kind: 'length', value: 2000 })
    // The front edge runs left to right along y = depth.
    assert.deepEqual(selected.run?.start, { x: 0, y: 600 })
    assert.deepEqual(selected.run?.end, { x: 2000, y: 600 })
    assert.deepEqual(selected.run?.inward, { x: 0, y: -1 })
  })

  it('trims a run to the requested range', () => {
    const doc = documentOf(`${slab}
services: [{ service: led-groove, edge: left, from: 100, to: 400 }]
`)
    const selected = doc.slabs[0]?.services[0]
    assert.equal(selected?.quantity.value, 300)
    assert.deepEqual(selected?.run?.start, { x: 0, y: 100 })
    assert.deepEqual(selected?.run?.end, { x: 0, y: 400 })
  })

  it('counts a service on a feature, and measures a whole-slab one in square metres', () => {
    const doc = documentOf(`${slab}
services:
  - { service: undermount-cutout, target: zlew }
  - { service: underside-polish-all }
`)
    const [first, second] = doc.slabs[0]?.services ?? []
    assert.deepEqual(first?.quantity, { kind: 'count', value: 1 })
    assert.deepEqual(second?.quantity, { kind: 'area', value: 1.2 })
    assert.equal(second?.tag, 'B')
  })
})

describe('validating a selection', () => {
  it('accepts a well-formed set', () => {
    assert.deepEqual(
      codes(`${slab}
services:
  - { service: undermount-cutout, target: zlew }
  - { service: tap-hole, target: bateria }
  - { service: half-bullnose, edge: front }
  - { service: underside-polish-all }
`),
      [],
    )
  })

  it('rejects an unknown service outright', () => {
    const result = readInput(`${slab}\nservices: [{ service: gold-plating }]\n`, 't.yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_SCHEMA')
  })

  it('rejects a target that does not exist', () => {
    assert.ok(
      codes(`${slab}
services: [{ service: tap-hole, target: nieistniejacy }]
`).includes('E_SERVICE_TARGET'),
    )
  })

  it('rejects a service applied to the wrong kind of thing', () => {
    assert.ok(
      codes(`${slab}
services: [{ service: tap-hole, target: zlew }]
`).includes('E_SERVICE_SCOPE'),
      'a tap hole cannot be applied to a cutout',
    )
    assert.ok(
      codes(`${slab}
services: [{ service: undermount-cutout, target: bateria }]
`).includes('E_SERVICE_SCOPE'),
      'a cutout service cannot be applied to a hole',
    )
    assert.ok(
      codes(`${slab}
services: [{ service: half-bullnose, edge: front, target: zlew }]
`).includes('E_SERVICE_SCOPE'),
      'an edge service cannot also name a target',
    )
  })

  it('requires an edge for an edge service and a target for a feature service', () => {
    assert.ok(
      codes(`${slab}\nservices: [{ service: half-bullnose }]\n`).includes('E_SERVICE_TARGET'),
    )
    assert.ok(codes(`${slab}\nservices: [{ service: tap-hole }]\n`).includes('E_SERVICE_TARGET'))
  })

  it('rejects a run that leaves the edge or measures nothing', () => {
    assert.ok(
      codes(`${slab}
services: [{ service: led-groove, edge: front, from: 0, to: 2500 }]
`).includes('E_SERVICE_RANGE'),
    )
    assert.ok(
      codes(`${slab}
services: [{ service: led-groove, edge: front, from: 500, to: 500 }]
`).includes('E_SERVICE_RANGE'),
    )
  })

  it('warns when the same service is chosen twice for the same place', () => {
    assert.ok(
      codes(`${slab}
services:
  - { service: half-bullnose, edge: front }
  - { service: half-bullnose, edge: front }
`).includes('W_DUPLICATE_SERVICE'),
    )
  })
})

describe('marking a selection on the drawing', () => {
  const source = `${slab}
services:
  - { service: undermount-cutout, target: zlew }
  - { service: tap-hole, target: bateria }
  - { service: half-bullnose, edge: front }
  - { service: underside-polish-all }
`

  it('draws one balloon per marked element, and none for a whole-slab service', () => {
    const loaded = loadDocument(source)
    assert.ok(loaded.ok)
    const { drawing } = buildDrawing(loaded.document)
    const tags = drawing.model
      .filter((e) => e.type === 'text' && e.style.layer === 'service')
      .map((e) => (e.type === 'text' ? e.text : ''))
    // A on the cutout, B on the hole, C on the front edge; D is the whole slab.
    assert.deepEqual(tags.sort(), ['A', 'B', 'C'])
  })

  it('lists every selection in the schedule, whole-slab ones included', () => {
    const svg = render(source, 'svg').content as string
    assert.ok(svg.includes('ADDITIONAL SERVICES'))
    for (const id of [
      'undermount-cutout',
      'tap-hole',
      'half-bullnose',
      'underside-polish-all',
    ] as const) {
      assert.ok(svg.includes(serviceName(id, 'en')), `${id} missing from the schedule`)
    }
    assert.ok(svg.includes('whole slab'))
    assert.ok(svg.includes('1.20 m'), 'the whole-slab area should be quoted')
    assert.ok(svg.includes('front edge'))
  })

  it('translates the schedule', () => {
    const svg = render(source, 'svg', { language: 'pl' }).content as string
    assert.ok(svg.includes(strings('pl').servicesHeading))
    assert.ok(svg.includes(serviceName('half-bullnose', 'pl')))
    assert.ok(svg.includes('ca&#322;y blat') || svg.includes('cały blat'))
  })

  it('marks services even when the drawing is not dimensioned', () => {
    const svg = render(source, 'svg', { dimensions: 'none' }).content as string
    assert.ok(svg.includes('<g id="service">'))
  })

  it('draws nothing extra when nothing was selected', () => {
    const svg = render(slab, 'svg').content as string
    assert.ok(!svg.includes('<g id="service">'))
    assert.ok(!svg.includes('ADDITIONAL SERVICES'))
    assert.equal(scheduleLayout(sheetSize('a3', 'landscape'), 0).height, 0)
  })

  it('takes the schedule out of the sheet height, not its width', () => {
    const sheet = sheetSize('a3', 'landscape')
    const layout = scheduleLayout(sheet, 8)
    assert.ok(layout.columns >= 2, 'A3 should hold several schedule columns')
    assert.ok(layout.height > LAYOUT.scheduleRowHeight)
    // Eight services over four columns need two rows, not eight.
    assert.equal(layout.columns, 4)
    assert.ok(layout.height < 40, `schedule band is ${layout.height} mm tall`)
  })
})
