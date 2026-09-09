import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectFormat, parseSource, readInput } from '../src/input/parse.ts'
import { exampleJson, exampleYaml } from './helpers.ts'

describe('input parsing', () => {
  it('detects the format from the file extension', () => {
    assert.equal(detectFormat('a.yaml', ''), 'yaml')
    assert.equal(detectFormat('a.yml', ''), 'yaml')
    assert.equal(detectFormat('a.json', ''), 'json')
    assert.equal(detectFormat('A.JSON', ''), 'json')
  })

  it('falls back to sniffing the content', () => {
    assert.equal(detectFormat(undefined, '  {"countertop": {}}'), 'json')
    assert.equal(detectFormat(undefined, 'countertop:\n  width: 10'), 'yaml')
    assert.equal(detectFormat('notes.txt', '{"a":1}'), 'json')
  })

  it('parses YAML into a plain object', () => {
    const result = parseSource('countertop:\n  width: 100\n', 'yaml')
    assert.ok(result.ok)
    assert.deepEqual(result.value, { countertop: { width: 100 } })
  })

  it('reads YAML and JSON of the same drawing identically', () => {
    const fromYaml = readInput(exampleYaml(), 'example.yaml')
    const fromJson = readInput(exampleJson(), 'example.json')
    assert.ok(fromYaml.ok, JSON.stringify(fromYaml))
    assert.ok(fromJson.ok, JSON.stringify(fromJson))
    assert.deepEqual(fromJson.value, fromYaml.value)
  })

  it('reports an empty file', () => {
    const result = parseSource('', 'yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_PARSE')
  })

  it('rejects a top-level sequence', () => {
    const result = parseSource('- 1\n- 2\n', 'yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_PARSE')
    assert.match(result.diagnostics[0]?.message ?? '', /mapping/)
  })

  it('reports malformed YAML rather than throwing', () => {
    const result = parseSource('countertop: [1, 2\n', 'yaml')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_PARSE')
  })

  it('reports malformed JSON rather than throwing', () => {
    const result = parseSource('{"countertop":', 'json')
    assert.ok(!result.ok)
    assert.equal(result.diagnostics[0]?.code, 'E_PARSE')
  })
})
