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
import type { Language } from '../i18n.ts'
import type { ServiceId, ServiceMeasure } from '../services.ts'

export interface RectCutout {
  kind: 'rect-cutout'
  id: string
  label?: string
  rect: Rect
  /** Corner radius; 0 for a square-cornered opening. */
  cornerRadius: Mm
  /** Closed outline, rounded when `cornerRadius` is greater than zero. */
  outline: Point[]
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
  services: SelectedService[]
}

export type SlabEdge = 'back' | 'front' | 'left' | 'right'

/** A run along one edge of the slab, resolved to real coordinates. */
export interface EdgeRun {
  edge: SlabEdge
  /** Distance along the edge from its start. */
  from: Mm
  to: Mm
  start: Point
  end: Point
  /** Unit vector pointing into the slab from this edge. */
  inward: Point
}

export interface ServiceQuantity {
  kind: ServiceMeasure
  /** Millimetres, pieces, or square metres, per `kind`. */
  value: number
}

/**
 * An additional service the customer selected, resolved against the geometry:
 * which element or edge run it covers, and how much of it there is.
 */
export interface SelectedService {
  id: string
  /** Short mark used on the drawing and in the schedule: A, B, C ... */
  tag: string
  service: ServiceId
  scope: 'edge' | 'cutout' | 'hole' | 'slab'
  /** Id of the feature it applies to, for cutout and hole services. */
  target?: string
  /** Resolved edge run, for edge services. */
  run?: EdgeRun
  quantity: ServiceQuantity
  note?: string
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
  /** Language of generated text. Input text is reproduced as written. */
  language: Language
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
