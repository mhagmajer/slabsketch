import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Diagnostic } from '../src/diagnostics.ts'
import { loadDocument } from '../src/index.ts'
import { readInput } from '../src/input/parse.ts'
import { normalizeDocument } from '../src/model/normalize.ts'
import { checkDocument } from '../src/validate/checks.ts'
import { exampleYaml } from './helpers.ts'

function check(source: string): Diagnostic[] {
  const input = readInput(source, 'test.yaml')
  assert.ok(input.ok, JSON.stringify(input))
  return checkDocument(normalizeDocument(input.value))
}

function codes(source: string): string[] {
  return check(source).map((d) => d.code)
}

const slab = `
countertop: { name: Slab, width: 1000, depth: 600, thickness: 20 }
checks: { minEdgeDistance: 50, minFeatureDistance: 50 }
`

describe('geometric checks', () => {
  it('passes the shipped example with no errors and no warnings', () => {
    const diagnostics = check(exampleYaml())
    assert.deepEqual(diagnostics, [], diagnostics.map((d) => d.message).join('\n'))
  })

  it('reports duplicate ids across cutouts and holes', () => {
    const diagnostics = check(`${slab}
cutouts: [{ id: sink, x: 100, y: 100, width: 200, height: 200 }]
holes: [{ id: sink, x: 800, y: 300, diameter: 40 }]
`)
    assert.ok(diagnostics.some((d) => d.code === 'E_DUPLICATE_ID' && d.elementId === 'sink'))
  })

  it('reports a cutout that leaves the slab', () => {
    const diagnostics = check(`${slab}
cutouts: [{ id: sink, x: 900, y: 100, width: 200, height: 200 }]
`)
    const error = diagnostics.find((d) => d.code === 'E_CUTOUT_OUT_OF_BOUNDS')
    assert.ok(error)
    assert.equal(error.severity, 'error')
    assert.equal(error.path, 'cutouts[0]')
  })

  it('reports a hole that leaves the slab', () => {
    assert.ok(
      codes(`${slab}
holes: [{ id: tap, x: 990, y: 300, diameter: 40 }]
`).includes('E_HOLE_OUT_OF_BOUNDS'),
    )
  })

  it('reports a negative coordinate as out of bounds', () => {
    assert.ok(
      codes(`${slab}
cutouts: [{ id: sink, x: -10, y: 100, width: 200, height: 200 }]
`).includes('E_CUTOUT_OUT_OF_BOUNDS'),
    )
  })

  it('reports a hole drilled inside a cutout', () => {
    const diagnostics = check(`${slab}
cutouts: [{ id: sink, x: 200, y: 100, width: 400, height: 300 }]
holes: [{ id: tap, x: 400, y: 250, diameter: 40 }]
`)
    const error = diagnostics.find((d) => d.code === 'E_HOLE_INSIDE_CUTOUT')
    assert.ok(error)
    assert.equal(error.elementId, 'tap')
  })

  it('warns about a feature close to an edge', () => {
    const diagnostics = check(`${slab}
cutouts: [{ id: sink, x: 10, y: 100, width: 200, height: 200 }]
`)
    const warn = diagnostics.find((d) => d.code === 'W_EDGE_CLEARANCE')
    assert.ok(warn)
    assert.equal(warn.severity, 'warning')
    assert.match(warn.message, /10 mm/)
  })

  it('warns about a thin bridge between two features', () => {
    const diagnostics = check(`${slab}
cutouts:
  - { id: a, x: 100, y: 100, width: 200, height: 200 }
  - { id: b, x: 320, y: 100, width: 200, height: 200 }
`)
    const warn = diagnostics.find((d) => d.code === 'W_FEATURE_CLEARANCE')
    assert.ok(warn)
    assert.match(warn.message, /20 mm/)
  })

  it('warns about overlapping cutouts without calling it an error', () => {
    const diagnostics = check(`${slab}
cutouts:
  - { id: a, x: 100, y: 100, width: 200, height: 200 }
  - { id: b, x: 250, y: 100, width: 200, height: 200 }
`)
    const warn = diagnostics.find((d) => d.code === 'W_CUTOUT_OVERLAP')
    assert.ok(warn)
    assert.equal(warn.severity, 'warning')
  })

  it('honours configurable thresholds', () => {
    const relaxed = `
countertop: { name: Slab, width: 1000, depth: 600, thickness: 20 }
checks: { minEdgeDistance: 5, minFeatureDistance: 5 }
cutouts: [{ id: sink, x: 10, y: 100, width: 200, height: 200 }]
`
    assert.deepEqual(codes(relaxed), [])
  })

  it('makes loadDocument fail on errors but succeed with warnings', () => {
    const withError = loadDocument(`${slab}
cutouts: [{ id: sink, x: 900, y: 100, width: 200, height: 200 }]
`)
    assert.equal(withError.ok, false)

    const withWarning = loadDocument(`${slab}
cutouts: [{ id: sink, x: 10, y: 100, width: 200, height: 200 }]
`)
    assert.equal(withWarning.ok, true)
    assert.ok(withWarning.ok && withWarning.diagnostics.length > 0)
  })
})
