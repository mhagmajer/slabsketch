/**
 * The on-disk input format (v1), described once, in Zod.
 *
 * Objects are `.strict()` on purpose: a typo such as `hight: 490` should be a
 * loud error rather than a silently ignored key. That matters most when a
 * coding agent is editing the file on the user's behalf.
 */

import { z } from 'zod'
import { SERVICE_IDS, type ServiceId } from '../services.ts'

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
    /** Radius the corners are cut to. Required by most undermount sinks. */
    cornerRadius: coordinate.nonnegative().optional(),
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

export const serviceSchema = z
  .object({
    /** Optional stable id, so a drawing can refer back to a chosen service. */
    id: id.optional(),
    /** Which service was chosen; see the catalogue in src/services.ts. */
    service: z.enum(SERVICE_IDS as [ServiceId, ...ServiceId[]]),
    /** Id of the cutout or hole it applies to. Omit for a whole-slab service. */
    target: id.optional(),
    /** Edge it runs along, for edge services. */
    edge: z.enum(['back', 'front', 'left', 'right']).optional(),
    /** Start of the run along that edge, from its beginning. Defaults to 0. */
    from: coordinate.nonnegative().optional(),
    /** End of the run along that edge. Defaults to the full edge. */
    to: coordinate.nonnegative().optional(),
    /** Free text shown beside the service in the schedule. */
    note: z.string().min(1).optional(),
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
    /** Language of the text SlabSketch generates; input text is never translated. */
    language: z.enum(['en', 'pl']).default('en'),
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
    services: z.array(serviceSchema).default([]),
    checks: checksSchema,
    drawing: drawingSchema,
    metadata: metadataSchema,
  })
  .strict()

export type InputFile = z.infer<typeof inputSchema>
export type CutoutInput = z.infer<typeof cutoutSchema>
export type HoleInput = z.infer<typeof holeSchema>
