import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { render } from '../src/index.ts'
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
    assert.match(text, /\/Encoding \/WinAnsiEncoding/)
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

  it('includes a creation date only when one is supplied', () => {
    const result = render(exampleYaml(), 'pdf', { pdf: { creationDate: 'D:20260101120000Z' } })
    assert.ok(
      Buffer.from(result.content as Uint8Array)
        .toString('latin1')
        .includes('/CreationDate'),
    )
  })
})
