/**
 * The normalised internal model. Everything downstream of validation - dimension
 * generation, layout, rendering and future exporters - reads only this document
 * and never the raw input file.
 *
 * The shapes here are deliberately wider than the v1 input format so that
 * L-shaped tops, polygonal cutouts, seams and multi-slab jobs can be added
 * without changing the renderers:
 *
 *   - a slab carries a closed `outline` polygon, not a width/depth pair
 *   - features are a discriminated union, open to new `kind`s
 *   - a document owns an array of slabs, even though v1 always has exactly one
 */

import type { Bounds, Mm, Point, Rect } from '../geometry/primitives.ts'

export interface RectCutout {
  kind: 'rect-cutout'
  id: string
  label?: string
  rect: Rect
  bounds: Bounds
}

export interface CircleHole {
  kind: 'circle-hole'
  id: string
  label?: string
  center: Point
  diameter: Mm
  radius: Mm
  bounds: Bounds
}

export type Feature = RectCutout | CircleHole

export interface Slab {
  id: string
  name: string
  /** Closed polygon; the first vertex is not repeated at the end. */
  outline: Point[]
  bounds: Bounds
  thickness: Mm
  material?: string
  features: Feature[]
}

export type ReferenceX = 'left' | 'right'
export type ReferenceY = 'back' | 'front'
export type SheetName = 'a5' | 'a4' | 'a3' | 'a2' | 'a1'
export type Orientation = 'landscape' | 'portrait'

export interface DimensionReference {
  x: ReferenceX
  y: ReferenceY
}

export interface DrawingOptions {
  /** Paper millimetres per model millimetre, or `'auto'` to pick from the ladder. */
  scale: number | 'auto'
  sheet: SheetName
  orientation: Orientation
  dimensions: 'auto' | 'none'
  reference: DimensionReference
}

export interface Metadata {
  project?: string
  client?: string
  drawnBy?: string
  date?: string
  revision?: string
}

/**
 * Thresholds for the geometric sanity warnings. These are generic heuristics,
 * not fabrication rules - real limits depend on material and fabricator.
 */
export interface CheckOptions {
  minEdgeDistance: Mm
  minFeatureDistance: Mm
}

export interface CountertopDocument {
  version: 1
  units: 'mm'
  metadata: Metadata
  slabs: Slab[]
  notes: string[]
  drawing: DrawingOptions
  checks: CheckOptions
}

export function isRectCutout(feature: Feature): feature is RectCutout {
  return feature.kind === 'rect-cutout'
}

export function isCircleHole(feature: Feature): feature is CircleHole {
  return feature.kind === 'circle-hole'
}
