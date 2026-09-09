/**
 * Layer 5b: sheet sizes and the paper-space constants that define the drawing
 * style. Everything here is in *paper* millimetres and independent of scale.
 */

import type { Orientation, SheetName } from '../model/types.ts'
import type { Bounds } from './primitives.ts'

export interface Sheet {
  name: SheetName
  orientation: Orientation
  /** Page width in paper millimetres. */
  width: number
  /** Page height in paper millimetres. */
  height: number
}

const SHEET_SIZES: Record<SheetName, { short: number; long: number }> = {
  a5: { short: 148, long: 210 },
  a4: { short: 210, long: 297 },
  a3: { short: 297, long: 420 },
  a2: { short: 420, long: 594 },
  a1: { short: 594, long: 841 },
}

export function sheetSize(name: SheetName, orientation: Orientation): Sheet {
  const size = SHEET_SIZES[name]
  const width = orientation === 'landscape' ? size.long : size.short
  const height = orientation === 'landscape' ? size.short : size.long
  return { name, orientation, width, height }
}

/** Paper-space style constants. Tweaking these restyles every drawing. */
export const LAYOUT = {
  /** Border frame inset from the page edge. */
  frameInset: 10,
  /** Clear space kept between the frame and the drawing content. */
  contentPadding: 8,
  /** Preferred title block width; narrowed on small sheets so notes still fit. */
  titleBlockWidth: 96,
  /** Title block never takes more than this fraction of the frame width. */
  titleBlockMaxFraction: 0.45,
  titleBlockHeight: 34,
  titleBlockGap: 4,
  /** Distance from the part to the innermost dimension band. */
  dimBaseOffset: 13,
  dimBandPitch: 9,
  dimTextSize: 2.5,
  dimTextGap: 1.0,
  labelTextSize: 3.2,
  subLabelTextSize: 2.4,
  smallTextSize: 2.4,
  /** Generator stamp in the bottom margin. */
  stampTextSize: 2,
  arrowLength: 2.8,
  arrowHalfWidth: 0.85,
  /** Gap between the geometry and the start of an extension line. */
  extensionGap: 1.2,
  extensionOvershoot: 1.6,
  centreMarkOvershoot: 3,
  strokeFrame: 0.5,
  strokeOutline: 0.6,
  strokeCutout: 0.35,
  strokeHole: 0.35,
  strokeDimension: 0.18,
  strokeCentreline: 0.18,
  centrelineDash: [4, 1.5, 0.8, 1.5],
} as const

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** Width the title block actually gets on this sheet. */
export function titleBlockWidth(sheet: Sheet): number {
  const frame = frameArea(sheet)
  return Math.min(LAYOUT.titleBlockWidth, frame.width * LAYOUT.titleBlockMaxFraction)
}

export function frameArea(sheet: Sheet): Area {
  return {
    x: LAYOUT.frameInset,
    y: LAYOUT.frameInset,
    width: sheet.width - 2 * LAYOUT.frameInset,
    height: sheet.height - 2 * LAYOUT.frameInset,
  }
}

/** The area the part and its dimensions may occupy, above the title block strip. */
export function contentArea(sheet: Sheet): Area {
  const frame = frameArea(sheet)
  const reserved = LAYOUT.titleBlockHeight + LAYOUT.titleBlockGap
  return {
    x: frame.x + LAYOUT.contentPadding,
    y: frame.y + LAYOUT.contentPadding,
    width: frame.width - 2 * LAYOUT.contentPadding,
    height: frame.height - reserved - 2 * LAYOUT.contentPadding,
  }
}

/** The bottom strip holding the notes block and the title block. */
export function titleStripArea(sheet: Sheet): Area {
  const frame = frameArea(sheet)
  return {
    x: frame.x,
    y: frame.y + frame.height - LAYOUT.titleBlockHeight,
    width: frame.width,
    height: LAYOUT.titleBlockHeight,
  }
}

/** Does `bounds` (already in paper millimetres) fit inside `area`? */
export function fitsIn(bounds: Bounds, area: Area, tolerance = 1e-6): boolean {
  return (
    bounds.maxX - bounds.minX <= area.width + tolerance &&
    bounds.maxY - bounds.minY <= area.height + tolerance
  )
}
