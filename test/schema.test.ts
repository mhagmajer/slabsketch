import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readInput, validateInput } from '../src/input/parse.ts'

const base = {
  countertop: { name: 'Slab', width: 1000, depth: 600, thickness: 20 },
}

function codesAndPaths(raw: unknown): string[] {
  const result = validateInput(raw)
  assert.ok(!result.ok, 'expected validation to fail')
  return result.diagnostics.map((d) => `${d.code}:${d.path ?? ''}`)
}

describe('input schema', () => {
  it('applies documented defaults', () => {
    const result = validateInput(base)
    assert.ok(result.ok)
    assert.equal(result.value.version, 1)
    assert.deepEqual(result.value.cutouts, [])
    assert.deepEqual(result.value.holes, [])
    assert.deepEqual(result.value.notes, [])
    assert.equal(result.value.drawing.sheet, 'a3')
    assert.equal(result.value.drawing.orientation, 'landscape')
    assert.equal(result.value.drawing.scale, 'auto')
    assert.equal(result.value.drawing.dimensions, 'auto')
    assert.deepEqual(result.value.drawing.reference, { x: 'left', y: 'back' })
    assert.equal(result.value.checks.minEdgeDistance, 50)
  })

  it('rejects negative and zero sizes', () => {
    assert.deepEqual(codesAndPaths({ countertop: { ...base.countertop, width: -1 } }), [
      'E_SCHEMA:countertop.width',
    ])
    assert.deepEqual(codesAndPaths({ countertop: { ...base.countertop, thickness: 0 } }), [
      'E_SCHEMA:countertop.thickness',
    ])
  })

  it('rejects a missing required field', () => {
    const { width, ...rest } = base.countertop
    void width
    assert.deepEqual(codesAndPaths({ countertop: rest }), ['E_SCHEMA:countertop.width'])
  })

  it('rejects unknown keys, so typos are never silently ignored', () => {
    const codes = codesAndPaths({
      ...base,
      cutouts: [{ id: 'sink', x: 0, y: 0, width: 10, hight: 10 }],
    })
    assert.ok(
      codes.some((c) => c.startsWith('E_SCHEMA:cutouts[0]')),
      codes.join(', '),
    )
  })

  it('rejects an invalid diameter', () => {
    assert.deepEqual(codesAndPaths({ ...base, holes: [{ id: 'tap', x: 1, y: 1, diameter: 0 }] }), [
      'E_SCHEMA:holes[0].diameter',
    ])
  })

  it('rejects malformed coordinates', () => {
    assert.deepEqual(
      codesAndPaths({ ...base, holes: [{ id: 'tap', x: 'left', y: 1, diameter: 10 }] }),
      ['E_SCHEMA:holes[0].x'],
    )
  })

  it('rejects ids that would not survive a round trip', () => {
    assert.deepEqual(
      codesAndPaths({ ...base, holes: [{ id: 'tap hole', x: 1, y: 1, diameter: 10 }] }),
      ['E_SCHEMA:holes[0].id'],
    )
  })

  it('accepts both scale spellings and rejects nonsense', () => {
    assert.ok(validateInput({ ...base, drawing: { scale: '1:20' } }).ok)
    assert.ok(validateInput({ ...base, drawing: { scale: 0.05 } }).ok)
    assert.ok(validateInput({ ...base, drawing: { scale: 'auto' } }).ok)
    assert.ok(!validateInput({ ...base, drawing: { scale: 'huge' } }).ok)
  })

  it('reports several problems at once', () => {
    const codes = codesAndPaths({
      countertop: { name: 'Slab', width: -1, depth: 600, thickness: -2 },
    })
    assert.equal(codes.length, 2)
  })

  it('surfaces a parse error before a schema error', () => {
    const result = readInput('countertop: [', 'a.yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_PARSE')
  })
})
