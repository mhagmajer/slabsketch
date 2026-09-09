/**
 * Layer 6: the renderer-neutral drawing.
 *
 * A `Drawing` is a flat list of primitives in two spaces:
 *
 *   - `model`  real-world millimetres; placed on the sheet through `transform`
 *   - `paper`  sheet millimetres; the frame, the title block, the notes
 *
 * Stroke widths and font sizes are always paper millimetres (annotative), so
 * changing the scale never changes line weights. Keeping model-space geometry
 * separate is what makes a DXF exporter a small addition later: it consumes
 * `model` directly and ignores `transform` and `paper`.
 */

import type { Diagnostic } from '../diagnostics.ts'
import { warning } from '../diagnostics.ts'
import {
  type DiameterDimension,
  type Dimension,
  type LinearDimension,
  autoDimensions,
  insideInset,
  packDimensions,
} from '../geometry/dimensions.ts'
import {
  type Area,
  LAYOUT,
  type Sheet,
  contentArea,
  fitsIn,
  frameArea,
  scheduleArea,
  scheduleLayout,
  sheetSize,
  titleBlockWidth,
  titleStripArea,
} from '../geometry/layout.ts'
import {
  type Bounds,
  type Mm,
  type Point,
  boundsOfPoints,
  unionBounds,
} from '../geometry/primitives.ts'
import { SCALE_LADDER, formatScale } from '../geometry/scale.ts'
import { type Language, type Strings, strings } from '../i18n.ts'
import { edgeLength } from '../model/normalize.ts'
import type { CountertopDocument, SelectedService, Slab } from '../model/types.ts'
import { type ServiceId, serviceName } from '../services.ts'
import { formatLength, textWidth } from '../text.ts'
import { GENERATOR } from '../version.ts'
import { ICON_BOX, type IconPoint, serviceIcon } from './icons.ts'

export type Layer =
  | 'frame'
  | 'outline'
  | 'cutout'
  | 'hole'
  | 'centreline'
  | 'dimension'
  | 'service'
  | 'annotation'
  | 'title'

export interface Style {
  layer: Layer
  stroke?: string
  /** Paper millimetres. */
  strokeWidth?: number
  /** Paper millimetres. */
  dash?: readonly number[]
  fill?: string
  /** Paper millimetres (cap height is roughly 0.72 of this). */
  fontSize?: number
  bold?: boolean
}

export type TextAnchor = 'start' | 'middle' | 'end'
export type TextBaseline = 'top' | 'middle' | 'bottom'

export interface LineEntity {
  type: 'line'
  a: Point
  b: Point
  style: Style
}

export interface PolylineEntity {
  type: 'polyline'
  points: Point[]
  closed: boolean
  style: Style
}

export interface CircleEntity {
  type: 'circle'
  center: Point
  radius: Mm
  style: Style
}

/** A filled polygon; used for arrowheads and title-block rules. */
export interface PolygonEntity {
  type: 'polygon'
  points: Point[]
  style: Style
}

export interface TextEntity {
  type: 'text'
  at: Point
  text: string
  style: Style
  anchor: TextAnchor
  baseline: TextBaseline
  /** Degrees, clockwise on screen. Only -90 is used by the built-in styles. */
  rotate?: number
}

export type Entity = LineEntity | PolylineEntity | CircleEntity | PolygonEntity | TextEntity

/** paper = origin + model * scale (model +y already points down, like the page). */
export interface Transform {
  originX: number
  originY: number
  scale: number
}

export interface Drawing {
  sheet: Sheet
  scale: number
  scaleLabel: string
  title: string
  language: Language
  /** Human-readable summary, in the drawing's language. */
  description: string
  transform: Transform
  model: Entity[]
  paper: Entity[]
}

export interface BuildOptions {
  /** Name of the file the drawing came from, stamped into the bottom margin. */
  source?: string
}

export interface BuildResult {
  drawing: Drawing
  diagnostics: Diagnostic[]
}

const INK = '#111111'
const DIM_INK = '#1a4d80'
const SERVICE_INK = '#b4531a'
const ICON_FILL = '#dcdcdc'
const STAMP_INK = '#767676'
const PAPER = '#ffffff'

export function toPaper(transform: Transform, p: Point): Point {
  return {
    x: transform.originX + p.x * transform.scale,
    y: transform.originY + p.y * transform.scale,
  }
}

export function buildDrawing(doc: CountertopDocument, options: BuildOptions = {}): BuildResult {
  const diagnostics: Diagnostic[] = []
  const sheet = sheetSize(doc.drawing.sheet, doc.drawing.orientation)
  const schedule = scheduleLayout(sheet, doc.slabs[0]?.services.length ?? 0)
  const area = contentArea(sheet, schedule.height)
  const slab = doc.slabs[0]
  if (!slab) throw new Error('buildDrawing: document has no slab')

  const candidates = doc.drawing.scale === 'auto' ? SCALE_LADDER : [doc.drawing.scale]

  let chosen: { scale: number; content: Content } | undefined
  for (const scale of candidates) {
    const content = buildContent(doc, slab, scale)
    if (fitsIn(paperBounds(content.bounds, scale), area)) {
      chosen = { scale, content }
      break
    }
  }
  if (!chosen) {
    const scale = candidates[candidates.length - 1] as number
    chosen = { scale, content: buildContent(doc, slab, scale) }
    if (doc.drawing.scale === 'auto') {
      diagnostics.push(
        warning(
          'W_SCALE_CLAMPED',
          `the drawing does not fit on sheet ${sheet.name.toUpperCase()} at any standard scale; ` +
            `using ${formatScale(scale)} and overflowing the frame`,
        ),
      )
    } else {
      diagnostics.push(
        warning(
          'W_SCALE_CLAMPED',
          `the drawing does not fit on sheet ${sheet.name.toUpperCase()} at ${formatScale(scale)}; ` +
            'use a smaller scale or a larger sheet',
        ),
      )
    }
  }

  const { scale, content } = chosen
  const paperExtent = paperBounds(content.bounds, scale)
  const transform: Transform = {
    scale,
    originX:
      area.x +
      (area.width - (paperExtent.maxX - paperExtent.minX)) / 2 -
      content.bounds.minX * scale,
    originY:
      area.y +
      (area.height - (paperExtent.maxY - paperExtent.minY)) / 2 -
      content.bounds.minY * scale,
  }

  const paper = buildSheetFurniture(doc, slab, sheet, scale, options.source)
  const scaleLabel = formatScale(scale)

  return {
    drawing: {
      sheet,
      scale,
      scaleLabel,
      title: slab.name,
      language: doc.drawing.language,
      description: strings(doc.drawing.language).description(scaleLabel, sheet.name.toUpperCase()),
      transform,
      model: content.entities,
      paper,
    },
    diagnostics,
  }
}

// ---------------------------------------------------------------------------
// Model space
// ---------------------------------------------------------------------------

interface Content {
  entities: Entity[]
  bounds: Bounds
}

function buildContent(doc: CountertopDocument, slab: Slab, scale: number): Content {
  const entities: Entity[] = []
  const paperToModel = (paperMm: number): Mm => paperMm / scale

  // Part geometry ----------------------------------------------------------
  entities.push({
    type: 'polyline',
    points: slab.outline,
    closed: true,
    style: { layer: 'outline', stroke: INK, strokeWidth: LAYOUT.strokeOutline },
  })

  for (const feature of slab.features) {
    if (feature.kind === 'rect-cutout') {
      entities.push({
        type: 'polyline',
        points: feature.outline,
        closed: true,
        style: { layer: 'cutout', stroke: INK, strokeWidth: LAYOUT.strokeCutout },
      })
      if (feature.cornerRadius > 0 && doc.drawing.dimensions !== 'none') {
        // Called out at a corner, the way a fabricator expects to read it.
        entities.push({
          type: 'text',
          at: {
            x: feature.bounds.minX + paperToModel(LAYOUT.dimTextSize + 8),
            y: feature.bounds.maxY - paperToModel(1.5),
          },
          text: `R${formatLength(feature.cornerRadius)}`,
          anchor: 'start',
          baseline: 'bottom',
          style: { layer: 'dimension', fill: DIM_INK, fontSize: LAYOUT.dimTextSize },
        })
      }
      if (feature.label) {
        // When the opening carries its own dimensions, they run just inside its
        // back and left edges, so the label is centred on what is left.
        const inset =
          doc.drawing.dimensions === 'none'
            ? undefined
            : insideInset(feature.rect.width, feature.rect.height, scale)
        entities.push({
          type: 'text',
          at: {
            x: (feature.bounds.minX + (inset ?? 0) + feature.bounds.maxX) / 2,
            y: (feature.bounds.minY + (inset ?? 0) + feature.bounds.maxY) / 2,
          },
          text: feature.label,
          anchor: 'middle',
          baseline: 'middle',
          style: { layer: 'annotation', fill: INK, fontSize: LAYOUT.labelTextSize, bold: true },
        })
      }
    } else {
      entities.push({
        type: 'circle',
        center: feature.center,
        radius: feature.radius,
        style: { layer: 'hole', stroke: INK, strokeWidth: LAYOUT.strokeHole },
      })
      const reach = feature.radius + paperToModel(LAYOUT.centreMarkOvershoot)
      const centreStyle: Style = {
        layer: 'centreline',
        stroke: INK,
        strokeWidth: LAYOUT.strokeCentreline,
        dash: LAYOUT.centrelineDash,
      }
      entities.push({
        type: 'line',
        a: { x: feature.center.x - reach, y: feature.center.y },
        b: { x: feature.center.x + reach, y: feature.center.y },
        style: centreStyle,
      })
      entities.push({
        type: 'line',
        a: { x: feature.center.x, y: feature.center.y - reach },
        b: { x: feature.center.x, y: feature.center.y + reach },
        style: centreStyle,
      })
    }
  }

  // Origin marker ----------------------------------------------------------
  entities.push({
    type: 'text',
    at: { x: slab.bounds.minX - paperToModel(1.5), y: slab.bounds.minY - paperToModel(1.5) },
    text: '(0,0)',
    anchor: 'end',
    baseline: 'bottom',
    style: { layer: 'annotation', fill: INK, fontSize: LAYOUT.subLabelTextSize },
  })

  if (doc.drawing.dimensions === 'none') {
    // Chosen services are marked whether or not the drawing is dimensioned.
    entities.push(...serviceEntities(slab, [], scale))
    return { entities, bounds: boundsOfEntities(entities, scale) }
  }

  // Dimensions -------------------------------------------------------------
  const dimensions = autoDimensions(slab, {
    reference: doc.drawing.reference,
    scale,
    textSizePaper: LAYOUT.dimTextSize,
  })
  const diameters = dimensions.filter((d): d is DiameterDimension => d.kind === 'diameter')

  const leaderEntities: Entity[] = []
  for (const dimension of diameters) {
    leaderEntities.push(...diameterEntities(dimension, scale))
  }
  const leaderBounds =
    leaderEntities.length > 0 ? boundsOfEntities(leaderEntities, scale) : undefined

  // Push the dimension bands clear of anything the leaders occupy.
  const clearance = 4
  const baseTop = leaderBounds
    ? Math.max(LAYOUT.dimBaseOffset, (slab.bounds.minY - leaderBounds.minY) * scale + clearance)
    : LAYOUT.dimBaseOffset
  const baseLeft = leaderBounds
    ? Math.max(LAYOUT.dimBaseOffset, (slab.bounds.minX - leaderBounds.minX) * scale + clearance)
    : LAYOUT.dimBaseOffset

  packDimensions(dimensions, scale, LAYOUT.dimTextSize)
  for (const dimension of dimensions) {
    if (dimension.kind !== 'linear') continue
    entities.push(
      ...linearEntities(dimension, slab, scale, dimension.side === 'top' ? baseTop : baseLeft),
    )
  }
  entities.push(...leaderEntities)
  entities.push(...serviceEntities(slab, diameters, scale))

  return { entities, bounds: boundsOfEntities(entities, scale) }
}

// ---------------------------------------------------------------------------
// Chosen services
// ---------------------------------------------------------------------------

/**
 * Marks the services the customer selected, and ties each to its schedule row
 * with a lettered balloon:
 *
 *   edge     a heavy line just inside the edge, ticked at both ends
 *   cutout   a balloon in the free corner of the opening
 *   hole     a balloon just past the hole's own leader
 *   slab     nothing on the geometry; the schedule says "whole slab"
 */
function serviceEntities(
  slab: Slab,
  leaders: readonly DiameterDimension[],
  scale: number,
): Entity[] {
  const entities: Entity[] = []
  const p = (paperMm: number): Mm => paperMm / scale
  const style: Style = { layer: 'service', stroke: SERVICE_INK, strokeWidth: LAYOUT.strokeService }

  // Several services can share one edge or one opening. Each new one on the
  // same anchor is stepped further out, so neither the runs nor the balloons
  // can land on top of each other.
  const stacked = new Map<string, number>()
  const step = (key: string): number => {
    const index = stacked.get(key) ?? 0
    stacked.set(key, index + 1)
    return index
  }
  const balloonPitch = 2 * LAYOUT.markRadius + 1.5

  for (const selected of slab.services) {
    if (selected.scope === 'edge' && selected.run) {
      const { start, end, inward } = selected.run
      const index = step(`edge:${selected.run.edge}`)
      const lineOffset = p(2.2 + index * 2.6)
      const shift = (point: Point, by: Mm): Point => ({
        x: point.x + inward.x * by,
        y: point.y + inward.y * by,
      })
      const a = shift(start, lineOffset)
      const b = shift(end, lineOffset)
      entities.push({ type: 'line', a, b, style })

      // Ticks show exactly where the run begins and ends.
      const tick = lineOffset + p(2.4)
      entities.push({ type: 'line', a: start, b: shift(start, tick), style })
      entities.push({ type: 'line', a: end, b: shift(end, tick), style })

      const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const reach = p(2.2 + LAYOUT.markRadius + 3 + index * balloonPitch)
      entities.push(...balloon(shift(middle, reach), selected.tag, scale))
      continue
    }

    const feature = slab.features.find((f) => f.id === selected.target)
    if (!feature) continue
    const index = step(`feature:${feature.id}`)
    const along = p(index * balloonPitch)

    if (feature.kind === 'rect-cutout') {
      // On the opening's right edge, near its front corner: clear of the label
      // centred in the opening, and of the dimensions the opening draws along
      // its own back and left edges.
      entities.push(
        ...balloon(
          {
            x: feature.bounds.maxX + along,
            y: feature.bounds.maxY - p(LAYOUT.markRadius + 2),
          },
          selected.tag,
          scale,
        ),
      )
      continue
    }

    // A hole: sit the balloon just past the leader that already labels it.
    const leader = leaders.find((l) => l.elementId === feature.id)
    if (leader) {
      const toRight = leader.direction.x >= 0
      const kneeX = leader.center.x + leader.direction.x * (feature.radius + p(leader.leaderPaper))
      const kneeY = leader.center.y + leader.direction.y * (feature.radius + p(leader.leaderPaper))
      const reach = p(leader.shoulderPaper + LAYOUT.markRadius + 1) + along
      entities.push(
        ...balloon({ x: kneeX + (toRight ? 1 : -1) * reach, y: kneeY }, selected.tag, scale),
      )
    } else {
      entities.push(
        ...balloon(
          {
            x: feature.center.x + feature.radius + p(LAYOUT.markRadius + 2) + along,
            y: feature.center.y,
          },
          selected.tag,
          scale,
        ),
      )
    }
  }

  return entities
}

/**
 * A service pictogram, scaled uniformly into the slot the schedule gives it.
 * Filled shapes are emitted first, so an outline is never painted over.
 */
function iconEntities(
  id: ServiceId,
  x: number,
  y: number,
  width: number,
  height: number,
): Entity[] {
  const scale = Math.min(width / ICON_BOX.width, height / ICON_BOX.height)
  const originX = x + (width - ICON_BOX.width * scale) / 2
  const originY = y + (height - ICON_BOX.height * scale) / 2
  const at = (point: IconPoint): Point => ({
    x: originX + point[0] * scale,
    y: originY + point[1] * scale,
  })

  const outline: Style = { layer: 'service', stroke: INK, strokeWidth: 0.25 }
  const primitives = serviceIcon(id)
  const ordered = [...primitives.filter((p) => p.fill), ...primitives.filter((p) => !p.fill)]

  return ordered.map((primitive): Entity => {
    if (primitive.kind === 'circle') {
      return {
        type: 'circle',
        center: at(primitive.center),
        radius: primitive.radius * scale,
        style: primitive.fill
          ? { layer: 'service', stroke: INK, strokeWidth: 0.25, fill: INK }
          : outline,
      }
    }
    const points = primitive.points.map(at)
    return primitive.fill
      ? { type: 'polygon', points, style: { layer: 'service', fill: ICON_FILL } }
      : { type: 'polyline', points, closed: primitive.closed, style: outline }
  })
}

/** A lettered balloon: an opaque disc so it stays readable over any geometry. */
function balloon(at: Point, tag: string, scale: number): Entity[] {
  const radius = LAYOUT.markRadius / scale
  return [
    {
      type: 'circle',
      center: at,
      radius,
      style: {
        layer: 'service',
        stroke: SERVICE_INK,
        strokeWidth: LAYOUT.strokeDimension * 2,
        fill: PAPER,
      },
    },
    {
      type: 'text',
      at,
      text: tag,
      anchor: 'middle',
      baseline: 'middle',
      style: { layer: 'service', fill: SERVICE_INK, fontSize: LAYOUT.markTextSize, bold: true },
    },
  ]
}

function dimStyle(): Style {
  return { layer: 'dimension', stroke: DIM_INK, strokeWidth: LAYOUT.strokeDimension }
}

function linearEntities(
  dimension: LinearDimension,
  slab: Slab,
  scale: number,
  baseOffset: number,
): Entity[] {
  const entities: Entity[] = []
  const p = (paperMm: number): Mm => paperMm / scale
  const horizontal = dimension.axis === 'x'
  const inside = dimension.placement === 'inside'
  // Band dimensions sit before the part on their axis; inside dimensions are
  // pinned to the position the dimension itself carries.
  const linePos = inside
    ? (dimension.linePos ?? 0)
    : (horizontal ? slab.bounds.minY : slab.bounds.minX) -
      p(baseOffset + dimension.band * LAYOUT.dimBandPitch)
  const style = dimStyle()

  const at = (along: Mm, across: Mm): Point =>
    horizontal ? { x: along, y: across } : { x: across, y: along }

  // Extension lines link a band dimension back to the feature it measures.
  // Inside dimensions touch their own edges, so they need none.
  if (!inside) {
    for (const [along, anchor] of [
      [dimension.from, dimension.anchorFrom],
      [dimension.to, dimension.anchorTo],
    ] as Array<[Mm, Mm]>) {
      entities.push({
        type: 'line',
        a: at(along, anchor - p(LAYOUT.extensionGap)),
        b: at(along, linePos - p(LAYOUT.extensionOvershoot)),
        style,
      })
    }
  }

  // Dimension line, with arrowheads inside when there is room
  const spanPaper = Math.abs(dimension.to - dimension.from) * scale
  const labelPaper = textWidth(dimension.text, LAYOUT.dimTextSize)
  const arrowsInside = spanPaper >= labelPaper + 2 * LAYOUT.arrowLength + 2
  const overshoot = arrowsInside ? 0 : p(2 * LAYOUT.arrowLength)
  entities.push({
    type: 'line',
    a: at(dimension.from - overshoot, linePos),
    b: at(dimension.to + overshoot, linePos),
    style,
  })

  const inward = arrowsInside ? 1 : -1
  entities.push(
    arrowhead(
      at(dimension.from, linePos),
      horizontal ? { x: inward, y: 0 } : { x: 0, y: inward },
      scale,
    ),
  )
  entities.push(
    arrowhead(
      at(dimension.to, linePos),
      horizontal ? { x: -inward, y: 0 } : { x: 0, y: -inward },
      scale,
    ),
  )

  // Label, always on the outer side of the dimension line
  const mid = (dimension.from + dimension.to) / 2
  const textAt = at(mid, linePos - p(LAYOUT.dimTextGap))
  entities.push({
    type: 'text',
    at: textAt,
    text: dimension.text,
    anchor: 'middle',
    baseline: 'bottom',
    ...(horizontal ? {} : { rotate: -90 }),
    style: { layer: 'dimension', fill: DIM_INK, fontSize: LAYOUT.dimTextSize },
  })

  return entities
}

function diameterEntities(dimension: DiameterDimension, scale: number): Entity[] {
  const p = (paperMm: number): Mm => paperMm / scale
  const { center, radius, direction } = dimension
  const style = dimStyle()

  const start = { x: center.x + direction.x * radius, y: center.y + direction.y * radius }
  const knee = {
    x: center.x + direction.x * (radius + p(dimension.leaderPaper)),
    y: center.y + direction.y * (radius + p(dimension.leaderPaper)),
  }
  const toRight = direction.x >= 0

  // The shoulder underlines the label; its length was sized with the label.
  const shoulder = { x: knee.x + (toRight ? 1 : -1) * p(dimension.shoulderPaper), y: knee.y }

  const entities: Entity[] = [
    { type: 'line', a: start, b: knee, style },
    { type: 'line', a: knee, b: shoulder, style },
    arrowhead(start, { x: -direction.x, y: -direction.y }, scale),
  ]

  // Text runs along the shoulder, away from the hole.
  const textX = knee.x + (toRight ? p(0.5) : -p(0.5))
  const anchor: TextAnchor = toRight ? 'start' : 'end'
  const textStyle: Style = { layer: 'dimension', fill: DIM_INK, fontSize: LAYOUT.dimTextSize }

  // The label sits on the far side of the shoulder from the hole, and reads
  // top-down: the name first, the diameter under it.
  const downward = direction.y > 0
  const rowHeight = LAYOUT.dimTextSize + 0.8
  const baseline: TextBaseline = downward ? 'top' : 'bottom'
  const row = (index: number): Point => ({
    x: textX,
    y: shoulder.y + (downward ? 1 : -1) * p(LAYOUT.dimTextGap + index * rowHeight),
  })

  const rows = dimension.label ? [dimension.label, dimension.text] : [dimension.text]
  rows.forEach((text, index) => {
    entities.push({
      type: 'text',
      at: row(downward ? index : rows.length - 1 - index),
      text,
      anchor,
      baseline,
      style: textStyle,
    })
  })
  return entities
}

/** Filled triangle with its tip at `tip`, pointing along `direction`. */
function arrowhead(tip: Point, direction: Point, scale: number): PolygonEntity {
  const length = LAYOUT.arrowLength / scale
  const half = LAYOUT.arrowHalfWidth / scale
  // `direction` points from the tip toward the tail.
  const tailX = tip.x + direction.x * length
  const tailY = tip.y + direction.y * length
  const perpX = -direction.y
  const perpY = direction.x
  return {
    type: 'polygon',
    points: [
      { x: tip.x, y: tip.y },
      { x: tailX + perpX * half, y: tailY + perpY * half },
      { x: tailX - perpX * half, y: tailY - perpY * half },
    ],
    style: { layer: 'dimension', fill: DIM_INK },
  }
}

// ---------------------------------------------------------------------------
// Paper space: frame, notes and title block
// ---------------------------------------------------------------------------

const PRELIMINARY_NOTE =
  'PRELIMINARY DRAWING - all dimensions to be verified on site and by the fabricator.'

function buildSheetFurniture(
  doc: CountertopDocument,
  slab: Slab,
  sheet: Sheet,
  scale: number,
  source: string | undefined,
): Entity[] {
  const t = strings(doc.drawing.language)
  const entities: Entity[] = []
  const frame = frameArea(sheet)
  const frameStyle: Style = { layer: 'frame', stroke: INK, strokeWidth: LAYOUT.strokeFrame }
  entities.push({
    type: 'polyline',
    points: rectPoints(frame),
    closed: true,
    style: frameStyle,
  })

  const strip = titleStripArea(sheet)
  const blockWidth = titleBlockWidth(sheet)
  const block = {
    x: strip.x + strip.width - blockWidth,
    y: strip.y,
    width: blockWidth,
    height: LAYOUT.titleBlockHeight,
  }
  entities.push({ type: 'polyline', points: rectPoints(block), closed: true, style: frameStyle })

  const rowHeights = [11, 8, 8, 7]
  let ruleY = block.y
  for (const height of rowHeights.slice(0, -1)) {
    ruleY += height
    entities.push({
      type: 'line',
      a: { x: block.x, y: ruleY },
      b: { x: block.x + block.width, y: ruleY },
      style: { layer: 'frame', stroke: INK, strokeWidth: LAYOUT.strokeDimension },
    })
  }

  const pad = 2.5
  const left = block.x + pad
  const right = block.x + block.width - pad
  const innerWidth = block.width - 2 * pad
  const rowMiddle = (index: number): number =>
    block.y + rowHeights.slice(0, index).reduce((a, b) => a + b, 0) + (rowHeights[index] ?? 8) / 2

  const title: Style = { layer: 'title', fill: INK, fontSize: 4, bold: true }
  const small: Style = { layer: 'title', fill: INK, fontSize: LAYOUT.smallTextSize }

  const cell = (
    text: string,
    row: number,
    align: 'start' | 'end',
    style: Style,
    maxWidth: number,
  ) => {
    entities.push({
      type: 'text',
      at: { x: align === 'start' ? left : right, y: rowMiddle(row) },
      text: truncateToWidth(text, maxWidth, style.fontSize ?? LAYOUT.smallTextSize),
      anchor: align,
      baseline: 'middle',
      style,
    })
  }

  /**
   * A row holds a left and a right field. The right one is usually short, so it
   * is measured first and the left one gets whatever is left over.
   */
  const row = (leftText: string, rightText: string, index: number): void => {
    const size = LAYOUT.smallTextSize
    const rightWidth = Math.min(textWidth(rightText, size), innerWidth - 12)
    cell(rightText, index, 'end', small, rightWidth)
    cell(leftText, index, 'start', small, innerWidth - rightWidth - 3)
  }

  cell(slab.name, 0, 'start', title, innerWidth)
  row(
    `${t.material}: ${slab.material ?? '-'}`,
    `${t.thickness}: ${formatLength(slab.thickness)} mm`,
    1,
  )
  row(
    `${t.scale} ${formatScale(scale)}`,
    `${t.units}: mm | ${t.sheet}: ${sheet.name.toUpperCase()}`,
    2,
  )

  const meta = doc.metadata
  const leftParts = [
    meta.project ? `${t.project}: ${meta.project}` : undefined,
    meta.client ? `${t.client}: ${meta.client}` : undefined,
  ].filter(Boolean)
  const rightParts = [
    meta.drawnBy ? `${t.drawnBy}: ${meta.drawnBy}` : undefined,
    meta.revision ? `${t.revision} ${meta.revision}` : undefined,
    meta.date,
  ].filter(Boolean)
  row(leftParts.join(' | ') || GENERATOR, rightParts.join(' | '), 3)

  // Notes, to the left of the title block, clipped to the space they have.
  const notesX = strip.x + pad
  const notesWidth = strip.width - block.width - LAYOUT.titleBlockGap - 2 * pad
  const lineHeight = 3.4
  const size = LAYOUT.smallTextSize
  let noteY = strip.y + 1
  entities.push({
    type: 'text',
    at: { x: notesX, y: noteY },
    text: truncateToWidth(t.preliminary, notesWidth, size),
    anchor: 'start',
    baseline: 'top',
    style: { layer: 'title', fill: INK, fontSize: size, bold: true },
  })
  noteY += lineHeight + 1

  if (doc.notes.length > 0) {
    entities.push({
      type: 'text',
      at: { x: notesX, y: noteY },
      text: `${t.notesHeading}:`,
      anchor: 'start',
      baseline: 'top',
      style: { layer: 'title', fill: INK, fontSize: size, bold: true },
    })
    noteY += lineHeight

    const room = Math.max(0, Math.floor((strip.y + strip.height - noteY) / lineHeight))
    doc.notes.slice(0, room).forEach((note, index) => {
      entities.push({
        type: 'text',
        at: { x: notesX, y: noteY + index * lineHeight },
        text: truncateToWidth(`${index + 1}. ${note}`, notesWidth, size),
        anchor: 'start',
        baseline: 'top',
        style: { layer: 'title', fill: INK, fontSize: size },
      })
    })
  }

  if (slab.services.length > 0) entities.push(...scheduleEntities(doc, slab, sheet))

  // Generator stamp, in the bottom margin outside the frame.
  entities.push({
    type: 'text',
    at: { x: frame.x, y: sheet.height - LAYOUT.frameInset / 2 },
    text: truncateToWidth(t.generatedWith(source), frame.width, LAYOUT.stampTextSize),
    anchor: 'start',
    baseline: 'middle',
    style: { layer: 'title', fill: STAMP_INK, fontSize: LAYOUT.stampTextSize },
  })

  return entities
}

/**
 * The schedule of chosen services: one row per selection, in its own column so
 * it can never collide with the drawing. Each row repeats the balloon used on
 * the geometry, names the service, and says where it applies and how much of it
 * there is - lengths in millimetres, areas in square metres, and nothing for
 * services that are simply present.
 */
function scheduleEntities(doc: CountertopDocument, slab: Slab, sheet: Sheet): Entity[] {
  const t = strings(doc.drawing.language)
  const language = doc.drawing.language
  const { columns, height } = scheduleLayout(sheet, slab.services.length)
  if (columns === 0) return []
  const area = scheduleArea(sheet, height)
  const entities: Entity[] = []

  entities.push({
    type: 'text',
    at: { x: area.x, y: area.y },
    text: t.servicesHeading,
    anchor: 'start',
    baseline: 'top',
    style: { layer: 'title', fill: INK, fontSize: LAYOUT.scheduleHeadingSize, bold: true },
  })
  const ruleY = area.y + LAYOUT.scheduleHeadingSize + 1.6
  entities.push({
    type: 'line',
    a: { x: area.x, y: ruleY },
    b: { x: area.x + area.width, y: ruleY },
    style: { layer: 'frame', stroke: INK, strokeWidth: LAYOUT.strokeDimension },
  })

  const top = ruleY + 2
  const columnWidth = area.width / columns
  const rows = Math.ceil(slab.services.length / columns)

  slab.services.forEach((selected, index) => {
    const column = index % columns
    const rowIndex = Math.floor(index / columns)
    if (rowIndex >= rows) return
    const x = area.x + column * columnWidth
    const y = top + rowIndex * LAYOUT.scheduleRowHeight
    const markX = x + LAYOUT.markRadius
    const iconX = x + 2 * LAYOUT.markRadius + 2
    const textX = iconX + LAYOUT.scheduleIconWidth + 3
    const available = columnWidth - (textX - x) - LAYOUT.scheduleGap
    const middle = y + LAYOUT.scheduleRowHeight / 2
    const textTop = middle - (2 * LAYOUT.scheduleTextSize + 1.4) / 2

    entities.push({
      type: 'circle',
      center: { x: markX, y: middle },
      radius: LAYOUT.markRadius,
      style: {
        layer: 'service',
        stroke: SERVICE_INK,
        strokeWidth: LAYOUT.strokeDimension * 2,
        fill: PAPER,
      },
    })
    entities.push({
      type: 'text',
      at: { x: markX, y: middle },
      text: selected.tag,
      anchor: 'middle',
      baseline: 'middle',
      style: { layer: 'service', fill: SERVICE_INK, fontSize: LAYOUT.markTextSize, bold: true },
    })
    entities.push(
      ...iconEntities(
        selected.service,
        iconX,
        middle - LAYOUT.scheduleIconHeight / 2,
        LAYOUT.scheduleIconWidth,
        LAYOUT.scheduleIconHeight,
      ),
    )
    entities.push({
      type: 'text',
      at: { x: textX, y: textTop },
      text: truncateToWidth(
        serviceName(selected.service, language),
        available,
        LAYOUT.scheduleTextSize,
      ),
      anchor: 'start',
      baseline: 'top',
      style: { layer: 'title', fill: INK, fontSize: LAYOUT.scheduleTextSize },
    })
    entities.push({
      type: 'text',
      at: { x: textX, y: textTop + LAYOUT.scheduleTextSize + 1.4 },
      text: truncateToWidth(describeService(selected, slab, t), available, LAYOUT.scheduleTextSize),
      anchor: 'start',
      baseline: 'top',
      style: { layer: 'title', fill: STAMP_INK, fontSize: LAYOUT.scheduleTextSize },
    })
  })

  return entities
}

/** Where a service applies, and how much of it there is. */
function describeService(selected: SelectedService, slab: Slab, t: Strings): string {
  const parts: string[] = []

  if (selected.run) {
    const { edge, from, to } = selected.run
    const full = from === 0 && Math.abs(to - edgeLength(edge, slab.bounds)) < 1e-9
    parts.push(
      full ? t.edgeNames[edge] : `${t.edgeNames[edge]} ${formatLength(from)}-${formatLength(to)}`,
    )
    parts.push(`${formatLength(selected.quantity.value)} mm`)
  } else if (selected.target) {
    const feature = slab.features.find((f) => f.id === selected.target)
    parts.push(feature?.label ?? selected.target)
  } else {
    parts.push(t.wholeSlab)
    if (selected.quantity.kind === 'area') {
      parts.push(`${(Math.round(selected.quantity.value * 100) / 100).toFixed(2)} m²`)
    }
  }

  if (selected.note) parts.push(selected.note)
  return parts.join(' · ')
}

function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text
  let result = text
  while (result.length > 1 && textWidth(`${result}...`, fontSize) > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}...`
}

function rectPoints(area: Area): Point[] {
  return [
    { x: area.x, y: area.y },
    { x: area.x + area.width, y: area.y },
    { x: area.x + area.width, y: area.y + area.height },
    { x: area.x, y: area.y + area.height },
  ]
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Bounding box of everything the drawing puts on the sheet, in paper
 * millimetres. Used to check that a drawing stays inside its margins.
 */
export function drawingPaperBounds(drawing: Drawing): Bounds {
  const projected: Entity[] = [
    ...drawing.model.map((entity) => projectEntity(entity, drawing.transform)),
    ...drawing.paper,
  ]
  return boundsOfEntities(projected, 1)
}

/** Model-space entity, moved onto the sheet. */
export function projectEntity(entity: Entity, transform: Transform): Entity {
  switch (entity.type) {
    case 'line':
      return { ...entity, a: toPaper(transform, entity.a), b: toPaper(transform, entity.b) }
    case 'polyline':
    case 'polygon':
      return { ...entity, points: entity.points.map((p) => toPaper(transform, p)) }
    case 'circle':
      return {
        ...entity,
        center: toPaper(transform, entity.center),
        radius: entity.radius * transform.scale,
      }
    case 'text':
      return { ...entity, at: toPaper(transform, entity.at) }
  }
}

export function paperBounds(bounds: Bounds, scale: number): Bounds {
  return {
    minX: bounds.minX * scale,
    minY: bounds.minY * scale,
    maxX: bounds.maxX * scale,
    maxY: bounds.maxY * scale,
  }
}

/** Bounding box of model entities, including an estimate of every text extent. */
export function boundsOfEntities(entities: readonly Entity[], scale: number): Bounds {
  let result: Bounds | undefined
  for (const entity of entities) {
    const bounds = entityBounds(entity, scale)
    result = result ? unionBounds(result, bounds) : bounds
  }
  return result ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
}

function entityBounds(entity: Entity, scale: number): Bounds {
  switch (entity.type) {
    case 'line':
      return boundsOfPoints([entity.a, entity.b])
    case 'polyline':
    case 'polygon':
      return boundsOfPoints(entity.points)
    case 'circle':
      return {
        minX: entity.center.x - entity.radius,
        minY: entity.center.y - entity.radius,
        maxX: entity.center.x + entity.radius,
        maxY: entity.center.y + entity.radius,
      }
    case 'text':
      return textEntityBounds(entity, scale)
  }
}

function textEntityBounds(entity: TextEntity, scale: number): Bounds {
  const fontSize = entity.style.fontSize ?? LAYOUT.smallTextSize
  const width = textWidth(entity.text, fontSize) / scale
  const height = fontSize / scale

  const x0 = entity.anchor === 'start' ? 0 : entity.anchor === 'middle' ? -width / 2 : -width
  const y0 = entity.baseline === 'top' ? 0 : entity.baseline === 'middle' ? -height / 2 : -height

  const corners: Point[] = [
    { x: x0, y: y0 },
    { x: x0 + width, y: y0 },
    { x: x0 + width, y: y0 + height },
    { x: x0, y: y0 + height },
  ]

  const degrees = entity.rotate ?? 0
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const placed = corners.map((c) => ({
    x: entity.at.x + c.x * cos - c.y * sin,
    y: entity.at.y + c.x * sin + c.y * cos,
  }))
  return boundsOfPoints(placed)
}
