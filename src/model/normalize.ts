/**
 * Layer 3: input file -> `CountertopDocument`.
 *
 * This is the only place that knows the v1 input shape. Adding an L-shaped top
 * later means teaching this function to emit a different `outline` polygon; the
 * dimensioning, layout and rendering layers do not change.
 */

import {
  type Bounds,
  type Mm,
  type Point,
  boundsOfPoints,
  circleBounds,
  rectBounds,
  rectToPolygon,
  roundedRectToPolygon,
} from '../geometry/primitives.ts'
import { parseScale } from '../geometry/scale.ts'
import type { InputFile } from '../input/schema.ts'
import { type ServiceId, serviceDefinition } from '../services.ts'
import type {
  CountertopDocument,
  EdgeRun,
  Feature,
  SelectedService,
  Slab,
  SlabEdge,
} from './types.ts'

export interface NormalizeOverrides {
  /** `'auto'`, a factor such as 0.05, or a ratio string such as `'1:20'`. */
  scale?: number | string
  sheet?: CountertopDocument['drawing']['sheet']
  orientation?: CountertopDocument['drawing']['orientation']
  dimensions?: CountertopDocument['drawing']['dimensions']
  language?: CountertopDocument['drawing']['language']
}

export function normalizeDocument(
  input: InputFile,
  overrides: NormalizeOverrides = {},
): CountertopDocument {
  const { countertop } = input

  const features: Feature[] = []
  for (const cutout of input.cutouts) {
    const rect = { x: cutout.x, y: cutout.y, width: cutout.width, height: cutout.height }
    const cornerRadius = cutout.cornerRadius ?? 0
    features.push({
      kind: 'rect-cutout',
      id: cutout.id,
      ...(cutout.label === undefined ? {} : { label: cutout.label }),
      ...(cutout.product === undefined ? {} : { product: cutout.product }),
      rect,
      cornerRadius,
      outline: roundedRectToPolygon(rect, cornerRadius),
      bounds: rectBounds(rect),
    })
  }
  for (const hole of input.holes) {
    const center = { x: hole.x, y: hole.y }
    const radius = hole.diameter / 2
    features.push({
      kind: 'circle-hole',
      id: hole.id,
      ...(hole.label === undefined ? {} : { label: hole.label }),
      ...(hole.product === undefined ? {} : { product: hole.product }),
      center,
      diameter: hole.diameter,
      radius,
      bounds: circleBounds(center, radius),
    })
  }

  const outline = rectToPolygon({ x: 0, y: 0, width: countertop.width, height: countertop.depth })

  const bounds = boundsOfPoints(outline)

  const slab: Slab = {
    id: 'slab-1',
    name: countertop.name,
    outline,
    bounds,
    thickness: countertop.thickness,
    ...(countertop.material === undefined ? {} : { material: countertop.material }),
    features,
    services: input.services.map((selected, index) => resolveService(selected, index, bounds)),
    edges: countertop.edges,
  }

  const rawScale = overrides.scale ?? input.drawing.scale
  const scale = rawScale === 'auto' ? 'auto' : parseScale(rawScale)

  return {
    version: 1,
    units: 'mm',
    metadata: input.metadata,
    slabs: [slab],
    notes: input.notes,
    checks: input.checks,
    drawing: {
      scale,
      sheet: overrides.sheet ?? input.drawing.sheet,
      orientation: overrides.orientation ?? input.drawing.orientation,
      dimensions: overrides.dimensions ?? input.drawing.dimensions,
      language: overrides.language ?? input.drawing.language,
      reference: input.drawing.reference,
    },
  }
}

/** Marks used on the drawing, in the order services were chosen: A, B, ... Z, AA. */
export function serviceTag(index: number): string {
  let tag = ''
  let n = index
  do {
    tag = String.fromCharCode(65 + (n % 26)) + tag
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return tag
}

const INWARD: Record<SlabEdge, Point> = {
  back: { x: 0, y: 1 },
  front: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
}

/** Length of one edge of the slab's bounding rectangle. */
export function edgeLength(edge: SlabEdge, bounds: Bounds): Mm {
  return edge === 'back' || edge === 'front' ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY
}

/**
 * Turn a requested run - an edge, optionally trimmed to a range - into real
 * coordinates. The range is measured from the edge's start: left to right for
 * the back and front edges, back to front for the left and right ones.
 */
export function resolveEdgeRun(
  edge: SlabEdge,
  bounds: Bounds,
  fromInput?: Mm,
  toInput?: Mm,
): EdgeRun {
  const length = edgeLength(edge, bounds)
  const from = fromInput ?? 0
  const to = toInput ?? length
  const horizontal = edge === 'back' || edge === 'front'
  const fixed = edge === 'back' ? bounds.minY : edge === 'front' ? bounds.maxY : undefined
  const fixedX = edge === 'left' ? bounds.minX : edge === 'right' ? bounds.maxX : undefined

  const start = horizontal
    ? { x: bounds.minX + from, y: fixed as Mm }
    : { x: fixedX as Mm, y: bounds.minY + from }
  const end = horizontal
    ? { x: bounds.minX + to, y: fixed as Mm }
    : { x: fixedX as Mm, y: bounds.minY + to }

  return { edge, from, to, start, end, inward: INWARD[edge] }
}

function resolveService(
  selected: InputFile['services'][number],
  index: number,
  bounds: Bounds,
): SelectedService {
  const definition = serviceDefinition(selected.service as ServiceId)
  const run =
    definition.scope === 'edge' && selected.edge
      ? resolveEdgeRun(selected.edge, bounds, selected.from, selected.to)
      : undefined

  const quantity =
    definition.measure === 'length'
      ? { kind: 'length' as const, value: run ? Math.abs(run.to - run.from) : 0 }
      : definition.measure === 'area'
        ? {
            kind: 'area' as const,
            value: ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) / 1e6,
          }
        : { kind: 'count' as const, value: 1 }

  return {
    id: selected.id ?? `${selected.service}-${index + 1}`,
    tag: serviceTag(index),
    service: selected.service as ServiceId,
    scope: definition.scope,
    ...(selected.target === undefined ? {} : { target: selected.target }),
    ...(run === undefined ? {} : { run }),
    quantity,
    ...(selected.note === undefined ? {} : { note: selected.note }),
  }
}
