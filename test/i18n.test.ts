import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LANGUAGES, strings } from '../src/i18n.ts'
import { render } from '../src/index.ts'
import { VERSION } from '../src/version.ts'
import { exampleYaml } from './helpers.ts'

const polishExample = readFileSync(
  fileURLToPath(new URL('../examples/blat-kuchenny.yaml', import.meta.url)),
  'utf8',
)

function svg(source: string, options: Parameters<typeof render>[2] = {}): string {
  return render(source, 'svg', options).content as string
}

describe('generated text', () => {
  it('defaults to English', () => {
    const out = svg(exampleYaml())
    assert.ok(out.includes('Material:'))
    assert.ok(out.includes('Thickness:'))
    assert.ok(out.includes('PRELIMINARY DRAWING'))
    assert.ok(out.includes('NOTES:'))
  })

  it('translates every generated string when asked for Polish', () => {
    const out = svg(exampleYaml(), { language: 'pl' })
    const pl = strings('pl')
    for (const expected of [
      `${pl.material}:`,
      `${pl.thickness}:`,
      `${pl.scale} 1:10`,
      `${pl.units}: mm`,
      `${pl.sheet}: A3`,
      `${pl.drawnBy}:`,
      `${pl.notesHeading}:`,
      pl.preliminary,
    ]) {
      assert.ok(out.includes(escapeForSvg(expected)), `missing "${expected}"`)
    }
    for (const english of ['Material:', 'Thickness:', 'PRELIMINARY DRAWING', 'Units:', 'Sheet:']) {
      assert.ok(!out.includes(english), `English "${english}" leaked into a Polish drawing`)
    }
  })

  it('reproduces input text as written, whatever the language', () => {
    // Names and labels come from the file and are never translated.
    const out = svg(polishExample)
    assert.ok(out.includes('Blat kuchenny'))
    assert.ok(out.includes('P&#322;yta indukcyjna') || out.includes('Płyta indukcyjna'))
    assert.ok(out.includes('Zlew podwieszany'))

    const english = svg(exampleYaml(), { language: 'pl' })
    assert.ok(english.includes('Kitchen countertop'), 'the slab name stays as written')
    assert.ok(english.includes('Hob'))
  })

  it('takes the language from the input file as well as the flag', () => {
    const fromFile = svg(polishExample)
    assert.ok(fromFile.includes(strings('pl').preliminary))
    const overridden = svg(polishExample, { language: 'en' })
    assert.ok(overridden.includes('PRELIMINARY DRAWING'))
  })

  it('offers exactly the languages it implements', () => {
    assert.deepEqual([...LANGUAGES], ['en', 'pl'])
    for (const language of LANGUAGES) {
      const table = strings(language)
      assert.ok(table.preliminary.length > 20)
      assert.ok(table.generatedWith().includes(VERSION))
    }
  })
})

describe('generator stamp', () => {
  it('names the tool and its version', () => {
    const out = svg(exampleYaml())
    assert.ok(out.includes(`<!-- SlabSketch v${VERSION} -->`))
    assert.ok(out.includes(`Generated with SlabSketch v${VERSION}`))
  })

  it('names the source file when one is known', () => {
    assert.ok(svg(exampleYaml(), { source: 'blat.yaml' }).includes('from blat.yaml'))
    assert.ok(!svg(exampleYaml()).includes(' from '))
  })

  it('is translated too', () => {
    const out = svg(exampleYaml(), { language: 'pl', source: 'blat.yaml' })
    assert.ok(out.includes(`Wygenerowano w SlabSketch v${VERSION} z pliku blat.yaml`))
  })

  it('describes the drawing in its own language', () => {
    assert.match(render(exampleYaml(), 'svg').drawing.description, /^SlabSketch technical drawing/)
    assert.match(
      render(exampleYaml(), 'svg', { language: 'pl' }).drawing.description,
      /^Rysunek techniczny/,
    )
  })
})

function escapeForSvg(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
