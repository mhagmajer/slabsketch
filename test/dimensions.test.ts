import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Dimension,
  type LinearDimension,
  autoDimensions,
  packDimensions,
} from '../src/geometry/dimensions.ts'
import { readInput } from '../src/input/parse.ts'
import { normalizeDocument } from '../src/model/normalize.ts'
import type { Slab } from '../src/model/types.ts'
import { textWidth } from '../src/text.ts'
import { MINIMAL_YAML, exampleYaml } from './helpers.ts'

const TEXT_SIZE = 2.5

function slabOf(source: string): Slab {
  const input = readInput(source, 'test.yaml')
  assert.ok(input.ok, JSON.stringify(input))
  const slab = normalizeDocument(input.value).slabs[0]
  assert.ok(slab)
  return slab
}

function dimensionsOf(source: string, scale = 0.1): Dimension[] {
  const dimensions = autoDimensions(slabOf(source), {
    reference: { x: 'left', y: 'back' },
    scale,
    textSizePaper: TEXT_SIZE,
  })
  packDimensions(dimensions, scale, TEXT_SIZE)
  return dimensions
}

function linear(dimensions: Dimension[]): LinearDimension[] {
  return dimensions.filter((d): d is LinearDimension => d.kind === 'linear')
}

describe('automatic dimensioning', () => {
  it('measures the overall size, every offset and every diameter', () => {
    const dimensions = dimensionsOf(exampleYaml())
    const byId = new Map(dimensions.map((d) => [d.id, d]))

    assert.equal(textOf(byId.get('overall.width')), '2840')
    assert.equal(textOf(byId.get('overall.depth')), '620')
    assert.equal(textOf(byId.get('hob.width')), '560')
    assert.equal(textOf(byId.get('hob.height')), '490')
    assert.equal(textOf(byId.get('hob.x')), '500')
    assert.equal(textOf(byId.get('hob.y')), '65')
    assert.equal(textOf(byId.get('sink.width')), '540')
    assert.equal(textOf(byId.get('sink.x')), '1650')
    assert.equal(textOf(byId.get('faucet.x')), '1920')
    assert.equal(textOf(byId.get('faucet.diameter')), 'Ø35')
    assert.equal(textOf(byId.get('dispenser.diameter')), 'Ø28')
  })

  it('measures offsets from the reference edge on both axes', () => {
    const slab = slabOf(MINIMAL_YAML)
    const fromRight = autoDimensions(slab, {
      reference: { x: 'right', y: 'front' },
      scale: 0.1,
      textSizePaper: TEXT_SIZE,
    })
    const byId = new Map(fromRight.map((d) => [d.id, d]))
    // Slab 1000 x 600, cutout at 200,100 sized 400 x 300.
    assert.equal(textOf(byId.get('sink.x')), '400')
    assert.equal(textOf(byId.get('sink.y')), '200')
    // Hole centred at 800,300 in a 1000 x 600 slab.
    assert.equal(textOf(byId.get('tap.x')), '200')
    assert.equal(textOf(byId.get('tap.y')), '300')
  })

  it('drops dimensions that would measure nothing', () => {
    const ids = dimensionsOf(`
countertop: { name: S, width: 1000, depth: 600, thickness: 20 }
cutouts: [{ id: flush, x: 0, y: 0, width: 400, height: 300 }]
`).map((d) => d.id)
    assert.ok(!ids.includes('flush.x'))
    assert.ok(!ids.includes('flush.y'))
    assert.ok(ids.includes('flush.width'))
  })

  it('collapses duplicate measurements, such as two taps on one centre line', () => {
    const ids = dimensionsOf(exampleYaml())
      .filter((d) => d.kind === 'linear' && d.axis === 'y')
      .map((d) => d.id)
    // faucet and dispenser share y = 75; only one of the two survives.
    assert.equal(ids.filter((id) => id === 'faucet.y' || id === 'dispenser.y').length, 1)
  })

  it('dimensions a large opening from the inside, and a small one from a band', () => {
    const large = dimensionsOf(exampleYaml(), 0.1)
    const hobWidth = large.find((d) => d.id === 'hob.width')
    assert.ok(hobWidth?.kind === 'linear')
    assert.equal(hobWidth.placement, 'inside')
    assert.ok(hobWidth.linePos !== undefined && hobWidth.linePos > 65)

    const small = dimensionsOf(exampleYaml(), 0.01)
    const smallHobWidth = small.find((d) => d.id === 'hob.width')
    assert.ok(smallHobWidth?.kind === 'linear')
    assert.equal(smallHobWidth.placement, 'band')
  })

  it('never puts two labels in the same band on top of each other', () => {
    for (const scale of [0.1, 0.05, 0.02]) {
      const placed = linear(dimensionsOf(exampleYaml(), scale)).filter(
        (d) => d.placement === 'band',
      )
      const groups = new Map<string, LinearDimension[]>()
      for (const dimension of placed) {
        const key = `${dimension.side}:${dimension.band}`
        const list = groups.get(key)
        if (list) list.push(dimension)
        else groups.set(key, [dimension])
      }
      for (const [key, group] of groups) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = span(group[i] as LinearDimension, scale)
            const b = span(group[j] as LinearDimension, scale)
            assert.ok(
              a.max <= b.min + 1e-6 || b.max <= a.min + 1e-6,
              `at scale ${scale}, band ${key}: ${group[i]?.id} overlaps ${group[j]?.id}`,
            )
          }
        }
      }
    }
  })

  it('starts the innermost band right next to the part', () => {
    const placed = linear(dimensionsOf(exampleYaml())).filter((d) => d.placement === 'band')
    for (const side of ['top', 'left']) {
      const bands = placed.filter((d) => d.side === side).map((d) => d.band)
      assert.equal(Math.min(...bands), 0, `${side} band numbering should start at 0`)
    }
  })

  it('puts the overall size in the outermost band', () => {
    const placed = linear(dimensionsOf(exampleYaml())).filter((d) => d.placement === 'band')
    const top = placed.filter((d) => d.side === 'top')
    const overall = top.find((d) => d.id === 'overall.width')
    assert.ok(overall)
    assert.equal(overall.band, Math.max(...top.map((d) => d.band)))
  })

  it('keeps hole leaders clear of the part edge and of one another', () => {
    const scale = 0.1
    const slab = slabOf(exampleYaml())
    const leaders = dimensionsOf(exampleYaml(), scale).filter((d) => d.kind === 'diameter')
    assert.equal(leaders.length, 2)

    let previousRight = Number.NEGATIVE_INFINITY
    for (const leader of leaders) {
      assert.ok(leader.kind === 'diameter')
      const kneeY =
        leader.center.y + leader.direction.y * (leader.radius + leader.leaderPaper / scale)
      assert.ok(kneeY < slab.bounds.minY, `${leader.id} shoulder should clear the back edge`)
      const kneeX =
        leader.center.x + leader.direction.x * (leader.radius + leader.leaderPaper / scale)
      assert.ok(kneeX * scale >= previousRight, `${leader.id} overlaps the previous label`)
      previousRight = kneeX * scale + textWidth(leader.text, TEXT_SIZE)
    }
  })

  it('keeps a leader label in open material when there is room for one', () => {
    const source = `
countertop: { name: Vanity, width: 1200, depth: 500, thickness: 30 }
cutouts: [{ id: basin, label: Basin, x: 380, y: 120, width: 440, height: 300 }]
holes: [{ id: waste, label: Waste, x: 1050, y: 250, diameter: 25 }]
`
    const scale = 0.1
    const leader = dimensionsOf(source, scale).find((d) => d.kind === 'diameter')
    assert.ok(leader?.kind === 'diameter')

    // Deep in open material, the leader stays short and the label stays inside
    // the part, rather than being dragged out past the back edge.
    assert.ok(leader.leaderPaper < 15, `leader is ${leader.leaderPaper} mm long`)
    const kneeY =
      leader.center.y + leader.direction.y * (leader.radius + leader.leaderPaper / scale)
    assert.ok(kneeY > 0, 'label should sit inside the slab')
  })

  it('turns a leader inwards rather than letting its label cross an edge', () => {
    // The same hole, moved next to the right edge: pointing right would run the
    // label off the part, so the leader flips to the left instead.
    const source = `
countertop: { name: Vanity, width: 1200, depth: 500, thickness: 30 }
cutouts: [{ id: basin, label: Basin, x: 380, y: 120, width: 440, height: 300 }]
holes: [{ id: waste, label: Waste overflow, x: 1150, y: 250, diameter: 25 }]
`
    const leader = dimensionsOf(source, 0.1).find((d) => d.kind === 'diameter')
    assert.ok(leader?.kind === 'diameter')
    assert.ok(leader.direction.x < 0, 'leader should point away from the near edge')
  })

  it('pushes a leader label clear of the part when nothing inside is free', () => {
    // Boxed in by the back edge above and an opening below: the only clear
    // placement is outside the part.
    const source = `
countertop: { name: Vanity, width: 1200, depth: 500, thickness: 30 }
cutouts: [{ id: basin, label: Basin, x: 100, y: 120, width: 1000, height: 300 }]
holes: [{ id: tap, label: Tap, x: 600, y: 60, diameter: 35 }]
`
    const scale = 0.1
    const leader = dimensionsOf(source, scale).find((d) => d.kind === 'diameter')
    assert.ok(leader?.kind === 'diameter')
    const kneeY =
      leader.center.y + leader.direction.y * (leader.radius + leader.leaderPaper / scale)
    assert.ok(kneeY < 0, `label should be pushed past the back edge, knee at y=${kneeY}`)
  })

  it('escapes through whichever edge of the part is nearest', () => {
    // The tap is boxed in by two openings; the front edge is 100 mm away and
    // the back edge 500 mm, so the leader goes forwards.
    const source = `
countertop: { name: Utility, width: 1800, depth: 600, thickness: 20 }
cutouts:
  - { id: sink, label: Sink, x: 700, y: 30, width: 500, height: 420 }
  - { id: drainer, label: Drainer, x: 1230, y: 60, width: 300, height: 380 }
holes: [{ id: tap, label: Tap, x: 1215, y: 500, diameter: 35 }]
`
    const scale = 0.1
    const leader = dimensionsOf(source, scale).find((d) => d.kind === 'diameter')
    assert.ok(leader?.kind === 'diameter')
    assert.ok(leader.direction.y > 0, 'leader should point towards the front edge')
    const kneeY =
      leader.center.y + leader.direction.y * (leader.radius + leader.leaderPaper / scale)
    assert.ok(kneeY > 600, `label should clear the front edge, knee at y=${kneeY}`)
  })

  it('fans leaders outwards, so their labels never cross', () => {
    // Two holes centred over a sink: the left one must not reach across the
    // right one, or the two leaders draw an X.
    const source = `
countertop: { name: Blat, width: 1400, depth: 1000, thickness: 20 }
cutouts: [{ id: zlew, label: Zlew, x: 990, y: 530, width: 310, height: 390 }]
holes:
  - { id: bateria, label: Bateria Flex 6020, x: 1085, y: 460, diameter: 35 }
  - { id: dozownik, label: Dozownik Slim 500, x: 1205, y: 460, diameter: 35 }
`
    const scale = 0.1
    const leaders = dimensionsOf(source, scale)
      .filter((d) => d.kind === 'diameter')
      .sort((a, b) =>
        a.kind === 'diameter' && b.kind === 'diameter' ? a.center.x - b.center.x : 0,
      )
    assert.equal(leaders.length, 2)

    const kneeX = leaders.map((d) => {
      assert.ok(d.kind === 'diameter')
      return d.center.x + d.direction.x * (d.radius + d.leaderPaper / scale)
    })
    assert.ok(
      (kneeX[0] as number) < (kneeX[1] as number),
      `leaders cross: knees at ${kneeX.map((x) => x.toFixed(0)).join(' and ')}`,
    )
  })

  it('leaves a lone hole pointing the default way', () => {
    const leader = dimensionsOf(`
countertop: { name: Blat, width: 1400, depth: 1000, thickness: 20 }
holes: [{ id: bateria, label: Bateria, x: 700, y: 500, diameter: 35 }]
`).find((d) => d.kind === 'diameter')
    assert.ok(leader?.kind === 'diameter')
    assert.ok(leader.direction.x > 0)
  })

  it('is deterministic', () => {
    const a = JSON.stringify(dimensionsOf(exampleYaml()))
    const b = JSON.stringify(dimensionsOf(exampleYaml()))
    assert.equal(a, b)
  })
})

function textOf(dimension: Dimension | undefined): string | undefined {
  return dimension?.text
}

function span(dimension: LinearDimension, scale: number): { min: number; max: number } {
  const centre = ((dimension.from + dimension.to) / 2) * scale
  const half = Math.max(
    (Math.abs(dimension.to - dimension.from) * scale) / 2,
    textWidth(dimension.text, TEXT_SIZE) / 2,
  )
  return { min: centre - half, max: centre + half }
}
