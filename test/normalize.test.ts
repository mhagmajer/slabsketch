import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readInput } from '../src/input/parse.ts'
import type { InputFile } from '../src/input/schema.ts'
import { normalizeDocument } from '../src/model/normalize.ts'
import { MINIMAL_YAML, exampleYaml } from './helpers.ts'

function input(source: string): InputFile {
  const result = readInput(source, 'test.yaml')
  assert.ok(result.ok, JSON.stringify(result))
  return result.value
}

describe('coordinate normalisation', () => {
  it('turns width and depth into a closed outline starting at the origin', () => {
    const doc = normalizeDocument(input(MINIMAL_YAML))
    const slab = doc.slabs[0]
    assert.ok(slab)
    assert.deepEqual(slab.outline, [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 600 },
      { x: 0, y: 600 },
    ])
    assert.deepEqual(slab.bounds, { minX: 0, minY: 0, maxX: 1000, maxY: 600 })
  })

  it('anchors a cutout by its back-left corner', () => {
    const doc = normalizeDocument(input(MINIMAL_YAML))
    const cutout = doc.slabs[0]?.features.find((f) => f.id === 'sink')
    assert.ok(cutout && cutout.kind === 'rect-cutout')
    assert.deepEqual(cutout.rect, { x: 200, y: 100, width: 400, height: 300 })
    assert.deepEqual(cutout.bounds, { minX: 200, minY: 100, maxX: 600, maxY: 400 })
    assert.equal(cutout.label, 'Sink')
  })

  it('anchors a hole by its centre and derives the radius', () => {
    const doc = normalizeDocument(input(MINIMAL_YAML))
    const hole = doc.slabs[0]?.features.find((f) => f.id === 'tap')
    assert.ok(hole && hole.kind === 'circle-hole')
    assert.deepEqual(hole.center, { x: 800, y: 300 })
    assert.equal(hole.radius, 20)
    assert.deepEqual(hole.bounds, { minX: 780, minY: 280, maxX: 820, maxY: 320 })
    assert.equal(hole.label, undefined)
  })

  it('keeps input order, cutouts before holes', () => {
    const doc = normalizeDocument(input(exampleYaml()))
    assert.deepEqual(
      doc.slabs[0]?.features.map((f) => f.id),
      ['hob', 'sink', 'faucet', 'dispenser'],
    )
  })

  it('parses the drawing scale into a factor', () => {
    assert.equal(normalizeDocument(input(MINIMAL_YAML)).drawing.scale, 0.1)
    assert.equal(normalizeDocument(input(MINIMAL_YAML), { scale: '1:20' }).drawing.scale, 0.05)
    assert.equal(normalizeDocument(input(MINIMAL_YAML), { scale: 'auto' }).drawing.scale, 'auto')
  })

  it('lets the caller override sheet and orientation', () => {
    const doc = normalizeDocument(input(MINIMAL_YAML), { sheet: 'a2', orientation: 'portrait' })
    assert.equal(doc.drawing.sheet, 'a2')
    assert.equal(doc.drawing.orientation, 'portrait')
  })

  it('rejects an unusable scale override', () => {
    assert.throws(() => normalizeDocument(input(MINIMAL_YAML), { scale: '1:0' }), /invalid scale/)
  })
})
