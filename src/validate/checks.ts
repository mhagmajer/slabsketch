/**
 * Layer 4: geometric sanity checks over the normalised document.
 *
 * Errors describe geometry that cannot be drawn or that is certainly a mistake.
 * Warnings are generic proximity heuristics with configurable thresholds - they
 * are NOT fabrication rules. Whether a given bridge of material is safe depends
 * on the stone, the slab, the reinforcement and the fabricator's equipment, and
 * must be confirmed by the fabricator.
 */

import { type Diagnostic, error, warning } from '../diagnostics.ts'
import {
  boundsContain,
  boundsGap,
  boundsOverlap,
  distanceToBoundsEdge,
  round,
} from '../geometry/primitives.ts'
import type { CountertopDocument, Feature, Slab } from '../model/types.ts'

function mm(value: number): string {
  return `${round(value, 2)} mm`
}

function describe(feature: Feature): string {
  const kind = feature.kind === 'rect-cutout' ? 'cutout' : 'hole'
  return feature.label ? `${kind} "${feature.label}" (${feature.id})` : `${kind} "${feature.id}"`
}

/** Input path of a feature, reconstructed from its position within its kind. */
function pathsByFeature(slab: Slab): Map<Feature, string> {
  const paths = new Map<Feature, string>()
  let cutoutIndex = 0
  let holeIndex = 0
  for (const feature of slab.features) {
    if (feature.kind === 'rect-cutout') paths.set(feature, `cutouts[${cutoutIndex++}]`)
    else paths.set(feature, `holes[${holeIndex++}]`)
  }
  return paths
}

export function checkDocument(doc: CountertopDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const slab of doc.slabs) {
    checkSlab(slab, doc.checks, diagnostics)
  }
  return diagnostics
}

function checkSlab(
  slab: Slab,
  limits: CountertopDocument['checks'],
  diagnostics: Diagnostic[],
): void {
  const paths = pathsByFeature(slab)
  const seen = new Map<string, Feature>()
  const outOfBounds = new Set<Feature>()

  for (const feature of slab.features) {
    const path = paths.get(feature)

    // Duplicate ids
    const previous = seen.get(feature.id)
    if (previous) {
      diagnostics.push(
        error(
          'E_DUPLICATE_ID',
          `duplicate id "${feature.id}", already used by ${describe(previous)}`,
          {
            elementId: feature.id,
            ...(path ? { path } : {}),
          },
        ),
      )
    } else {
      seen.set(feature.id, feature)
    }

    // Containment
    if (!boundsContain(slab.bounds, feature.bounds)) {
      outOfBounds.add(feature)
      const code =
        feature.kind === 'rect-cutout' ? 'E_CUTOUT_OUT_OF_BOUNDS' : 'E_HOLE_OUT_OF_BOUNDS'
      const extent =
        `x ${round(feature.bounds.minX, 2)}..${round(feature.bounds.maxX, 2)}, ` +
        `y ${round(feature.bounds.minY, 2)}..${round(feature.bounds.maxY, 2)}`
      diagnostics.push(
        error(
          code,
          `${describe(feature)} extends outside the slab (${extent}; slab is ` +
            `${mm(slab.bounds.maxX)} x ${mm(slab.bounds.maxY)})`,
          { elementId: feature.id, ...(path ? { path } : {}) },
        ),
      )
    }
  }

  // Pairwise relationships
  for (let i = 0; i < slab.features.length; i++) {
    const a = slab.features[i]
    if (!a) continue
    for (let j = i + 1; j < slab.features.length; j++) {
      const b = slab.features[j]
      if (!b) continue
      checkPair(a, b, paths, limits, diagnostics)
    }
  }

  // Edge clearance (skipped for features already flagged as outside the slab)
  for (const feature of slab.features) {
    if (outOfBounds.has(feature)) continue
    const clearance = distanceToBoundsEdge(slab.bounds, feature.bounds)
    if (clearance < limits.minEdgeDistance) {
      const path = paths.get(feature)
      diagnostics.push(
        warning(
          'W_EDGE_CLEARANCE',
          `${describe(feature)} leaves only ${mm(clearance)} of material to the nearest slab ` +
            `edge (threshold ${mm(limits.minEdgeDistance)})`,
          { elementId: feature.id, ...(path ? { path } : {}) },
        ),
      )
    }
  }
}

function checkPair(
  a: Feature,
  b: Feature,
  paths: Map<Feature, string>,
  limits: CountertopDocument['checks'],
  diagnostics: Diagnostic[],
): void {
  const overlapping = boundsOverlap(a.bounds, b.bounds)
  const path = paths.get(b)
  const at = { elementId: b.id, ...(path ? { path } : {}) }

  if (overlapping) {
    const hole = a.kind === 'circle-hole' ? a : b.kind === 'circle-hole' ? b : undefined
    const cutout = a.kind === 'rect-cutout' ? a : b.kind === 'rect-cutout' ? b : undefined
    if (hole && cutout) {
      diagnostics.push(
        error(
          'E_HOLE_INSIDE_CUTOUT',
          `${describe(hole)} overlaps ${describe(cutout)}; there is no material left to drill`,
          { elementId: hole.id, ...(paths.get(hole) ? { path: paths.get(hole) as string } : {}) },
        ),
      )
    } else {
      diagnostics.push(
        warning('W_FEATURE_OVERLAP', `${describe(a)} and ${describe(b)} overlap`, at),
      )
    }
    return
  }

  const gap = boundsGap(a.bounds, b.bounds)
  if (gap < limits.minFeatureDistance) {
    diagnostics.push(
      warning(
        'W_FEATURE_CLEARANCE',
        `only ${mm(gap)} of material between ${describe(a)} and ${describe(b)} ` +
          `(threshold ${mm(limits.minFeatureDistance)})`,
        at,
      ),
    )
  }
}
