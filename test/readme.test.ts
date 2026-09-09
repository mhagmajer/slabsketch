import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LANGUAGES } from '../src/i18n.ts'
import { loadDocument, render } from '../src/index.ts'
import { LAYER_ORDER } from '../src/render/svg.ts'
import { SERVICE_IDS } from '../src/services.ts'

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')

/** Diagnostic codes the code can actually raise. */
function diagnosticCodes(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL('../src/diagnostics.ts', import.meta.url)),
    'utf8',
  )
  return [...source.matchAll(/\| '([EW]_[A-Z_]+)'/g)].map((m) => m[1] as string)
}

describe('the README', () => {
  it('shows an input file that actually validates', () => {
    // Documentation that cannot be run is documentation that drifts.
    const block = /```yaml\nversion: 1\n([\s\S]*?)```/.exec(readme)
    assert.ok(block?.[1], 'no reference YAML block found in the README')

    const loaded = loadDocument(`version: 1\n${block[1]}`, { filename: 'README.md' })
    assert.ok(
      loaded.ok,
      `the reference example does not validate:\n${loaded.diagnostics
        .map((d) => `  ${d.code} ${d.message}`)
        .join('\n')}`,
    )
    assert.deepEqual(loaded.diagnostics, [], 'the reference example should be clean')

    // And it should render, not merely parse.
    const svg = render(`version: 1\n${block[1]}`, 'svg').content as string
    assert.ok(svg.startsWith('<?xml'))
  })

  it('documents every diagnostic the tool can raise', () => {
    for (const code of diagnosticCodes()) {
      assert.ok(readme.includes(`\`${code}\``), `${code} is not in the README`)
    }
  })

  it('documents every service in the catalogue', () => {
    for (const id of SERVICE_IDS) {
      assert.ok(readme.includes(`\`${id}\``), `service ${id} is not in the README`)
    }
  })

  it('documents every drawing layer', () => {
    for (const layer of LAYER_ORDER) {
      assert.ok(readme.includes(`\`${layer}\``), `layer ${layer} is not in the README`)
    }
  })

  it('documents every language the tool speaks', () => {
    for (const language of LANGUAGES) {
      assert.ok(readme.includes(`\`${language}\``), `language ${language} is not in the README`)
    }
  })
})
