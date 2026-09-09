import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { GENERATOR, VERSION } from '../src/version.ts'

describe('version', () => {
  it('matches package.json, so the stamp on a drawing is not a lie', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string }
    assert.equal(VERSION, pkg.version)
  })

  it('reads as a name and a version', () => {
    assert.equal(GENERATOR, `SlabSketch v${VERSION}`)
  })
})
