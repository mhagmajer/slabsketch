/**
 * Layer 5a: derive the dimension set from the model.
 *
 * Dimensions are produced as *semantic* objects (what is measured, from where,
 * on which side of the part) and only turned into lines, arrows and text by the
 * drawing builder. A future DXF exporter can emit real DIMENSION entities from
 * exactly this list instead of the exploded primitives.
 *
 * Placement is rule-based and deterministic:
 *
 *   band 0  feature sizes            (cutout width / height)
 *   band 1  feature offsets          (cutout X / Y from the reference edge)
 *   band 2  hole centre offsets
 *   band 3  overall slab size
 *
 * A dimension starts in the band matching its priority and is pushed one band
 * further out for as long as its label would collide with a dimension already
 * placed in that band.
 */

import type { DimensionReference, Slab } from '../model/types.ts'
import { formatDiameter, formatLength, textWidth } from '../text.ts'
import {
  type Bounds,
  type Mm,
  type Point,
  boundsContain,
  boundsOverlap,
  expandBounds,
} from './primitives.ts'

export type DimensionSide = 'top' | 'bottom' | 'left' | 'right'

export interface LinearDimension {
  kind: 'linear'
  id: string
  /** Which coordinate is being measured. */
  axis: 'x' | 'y'
  side: DimensionSide
  /** Measured span along `axis`, `from <= to`. */
  from: Mm
  to: Mm
  /** Where each extension line meets the geometry, on the perpendicular axis. */
  anchorFrom: Mm
  anchorTo: Mm
  text: string
  /**
   * `band` places the dimension outside the part, in a stacked band; `inside`
   * pins the dimension line to `linePos`, which is how cutout openings are
   * dimensioned when they are large enough to hold their own dimensions.
   */
  placement: 'band' | 'inside'
  /** Perpendicular coordinate of the dimension line; only for `inside`. */
  linePos?: Mm
  priority: number
  /** Assigned by `packDimensions`; distance from the part in band steps. */
  band: number
  elementId?: string
}

export interface DiameterDimension {
  kind: 'diameter'
  id: string
  elementId: string
  center: Point
  radius: Mm
  text: string
  label?: string
  /** Unit vector of the sloped leader segment. */
  direction: Point
  /** Length of the sloped segment, in paper millimetres. */
  leaderPaper: Mm
  /** Length of the horizontal shoulder, in paper millimetres. */
  shoulderPaper: Mm
}

export type Dimension = LinearDimension | DiameterDimension

export const PRIORITY_FEATURE_SIZE = 0
/** Cutout and hole offsets share a group, so the chain nests by span length. */
export const PRIORITY_FEATURE_OFFSET = 1
export const PRIORITY_HOLE_OFFSET = PRIORITY_FEATURE_OFFSET
export const PRIORITY_OVERALL = 2

/** Sloped leader length alternates so neighbouring holes do not share a text row. */
/** Clearance from the part edge to the first leader shoulder, in paper mm. */
const LEADER_CLEAR_PAPER = 5
/** Extra clearance per hole, so neighbouring leaders land on separate rows. */
const LEADER_STAGGER_PAPER = 6.5
const LEADER_MIN_PAPER = 8
/** Breathing room required around a leader label, in paper mm. */
const LABEL_CLEARANCE_PAPER = 2.5
/** Smallest paper size of an opening that may carry its own dimensions. */
const MIN_INSIDE_PAPER = 20
const INSIDE_INSET_PAPER = 7
const SHOULDER_PAPER = 6
const SQRT1_2 = Math.SQRT1_2

const EPSILON = 1e-6

export interface AutoDimensionOptions {
  reference: DimensionReference
  /** Paper mm per model mm; needed to place leaders whose length is paper-relative. */
  scale: number
  /** Annotation text size in paper mm; used to size leader shoulders. */
  textSizePaper?: number
}

export function autoDimensions(slab: Slab, options: AutoDimensionOptions): Dimension[] {
  const { reference, scale } = options
  const textSizePaper = options.textSizePaper ?? 2.5
  const { bounds } = slab
  const dimensions: Dimension[] = []

  const cutouts = slab.features.filter((f) => f.kind === 'rect-cutout')
  const holes = slab.features.filter((f) => f.kind === 'circle-hole')

  // --- Top side: everything measured along X -------------------------------
  for (const cutout of cutouts) {
    const inset = insideInset(cutout.rect.width, cutout.rect.height, scale)
    push(dimensions, {
      kind: 'linear',
      id: `${cutout.id}.width`,
      axis: 'x',
      side: 'top',
      from: cutout.bounds.minX,
      to: cutout.bounds.maxX,
      anchorFrom: cutout.bounds.minY,
      anchorTo: cutout.bounds.minY,
      text: formatLength(cutout.rect.width),
      ...(inset === undefined
        ? { placement: 'band' as const }
        : { placement: 'inside' as const, linePos: cutout.bounds.minY + inset }),
      priority: PRIORITY_FEATURE_SIZE,
      band: PRIORITY_FEATURE_SIZE,
      elementId: cutout.id,
    })
  }
  for (const cutout of cutouts) {
    const fromLeft = reference.x === 'left'
    push(dimensions, {
      kind: 'linear',
      id: `${cutout.id}.x`,
      axis: 'x',
      side: 'top',
      from: fromLeft ? bounds.minX : cutout.bounds.maxX,
      to: fromLeft ? cutout.bounds.minX : bounds.maxX,
      anchorFrom: fromLeft ? bounds.minY : cutout.bounds.minY,
      anchorTo: fromLeft ? cutout.bounds.minY : bounds.minY,
      text: formatLength(
        fromLeft ? cutout.bounds.minX - bounds.minX : bounds.maxX - cutout.bounds.maxX,
      ),
      placement: 'band',
      priority: PRIORITY_FEATURE_OFFSET,
      band: PRIORITY_FEATURE_OFFSET,
      elementId: cutout.id,
    })
  }
  for (const hole of holes) {
    const fromLeft = reference.x === 'left'
    push(dimensions, {
      kind: 'linear',
      id: `${hole.id}.x`,
      axis: 'x',
      side: 'top',
      from: fromLeft ? bounds.minX : hole.center.x,
      to: fromLeft ? hole.center.x : bounds.maxX,
      anchorFrom: fromLeft ? bounds.minY : hole.center.y - hole.radius,
      anchorTo: fromLeft ? hole.center.y - hole.radius : bounds.minY,
      text: formatLength(fromLeft ? hole.center.x - bounds.minX : bounds.maxX - hole.center.x),
      placement: 'band',
      priority: PRIORITY_HOLE_OFFSET,
      band: PRIORITY_HOLE_OFFSET,
      elementId: hole.id,
    })
  }
  push(dimensions, {
    kind: 'linear',
    id: 'overall.width',
    axis: 'x',
    side: 'top',
    from: bounds.minX,
    to: bounds.maxX,
    anchorFrom: bounds.minY,
    anchorTo: bounds.minY,
    text: formatLength(bounds.maxX - bounds.minX),
    placement: 'band',
    priority: PRIORITY_OVERALL,
    band: PRIORITY_OVERALL,
  })

  // --- Left side: everything measured along Y ------------------------------
  for (const cutout of cutouts) {
    const inset = insideInset(cutout.rect.width, cutout.rect.height, scale)
    push(dimensions, {
      kind: 'linear',
      id: `${cutout.id}.height`,
      axis: 'y',
      side: 'left',
      from: cutout.bounds.minY,
      to: cutout.bounds.maxY,
      anchorFrom: cutout.bounds.minX,
      anchorTo: cutout.bounds.minX,
      text: formatLength(cutout.rect.height),
      ...(inset === undefined
        ? { placement: 'band' as const }
        : { placement: 'inside' as const, linePos: cutout.bounds.minX + inset }),
      priority: PRIORITY_FEATURE_SIZE,
      band: PRIORITY_FEATURE_SIZE,
      elementId: cutout.id,
    })
  }
  for (const cutout of cutouts) {
    const fromBack = reference.y === 'back'
    push(dimensions, {
      kind: 'linear',
      id: `${cutout.id}.y`,
      axis: 'y',
      side: 'left',
      from: fromBack ? bounds.minY : cutout.bounds.maxY,
      to: fromBack ? cutout.bounds.minY : bounds.maxY,
      anchorFrom: fromBack ? bounds.minX : cutout.bounds.minX,
      anchorTo: fromBack ? cutout.bounds.minX : bounds.minX,
      text: formatLength(
        fromBack ? cutout.bounds.minY - bounds.minY : bounds.maxY - cutout.bounds.maxY,
      ),
      placement: 'band',
      priority: PRIORITY_FEATURE_OFFSET,
      band: PRIORITY_FEATURE_OFFSET,
      elementId: cutout.id,
    })
  }
  for (const hole of holes) {
    const fromBack = reference.y === 'back'
    push(dimensions, {
      kind: 'linear',
      id: `${hole.id}.y`,
      axis: 'y',
      side: 'left',
      from: fromBack ? bounds.minY : hole.center.y,
      to: fromBack ? hole.center.y : bounds.maxY,
      anchorFrom: fromBack ? bounds.minX : hole.center.x - hole.radius,
      anchorTo: fromBack ? hole.center.x - hole.radius : bounds.minX,
      text: formatLength(fromBack ? hole.center.y - bounds.minY : bounds.maxY - hole.center.y),
      placement: 'band',
      priority: PRIORITY_HOLE_OFFSET,
      band: PRIORITY_HOLE_OFFSET,
      elementId: hole.id,
    })
  }
  push(dimensions, {
    kind: 'linear',
    id: 'overall.depth',
    axis: 'y',
    side: 'left',
    from: bounds.minY,
    to: bounds.maxY,
    anchorFrom: bounds.minX,
    anchorTo: bounds.minX,
    text: formatLength(bounds.maxY - bounds.minY),
    placement: 'band',
    priority: PRIORITY_OVERALL,
    band: PRIORITY_OVERALL,
  })

  // --- Diameter leaders ----------------------------------------------------
  const byX = holes
    .map((hole, index) => ({ hole, index }))
    .sort((a, b) => a.hole.center.x - b.hole.center.x || a.index - b.index)

  // A leader label is placed in open material when one exists, and otherwise
  // pushed out through whichever edge of the part is nearest - never left
  // straddling an edge or lying over an opening. Labels sharing an edge are
  // staggered and kept off one another. Every step is a function of the
  // geometry alone, so the result is stable.
  const minKneeXPaper = new Map<string, number>()
  const placedLabels: Bounds[] = []
  const groupCentreX =
    holes.length > 0
      ? (Math.min(...holes.map((h) => h.center.x)) + Math.max(...holes.map((h) => h.center.x))) / 2
      : 0

  byX.forEach(({ hole }, rank) => {
    const rows = hole.label ? 2 : 1
    const labelWidth = Math.max(
      textWidth(formatDiameter(hole.diameter), textSizePaper),
      hole.label ? textWidth(hole.label, textSizePaper) : 0,
    )
    const shoulderPaper = Math.max(SHOULDER_PAPER, labelWidth + 1)
    const metrics: LabelMetrics = {
      width: shoulderPaper,
      height: rows * textSizePaper + (rows - 1) * 0.8 + LEADER_CLEAR_PAPER,
      scale,
    }
    const basePaper = LEADER_MIN_PAPER + rank * LEADER_STAGGER_PAPER
    const clearance = (LEADER_CLEAR_PAPER + rank * LEADER_STAGGER_PAPER) / scale

    // Leaders fan outwards from the middle of the group, so the label of a
    // hole on the left never reaches across the label of one on its right.
    const candidates = preferOutward(LEADER_DIRECTIONS, hole.center.x, groupCentreX)
    let direction = candidates[0] as Point
    let leaderPaper = basePaper

    const inOpenMaterial = candidates.find((candidate) =>
      labelIsClear(
        slab,
        placedLabels,
        labelBox(hole.center, hole.radius, candidate, basePaper, metrics),
        LABEL_CLEARANCE_PAPER / scale,
      ),
    )

    if (inOpenMaterial) {
      direction = inOpenMaterial
    } else {
      // Escape the part through the edge that needs the shortest leader.
      let shortest = Number.POSITIVE_INFINITY
      for (const candidate of LEADER_DIRECTIONS) {
        const needed = leaderToEscape(slab, hole.center, hole.radius, candidate, metrics, clearance)
        if (needed < shortest - 1e-9) {
          shortest = needed
          direction = candidate
        }
      }
      leaderPaper = Math.max(basePaper, shortest)

      // Labels leaving through the same edge share one strip of paper.
      const edge = `${direction.y < 0 ? 'top' : 'bottom'}:${direction.x < 0 ? 'left' : 'right'}`
      const previous = minKneeXPaper.get(edge)
      if (previous !== undefined) {
        const clearOfPrevious =
          (previous - hole.center.x * scale) / direction.x - hole.radius * scale
        leaderPaper = Math.max(leaderPaper, clearOfPrevious)
      }
      const kneeXPaper = (hole.center.x + direction.x * (hole.radius + leaderPaper / scale)) * scale
      minKneeXPaper.set(
        edge,
        direction.x > 0 ? kneeXPaper + labelWidth + 2 : kneeXPaper - labelWidth - 2,
      )
    }

    placedLabels.push(labelBox(hole.center, hole.radius, direction, leaderPaper, metrics))

    dimensions.push({
      kind: 'diameter',
      id: `${hole.id}.diameter`,
      elementId: hole.id,
      center: hole.center,
      radius: hole.radius,
      text: formatDiameter(hole.diameter),
      ...(hole.label === undefined ? {} : { label: hole.label }),
      direction,
      leaderPaper,
      shoulderPaper,
    })
  })

  return dedupe(dimensions)
}

function push(list: Dimension[], dimension: LinearDimension): void {
  if (Math.abs(dimension.to - dimension.from) < EPSILON) return
  list.push(dimension)
}

/**
 * Half-open question of taste made deterministic: an opening gets its own
 * dimensions drawn inside it when both edges are long enough on paper to hold a
 * dimension line and its label. Otherwise the dimension joins the outer bands.
 */
export function insideInset(width: Mm, height: Mm, scale: number): Mm | undefined {
  const paperWidth = width * scale
  const paperHeight = height * scale
  if (paperWidth < MIN_INSIDE_PAPER || paperHeight < MIN_INSIDE_PAPER) return undefined
  const insetPaper = Math.min(INSIDE_INSET_PAPER, Math.min(paperWidth, paperHeight) * 0.25)
  return insetPaper / scale
}

/**
 * Drop dimensions that would draw the same measurement twice in the same place,
 * for example two tap holes sharing a centre line.
 */
function dedupe(dimensions: Dimension[]): Dimension[] {
  const seen = new Set<string>()
  return dimensions.filter((dimension) => {
    if (dimension.kind !== 'linear' || dimension.placement !== 'band') return true
    const key = [
      dimension.side,
      dimension.priority,
      round6(dimension.from),
      round6(dimension.to),
      dimension.text,
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** Candidate leader directions, in preference order. */
const LEADER_DIRECTIONS: readonly Point[] = [
  { x: SQRT1_2, y: -SQRT1_2 },
  { x: -SQRT1_2, y: -SQRT1_2 },
  { x: SQRT1_2, y: SQRT1_2 },
  { x: -SQRT1_2, y: SQRT1_2 },
]

interface LabelMetrics {
  /** Paper mm. */
  width: number
  /** Paper mm. */
  height: number
  scale: number
}

/**
 * Where the label of a leader would land, in model coordinates. The label sits
 * on the far side of the shoulder from the hole, so an upward leader carries it
 * above the shoulder and a downward one below.
 */
function labelBox(
  center: Point,
  radius: Mm,
  direction: Point,
  leaderPaper: number,
  metrics: LabelMetrics,
): Bounds {
  const { scale } = metrics
  const kneeX = center.x + direction.x * (radius + leaderPaper / scale)
  const kneeY = center.y + direction.y * (radius + leaderPaper / scale)
  const width = metrics.width / scale
  const height = metrics.height / scale
  return {
    minX: direction.x >= 0 ? kneeX : kneeX - width,
    maxX: direction.x >= 0 ? kneeX + width : kneeX,
    minY: direction.y < 0 ? kneeY - height : kneeY,
    maxY: direction.y < 0 ? kneeY : kneeY + height,
  }
}

/**
 * Candidate directions, reordered so the one pointing away from the middle of
 * the hole group is tried first. With a single hole the order is unchanged.
 */
function preferOutward(directions: readonly Point[], x: Mm, centreX: Mm): readonly Point[] {
  if (x >= centreX) return directions
  return [...directions].sort((a, b) => Math.sign(a.x) - Math.sign(b.x))
}

/**
 * Leader length, in paper millimetres, that puts the whole label clear of the
 * part along this direction. A diagonal leader can leave through either of the
 * two edges it points at, so both are measured and the shorter wins - otherwise
 * a hole near the right edge would be dragged all the way past the back one.
 */
function leaderToEscape(
  slab: Slab,
  center: Point,
  radius: Mm,
  direction: Point,
  metrics: LabelMetrics,
  clearance: Mm,
): number {
  const vertical = direction.y < 0 ? slab.bounds.minY - clearance : slab.bounds.maxY + clearance
  const horizontal = direction.x < 0 ? slab.bounds.minX - clearance : slab.bounds.maxX + clearance

  const byY = (Math.abs(vertical - center.y) / Math.abs(direction.y) - radius) * metrics.scale
  const byX = (Math.abs(horizontal - center.x) / Math.abs(direction.x) - radius) * metrics.scale
  return Math.min(byY, byX)
}

/**
 * A label may sit in open material only: inside the part, clear of every
 * opening, and clear of the labels already placed. `margin` is the breathing
 * room demanded around it, so a label never ends up wedged into a sliver.
 */
function labelIsClear(slab: Slab, placed: readonly Bounds[], box: Bounds, margin: Mm): boolean {
  if (!boundsContain(slab.bounds, box)) return false
  const padded = expandBounds(box, margin)
  if (slab.features.some((f) => f.kind === 'rect-cutout' && boundsOverlap(f.bounds, padded))) {
    return false
  }
  return !placed.some((other) => boundsOverlap(other, padded))
}

/**
 * Assign each linear dimension the innermost free band on its side, never
 * closer to the part than its priority allows.
 */
export function packDimensions(
  dimensions: Dimension[],
  scale: number,
  textSizePaper: number,
): void {
  const padModel = 2 / scale
  const occupied = new Map<string, Array<{ min: Mm; max: Mm }>>()

  const linear = dimensions.filter(
    (d): d is LinearDimension => d.kind === 'linear' && d.placement === 'band',
  )
  // Shorter spans first, so chains measured from a common edge nest neatly with
  // the smallest dimension closest to the part.
  linear.sort(
    (a, b) =>
      a.priority - b.priority ||
      Math.abs(a.to - a.from) - Math.abs(b.to - b.from) ||
      Math.min(a.from, a.to) - Math.min(b.from, b.to) ||
      a.id.localeCompare(b.id),
  )

  for (const dimension of linear) {
    const labelModel = textWidth(dimension.text, textSizePaper) / scale
    const center = (dimension.from + dimension.to) / 2
    const half = Math.max(Math.abs(dimension.to - dimension.from) / 2, labelModel / 2) + padModel
    const span = { min: center - half, max: center + half }

    let band = dimension.priority
    while (collides(occupied.get(`${dimension.side}:${band}`), span)) band++
    dimension.band = band

    const key = `${dimension.side}:${band}`
    const list = occupied.get(key)
    if (list) list.push(span)
    else occupied.set(key, [span])
  }

  // Squeeze out empty inner bands - for example when every cutout dimensioned
  // itself from the inside and nothing claimed band 0.
  const lowest = new Map<string, number>()
  for (const dimension of linear) {
    const current = lowest.get(dimension.side)
    if (current === undefined || dimension.band < current)
      lowest.set(dimension.side, dimension.band)
  }
  for (const dimension of linear) {
    dimension.band -= lowest.get(dimension.side) ?? 0
  }
}

function collides(
  placed: Array<{ min: Mm; max: Mm }> | undefined,
  span: { min: Mm; max: Mm },
): boolean {
  if (!placed) return false
  return placed.some((other) => span.max > other.min + EPSILON && other.max > span.min + EPSILON)
}
