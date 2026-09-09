import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadDocument, render } from '../src/index.ts'
import type { CountertopDocument } from '../src/model/types.ts'
import { buildDrawing, toPaper } from '../src/render/drawing.ts'
import { renderSvg } from '../src/render/svg.ts'
import { MINIMAL_YAML, assertSnapshot, exampleYaml } from './helpers.ts'

function documentOf(source: string): CountertopDocument {
  const loaded = loadDocument(source, { filename: 'test.yaml' })
  assert.ok(loaded.ok, JSON.stringify(loaded.diagnostics))
  return loaded.document
}

describe('SVG rendering', () => {
  it('sizes the page in real millimetres', () => {
    const svg = render(exampleYaml(), 'svg').content as string
    assert.match(
      svg,
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!-- SlabSketch v[\d.]+ -->\n<svg /,
    )
    assert.match(svg, /width="420mm" height="297mm"/)
    assert.match(svg, /viewBox="0 0 420 297"/)
    assert.ok(svg.trimEnd().endsWith('</svg>'))
  })

  it('draws a rectangular cutout as a closed polygon at the right paper position', () => {
    const { drawing } = buildDrawing(documentOf(MINIMAL_YAML))
    const cutout = drawing.model.find(
      (entity) => entity.type === 'polyline' && entity.style.layer === 'cutout',
    )
    assert.ok(cutout?.type === 'polyline')
    assert.equal(cutout.closed, true)
    assert.deepEqual(cutout.points, [
      { x: 200, y: 100 },
      { x: 600, y: 100 },
      { x: 600, y: 400 },
      { x: 200, y: 400 },
    ])

    // The same corners, projected onto the sheet, must appear in the SVG.
    const svg = renderSvg(drawing)
    const corners = cutout.points
      .map((p) => toPaper(drawing.transform, p))
      .map((p) => `${round(p.x)},${round(p.y)}`)
      .join(' ')
    assert.ok(svg.includes(`<polygon points="${corners}"`), 'projected cutout not found in the SVG')
  })

  it('draws a circular hole with the radius derived from the diameter', () => {
    const { drawing } = buildDrawing(documentOf(MINIMAL_YAML))
    const circle = drawing.model.find((entity) => entity.type === 'circle')
    assert.ok(circle?.type === 'circle')
    assert.deepEqual(circle.center, { x: 800, y: 300 })
    assert.equal(circle.radius, 20)

    const paper = toPaper(drawing.transform, circle.center)
    const svg = renderSvg(drawing)
    assert.ok(
      svg.includes(
        `<circle cx="${round(paper.x)}" cy="${round(paper.y)}" r="${round(20 * drawing.scale)}"`,
      ),
      'projected hole not found in the SVG',
    )
  })

  it('separates the drawing into named layers', () => {
    const svg = render(exampleYaml(), 'svg').content as string
    for (const layer of [
      'frame',
      'outline',
      'cutout',
      'hole',
      'dimension',
      'annotation',
      'title',
    ]) {
      assert.ok(svg.includes(`<g id="${layer}">`), `missing layer ${layer}`)
    }
  })

  it('honours --dimensions none', () => {
    const withDims = render(exampleYaml(), 'svg').content as string
    const without = render(exampleYaml(), 'svg', { dimensions: 'none' }).content as string
    assert.ok(withDims.includes('<g id="dimension">'))
    assert.ok(!without.includes('<g id="dimension">'))
    assert.ok(without.includes('<g id="outline">'))
  })

  it('picks the largest standard scale that fits the sheet', () => {
    assert.equal(render(exampleYaml(), 'svg').drawing.scaleLabel, '1:10')
    assert.equal(render(exampleYaml(), 'svg', { sheet: 'a4' }).drawing.scaleLabel, '1:20')
    assert.equal(render(exampleYaml(), 'svg', { scale: '1:25' }).drawing.scaleLabel, '1:25')
  })

  it('escapes text that would otherwise break the XML', () => {
    const svg = render(
      `countertop: { name: "Bath <&> \\"top\\"", width: 800, depth: 500, thickness: 20 }`,
      'svg',
    ).content as string
    assert.ok(svg.includes('Bath &lt;&amp;&gt; &quot;top&quot;'))
    assert.ok(!svg.includes('Bath <&>'))
  })

  it('puts a leader label on the far side of its shoulder from the hole', () => {
    // A tap boxed in against the front edge: the leader points forwards, so the
    // label must sit below the shoulder rather than back over the hole.
    const { drawing } = buildDrawing(
      documentOf(`
countertop: { name: Utility, width: 1800, depth: 600, thickness: 20 }
cutouts:
  - { id: sink, label: Sink, x: 700, y: 30, width: 500, height: 420 }
  - { id: drainer, label: Drainer, x: 1230, y: 60, width: 300, height: 380 }
holes: [{ id: tap, label: Tap, x: 1215, y: 500, diameter: 35 }]
`),
    )
    const label = drawing.model.find((entity) => entity.type === 'text' && entity.text === 'Tap')
    const diameter = drawing.model.find((entity) => entity.type === 'text' && entity.text === 'Ø35')
    assert.ok(label?.type === 'text' && diameter?.type === 'text')
    assert.equal(label.baseline, 'top', 'a downward leader hangs its label below the shoulder')
    assert.ok(label.at.y > 500, 'label should be past the hole, not over it')
    assert.ok(diameter.at.y > label.at.y, 'the diameter reads under the name')
  })

  it('produces byte-identical output for the same input', () => {
    const a = render(exampleYaml(), 'svg').content as string
    const b = render(exampleYaml(), 'svg').content as string
    assert.equal(a, b)
  })

  it('matches the golden drawing for the kitchen example', () => {
    const svg = render(exampleYaml(), 'svg').content as string
    assertSnapshot('kitchen-countertop.svg', svg)
  })
})

function round(value: number): number {
  const r = Math.round(value * 1000) / 1000
  return r === 0 ? 0 : r
}
