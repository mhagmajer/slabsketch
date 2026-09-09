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
  sheetSize,
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
import type { CountertopDocument, Slab } from '../model/types.ts'
import { formatLength, textWidth } from '../text.ts'

export type Layer =
  | 'frame'
  | 'outline'
  | 'cutout'
  | 'hole'
  | 'centreline'
  | 'dimension'
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
  transform: Transform
  model: Entity[]
  paper: Entity[]
}

export interface BuildResult {
  drawing: Drawing
  diagnostics: Diagnostic[]
}

const INK = '#111111'
const DIM_INK = '#1a4d80'

export function toPaper(transform: Transform, p: Point): Point {
  return {
    x: transform.originX + p.x * transform.scale,
    y: transform.originY + p.y * transform.scale,
  }
}

export function buildDrawing(doc: CountertopDocument): BuildResult {
  const diagnostics: Diagnostic[] = []
  const sheet = sheetSize(doc.drawing.sheet, doc.drawing.orientation)
  const area = contentArea(sheet)
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

  const paper = buildSheetFurniture(doc, slab, sheet, scale)

  return {
    drawing: {
      sheet,
      scale,
      scaleLabel: formatScale(scale),
      title: slab.name,
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
        points: [
          { x: feature.bounds.minX, y: feature.bounds.minY },
          { x: feature.bounds.maxX, y: feature.bounds.minY },
          { x: feature.bounds.maxX, y: feature.bounds.maxY },
          { x: feature.bounds.minX, y: feature.bounds.maxY },
        ],
        closed: true,
        style: { layer: 'cutout', stroke: INK, strokeWidth: LAYOUT.strokeCutout },
      })
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

  return { entities, bounds: boundsOfEntities(entities, scale) }
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
): Entity[] {
  const entities: Entity[] = []
  const frame = {
    x: LAYOUT.frameInset,
    y: LAYOUT.frameInset,
    width: sheet.width - 2 * LAYOUT.frameInset,
    height: sheet.height - 2 * LAYOUT.frameInset,
  }
  const frameStyle: Style = { layer: 'frame', stroke: INK, strokeWidth: LAYOUT.strokeFrame }
  entities.push({
    type: 'polyline',
    points: rectPoints(frame),
    closed: true,
    style: frameStyle,
  })

  const strip = titleStripArea(sheet)
  const block = {
    x: strip.x + strip.width - LAYOUT.titleBlockWidth,
    y: strip.y,
    width: LAYOUT.titleBlockWidth,
    height: LAYOUT.titleBlockHeight,
  }
  entities.push({ type: 'polyline', points: rectPoints(block), closed: true, style: frameStyle })

  const rowHeights = [11, 8, 8, 7]
  const rules: number[] = []
  let y = block.y
  for (const height of rowHeights.slice(0, -1)) {
    y += height
    rules.push(y)
  }
  for (const ruleY of rules) {
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
  const rowTop = (index: number): number =>
    block.y + rowHeights.slice(0, index).reduce((a, b) => a + b, 0)
  const rowMiddle = (index: number): number => rowTop(index) + (rowHeights[index] ?? 8) / 2

  const title: Style = { layer: 'title', fill: INK, fontSize: 4, bold: true }
  const small: Style = { layer: 'title', fill: INK, fontSize: LAYOUT.smallTextSize }

  entities.push({
    type: 'text',
    at: { x: left, y: rowMiddle(0) },
    text: slab.name,
    anchor: 'start',
    baseline: 'middle',
    style: title,
  })

  entities.push({
    type: 'text',
    at: { x: left, y: rowMiddle(1) },
    text: `Material: ${slab.material ?? '-'}`,
    anchor: 'start',
    baseline: 'middle',
    style: small,
  })
  entities.push({
    type: 'text',
    at: { x: right, y: rowMiddle(1) },
    text: `Thickness: ${formatLength(slab.thickness)} mm`,
    anchor: 'end',
    baseline: 'middle',
    style: small,
  })

  entities.push({
    type: 'text',
    at: { x: left, y: rowMiddle(2) },
    text: `Scale ${formatScale(scale)}`,
    anchor: 'start',
    baseline: 'middle',
    style: small,
  })
  entities.push({
    type: 'text',
    at: { x: right, y: rowMiddle(2) },
    text: `Units: mm | Sheet: ${sheet.name.toUpperCase()}`,
    anchor: 'end',
    baseline: 'middle',
    style: small,
  })

  const meta = doc.metadata
  const leftParts = [
    meta.project ? `Project: ${meta.project}` : undefined,
    meta.client ? `Client: ${meta.client}` : undefined,
  ].filter(Boolean)
  const rightParts = [
    meta.drawnBy ? `Drawn: ${meta.drawnBy}` : undefined,
    meta.revision ? `Rev: ${meta.revision}` : undefined,
    meta.date,
  ].filter(Boolean)
  entities.push({
    type: 'text',
    at: { x: left, y: rowMiddle(3) },
    text: leftParts.join(' | ') || 'SlabSketch',
    anchor: 'start',
    baseline: 'middle',
    style: small,
  })
  entities.push({
    type: 'text',
    at: { x: right, y: rowMiddle(3) },
    text: rightParts.join(' | ') || '',
    anchor: 'end',
    baseline: 'middle',
    style: small,
  })

  // Notes, to the left of the title block
  const notesWidth = strip.width - LAYOUT.titleBlockWidth - LAYOUT.titleBlockGap
  const lineHeight = 3.4
  let noteY = strip.y + 1
  entities.push({
    type: 'text',
    at: { x: strip.x, y: noteY },
    text: PRELIMINARY_NOTE,
    anchor: 'start',
    baseline: 'top',
    style: { layer: 'title', fill: INK, fontSize: LAYOUT.smallTextSize, bold: true },
  })
  noteY += lineHeight + 0.6

  const maxLines = Math.max(0, Math.floor((strip.height - (noteY - strip.y)) / lineHeight))
  const notes = doc.notes.slice(0, maxLines)
  notes.forEach((note, index) => {
    entities.push({
      type: 'text',
      at: { x: strip.x, y: noteY + index * lineHeight },
      text: truncateToWidth(`${index + 1}. ${note}`, notesWidth, LAYOUT.smallTextSize),
      anchor: 'start',
      baseline: 'top',
      style: { layer: 'title', fill: INK, fontSize: LAYOUT.smallTextSize },
    })
  })

  return entities
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
