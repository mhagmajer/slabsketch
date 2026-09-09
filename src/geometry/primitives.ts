/**
 * Pure geometric primitives shared by every layer above the input parser.
 *
 * All values are millimetres in the document coordinate system:
 * origin (0,0) at the back-left corner of the slab, +x to the right,
 * +y toward the front of the countertop.
 */

/** A length in millimetres. */
export type Mm = number

export interface Point {
  x: Mm
  y: Mm
}

export interface Rect {
  x: Mm
  y: Mm
  width: Mm
  height: Mm
}

export interface Bounds {
  minX: Mm
  minY: Mm
  maxX: Mm
  maxY: Mm
}

export function point(x: Mm, y: Mm): Point {
  return { x, y }
}

export function rectBounds(r: Rect): Bounds {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height }
}

export function circleBounds(center: Point, radius: Mm): Bounds {
  return {
    minX: center.x - radius,
    minY: center.y - radius,
    maxX: center.x + radius,
    maxY: center.y + radius,
  }
}

/** Corners of a rectangle, clockwise from the top-left in screen orientation. */
export function rectToPolygon(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
}

/**
 * Corners of a rectangle whose corners are rounded to `radius`, clockwise from
 * the top-left in screen orientation. Arcs are approximated by a fixed number
 * of segments so the output stays byte-stable.
 *
 * Internal corners in stone are cut with a round tool and are a crack risk when
 * left square, so a fabricator needs the radius drawn, not described.
 */
export function roundedRectToPolygon(r: Rect, radius: Mm, segments = 8): Point[] {
  const limit = Math.min(r.width, r.height) / 2
  const rad = Math.min(Math.max(radius, 0), limit)
  if (rad <= 0) return rectToPolygon(r)

  const arc = (cx: Mm, cy: Mm, fromDeg: number, toDeg: number): Point[] => {
    const points: Point[] = []
    for (let i = 0; i <= segments; i++) {
      const angle = ((fromDeg + ((toDeg - fromDeg) * i) / segments) * Math.PI) / 180
      points.push({ x: cx + rad * Math.cos(angle), y: cy + rad * Math.sin(angle) })
    }
    return points
  }

  const left = r.x + rad
  const right = r.x + r.width - rad
  const top = r.y + rad
  const bottom = r.y + r.height - rad

  return [
    ...arc(left, top, 180, 270),
    ...arc(right, top, 270, 360),
    ...arc(right, bottom, 0, 90),
    ...arc(left, bottom, 90, 180),
  ]
}

export function boundsOfPoints(points: readonly Point[]): Bounds {
  if (points.length === 0) {
    throw new Error('boundsOfPoints: empty point list')
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function expandBounds(b: Bounds, by: Mm): Bounds {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by }
}

export function boundsWidth(b: Bounds): Mm {
  return b.maxX - b.minX
}

export function boundsHeight(b: Bounds): Mm {
  return b.maxY - b.minY
}

export function boundsContain(outer: Bounds, inner: Bounds, epsilon = 1e-9): boolean {
  return (
    inner.minX >= outer.minX - epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.maxY <= outer.maxY + epsilon
  )
}

export function pointInBounds(b: Bounds, p: Point, epsilon = 1e-9): boolean {
  return (
    p.x >= b.minX - epsilon &&
    p.x <= b.maxX + epsilon &&
    p.y >= b.minY - epsilon &&
    p.y <= b.maxY + epsilon
  )
}

/**
 * Shortest distance from `b` to the inside face of `outer`, i.e. how much
 * material is left between the feature and the nearest slab edge.
 * Negative when the feature pokes outside.
 */
export function distanceToBoundsEdge(outer: Bounds, b: Bounds): Mm {
  return Math.min(
    b.minX - outer.minX,
    b.minY - outer.minY,
    outer.maxX - b.maxX,
    outer.maxY - b.maxY,
  )
}

/**
 * Width of the material bridge between two axis-aligned boxes.
 * Zero when they touch, negative when they overlap.
 */
export function boundsGap(a: Bounds, b: Bounds): Mm {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY)
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy)
  if (dx >= 0) return dx
  if (dy >= 0) return dy
  // Overlapping on both axes: report the (negative) depth of the smaller overlap.
  return Math.max(dx, dy)
}

export function boundsOverlap(a: Bounds, b: Bounds, epsilon = 1e-9): boolean {
  return (
    a.minX < b.maxX - epsilon &&
    b.minX < a.maxX - epsilon &&
    a.minY < b.maxY - epsilon &&
    b.minY < a.maxY - epsilon
  )
}

/**
 * Parallel 45-degree lines filling a box, clipped to it. Used to hatch the band
 * that marks an edge running up against a wall, the way a wall is hatched in
 * section on any plan drawing.
 */
export function hatchLines(b: Bounds, pitch: Mm): Array<[Point, Point]> {
  // Every line satisfies x - y = c; stepping c by pitch * sqrt(2) spaces them
  // `pitch` apart measured perpendicular to the lines.
  const step = pitch * Math.SQRT2
  const first = Math.ceil((b.minX - b.maxY) / step) * step
  const segments: Array<[Point, Point]> = []
  for (let c = first; c <= b.maxX - b.minY; c += step) {
    const yStart = Math.max(b.minY, b.minX - c)
    const yEnd = Math.min(b.maxY, b.maxX - c)
    if (yEnd - yStart <= 1e-9) continue
    segments.push([
      { x: yStart + c, y: yStart },
      { x: yEnd + c, y: yEnd },
    ])
  }
  return segments
}

/** Round to `digits` decimals, normalising -0 to 0 so output stays byte-stable. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  const r = Math.round(value * factor) / factor
  return r === 0 ? 0 : r
}
