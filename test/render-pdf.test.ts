import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { render } from '../src/index.ts'
import { VERSION } from '../src/version.ts'
import { exampleYaml } from './helpers.ts'

function pdf(): string {
  const result = render(exampleYaml(), 'pdf')
  assert.ok(result.content instanceof Uint8Array)
  return Buffer.from(result.content).toString('latin1')
}

describe('PDF rendering', () => {
  it('writes a well-formed PDF 1.4 file', () => {
    const text = pdf()
    assert.ok(text.startsWith('%PDF-1.4\n'))
    assert.ok(text.endsWith('%%EOF\n'))
    assert.match(text, /\/Type \/Catalog/)
    assert.match(text, /\/Type \/Page[^s]/)
  })

  it('sizes the page in points, from the sheet in millimetres', () => {
    // A3 landscape: 420 x 297 mm at 72/25.4 points per mm.
    assert.match(pdf(), /\/MediaBox \[0 0 1190\.551 841\.89\]/)
  })

  it('has an xref table whose offsets point at their objects', () => {
    const text = pdf()
    const match = /startxref\n(\d+)\n%%EOF/.exec(text)
    assert.ok(match?.[1])
    const xrefStart = Number(match[1])
    assert.ok(text.startsWith('xref\n', xrefStart), 'startxref does not point at the xref table')

    const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefStart))
    assert.ok(header?.[1])
    const count = Number(header[1])

    // Line 0 is the free entry; lines 1..count-1 point at objects 1..count-1.
    const entries = text
      .slice(xrefStart + (header[0]?.length ?? 0))
      .split('\n')
      .slice(1, count)
    assert.equal(entries.length, count - 1)
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10))
      assert.ok(
        text.startsWith(`${index + 1} 0 obj`, offset),
        `xref entry ${index + 1} points at "${text.slice(offset, offset + 12)}"`,
      )
    })
  })

  it('uses the base-14 Helvetica faces, embedding nothing', () => {
    const text = pdf()
    assert.match(text, /\/BaseFont \/Helvetica /)
    assert.match(text, /\/BaseFont \/Helvetica-Bold /)
    assert.match(text, /\/BaseEncoding \/WinAnsiEncoding/)
    assert.ok(!text.includes('/FontFile'))
  })

  it('encodes the diameter sign in WinAnsi', () => {
    // U+00D8 is octal 330 in WinAnsiEncoding.
    assert.ok(pdf().includes('(\\33035) Tj'))
  })

  it('carries no timestamp, so runs are byte-identical', () => {
    const a = Buffer.from(render(exampleYaml(), 'pdf').content as Uint8Array)
    const b = Buffer.from(render(exampleYaml(), 'pdf').content as Uint8Array)
    assert.ok(a.equals(b))
    assert.ok(!a.toString('latin1').includes('/CreationDate'))
  })

  it('maps Polish characters onto spare codes, without embedding a font', () => {
    const polish = readFileSync(
      fileURLToPath(new URL('../examples/blat-kuchenny.yaml', import.meta.url)),
      'utf8',
    )
    const text = Buffer.from(render(polish, 'pdf').content as Uint8Array).toString('latin1')

    const differences = /\/Differences \[([^\]]*)\]/.exec(text)
    assert.ok(differences?.[1], 'expected an /Differences table for the Polish glyphs')
    for (const glyph of ['lslash', 'aogonek', 'eogonek', 'sacute', 'cacute', 'zdotaccent']) {
      assert.ok(differences[1].includes(`/${glyph}`), `missing glyph ${glyph}`)
    }
    assert.ok(!text.includes('/FontFile'), 'no font should be embedded')

    // Every code handed out must be free in WinAnsiEncoding's upper half.
    const codes = [...differences[1].matchAll(/(\d+) \//g)].map((m) => Number(m[1]))
    assert.equal(new Set(codes).size, codes.length, 'codes must be unique')
    for (const code of codes) assert.ok(code >= 0x80 && code <= 0xff, `code ${code} out of range`)

    // Nothing may have silently degraded to a question mark.
    const stream = text.slice(text.indexOf('stream'), text.indexOf('endstream'))
    assert.ok(!stream.includes('?) Tj'), 'a character was dropped from the content stream')
  })

  it('is deterministic for Polish text too', () => {
    const polish = readFileSync(
      fileURLToPath(new URL('../examples/blat-kuchenny.yaml', import.meta.url)),
      'utf8',
    )
    const a = Buffer.from(render(polish, 'pdf').content as Uint8Array)
    const b = Buffer.from(render(polish, 'pdf').content as Uint8Array)
    assert.ok(a.equals(b))
  })

  it('names itself and its version in the metadata', () => {
    const text = pdf()
    assert.ok(text.includes(`/Producer (SlabSketch v${VERSION})`))
    assert.ok(text.includes(`/Creator (SlabSketch v${VERSION})`))
  })

  it('includes a creation date only when one is supplied', () => {
    const result = render(exampleYaml(), 'pdf', { pdf: { creationDate: 'D:20260101120000Z' } })
    assert.ok(
      Buffer.from(result.content as Uint8Array)
        .toString('latin1')
        .includes('/CreationDate'),
    )
  })
})
