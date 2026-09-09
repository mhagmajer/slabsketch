/**
 * The on-disk input format (v1), described once, in Zod.
 *
 * Objects are `.strict()` on purpose: a typo such as `hight: 490` should be a
 * loud error rather than a silently ignored key. That matters most when a
 * coding agent is editing the file on the user's behalf.
 */

import { z } from 'zod'

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const id = z
  .string()
  .min(1, 'id must not be empty')
  .regex(idPattern, 'id must start with a letter or digit and contain only letters, digits, . _ -')

/** A coordinate may be any finite number; out-of-slab values are reported by the geometry checks. */
const coordinate = z.number().finite('must be a finite number of millimetres')

const size = z
  .number()
  .finite('must be a finite number of millimetres')
  .positive('must be greater than 0 mm')

const label = z.string().min(1, 'label must not be empty')

export const scaleSchema = z.union([
  z.literal('auto'),
  z.string().regex(/^\d+(\.\d+)?\s*:\s*\d+(\.\d+)?$/, 'scale must look like "1:10" or be "auto"'),
  z.number().finite().positive(),
])

export const cutoutSchema = z
  .object({
    id,
    label: label.optional(),
    /** X of the cutout's left edge, from the slab's left edge. */
    x: coordinate,
    /** Y of the cutout's back edge, from the slab's back edge. */
    y: coordinate,
    width: size,
    height: size,
  })
  .strict()

export const holeSchema = z
  .object({
    id,
    label: label.optional(),
    /** X of the hole centre. */
    x: coordinate,
    /** Y of the hole centre. */
    y: coordinate,
    diameter: size,
  })
  .strict()

export const countertopSchema = z
  .object({
    name: z.string().min(1).default('Countertop'),
    width: size,
    depth: size,
    thickness: size,
    material: z.string().min(1).optional(),
  })
  .strict()

export const referenceSchema = z
  .object({
    x: z.enum(['left', 'right']).default('left'),
    y: z.enum(['back', 'front']).default('back'),
  })
  .strict()
  .default({})

export const drawingSchema = z
  .object({
    scale: scaleSchema.default('auto'),
    sheet: z.enum(['a5', 'a4', 'a3', 'a2', 'a1']).default('a3'),
    orientation: z.enum(['landscape', 'portrait']).default('landscape'),
    dimensions: z.enum(['auto', 'none']).default('auto'),
    reference: referenceSchema,
  })
  .strict()
  .default({})

export const metadataSchema = z
  .object({
    project: z.string().min(1).optional(),
    client: z.string().min(1).optional(),
    drawnBy: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    revision: z.string().min(1).optional(),
  })
  .strict()
  .default({})

export const checksSchema = z
  .object({
    /** Warn when a feature sits closer than this to a slab edge. */
    minEdgeDistance: z.number().finite().nonnegative().default(50),
    /** Warn when the material bridge between two features is thinner than this. */
    minFeatureDistance: z.number().finite().nonnegative().default(50),
  })
  .strict()
  .default({})

export const inputSchema = z
  .object({
    version: z.literal(1).default(1),
    countertop: countertopSchema,
    cutouts: z.array(cutoutSchema).default([]),
    holes: z.array(holeSchema).default([]),
    notes: z.array(z.string().min(1)).default([]),
    checks: checksSchema,
    drawing: drawingSchema,
    metadata: metadataSchema,
  })
  .strict()

export type InputFile = z.infer<typeof inputSchema>
export type CutoutInput = z.infer<typeof cutoutSchema>
export type HoleInput = z.infer<typeof holeSchema>
