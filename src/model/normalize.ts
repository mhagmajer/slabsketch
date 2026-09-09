/**
 * Layer 3: input file -> `CountertopDocument`.
 *
 * This is the only place that knows the v1 input shape. Adding an L-shaped top
 * later means teaching this function to emit a different `outline` polygon; the
 * dimensioning, layout and rendering layers do not change.
 */

import { boundsOfPoints, circleBounds, rectBounds, rectToPolygon } from '../geometry/primitives.ts'
import { parseScale } from '../geometry/scale.ts'
import type { InputFile } from '../input/schema.ts'
import type { CountertopDocument, Feature, Slab } from './types.ts'

export interface NormalizeOverrides {
  /** `'auto'`, a factor such as 0.05, or a ratio string such as `'1:20'`. */
  scale?: number | string
  sheet?: CountertopDocument['drawing']['sheet']
  orientation?: CountertopDocument['drawing']['orientation']
  dimensions?: CountertopDocument['drawing']['dimensions']
}

export function normalizeDocument(
  input: InputFile,
  overrides: NormalizeOverrides = {},
): CountertopDocument {
  const { countertop } = input

  const features: Feature[] = []
  for (const cutout of input.cutouts) {
    const rect = { x: cutout.x, y: cutout.y, width: cutout.width, height: cutout.height }
    features.push({
      kind: 'rect-cutout',
      id: cutout.id,
      ...(cutout.label === undefined ? {} : { label: cutout.label }),
      rect,
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
      center,
      diameter: hole.diameter,
      radius,
      bounds: circleBounds(center, radius),
    })
  }

  const outline = rectToPolygon({ x: 0, y: 0, width: countertop.width, height: countertop.depth })

  const slab: Slab = {
    id: 'slab-1',
    name: countertop.name,
    outline,
    bounds: boundsOfPoints(outline),
    thickness: countertop.thickness,
    ...(countertop.material === undefined ? {} : { material: countertop.material }),
    features,
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
      reference: input.drawing.reference,
    },
  }
}
