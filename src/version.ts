/**
 * Single source of truth for the version stamped into drawings, the PDF
 * metadata and the CLI. A test keeps it in step with package.json.
 */

export const VERSION = '0.1.0'

export const GENERATOR = `SlabSketch v${VERSION}`

/** Where a reader of the drawing can find the tool that made it. */
export const HOMEPAGE = 'github.com/mhagmajer/slabsketch'
