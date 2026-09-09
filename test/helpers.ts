import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXAMPLE_YAML = fileURLToPath(
  new URL('../examples/kitchen-countertop.yaml', import.meta.url),
)
export const EXAMPLE_JSON = fileURLToPath(
  new URL('../examples/kitchen-countertop.json', import.meta.url),
)
export const CLI_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

export function exampleYaml(): string {
  return readFileSync(EXAMPLE_YAML, 'utf8')
}

export function exampleJson(): string {
  return readFileSync(EXAMPLE_JSON, 'utf8')
}

/** A deliberately tiny document, so tests can state exactly what they expect. */
export const MINIMAL_YAML = `
countertop:
  name: Test slab
  width: 1000
  depth: 600
  thickness: 20
cutouts:
  - id: sink
    label: Sink
    x: 200
    y: 100
    width: 400
    height: 300
holes:
  - id: tap
    x: 800
    y: 300
    diameter: 40
drawing:
  scale: "1:10"
`

/**
 * Golden-file comparison. Missing snapshots are written on the spot when running
 * locally, but never in CI, so a forgotten snapshot cannot pass silently.
 */
export function assertSnapshot(name: string, actual: string): void {
  const path = fileURLToPath(new URL(`./__snapshots__/${name}`, import.meta.url))
  const update = process.env.UPDATE_SNAPSHOTS === '1'
  if (!existsSync(path)) {
    if (process.env.CI) {
      assert.fail(`snapshot ${name} is missing; run "npm run test:update" and commit it`)
    }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, actual)
    return
  }
  if (update) {
    writeFileSync(path, actual)
    return
  }
  const expected = readFileSync(path, 'utf8')
  assert.equal(actual, expected, `snapshot ${name} differs; run "npm run test:update" to accept`)
}
