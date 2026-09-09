/**
 * SVG exporter. Consumes a `Drawing` and nothing else.
 *
 * Model entities are transformed to paper millimetres here rather than wrapped
 * in an SVG `scale()`, so that stroke widths and font sizes stay in paper units
 * exactly as the drawing declares them.
 */

import { round } from '../geometry/primitives.ts'
import { baselineOffset } from '../text.ts'
import { GENERATOR } from '../version.ts'
import type { Drawing, Entity, Layer, Style, TextEntity } from './drawing.ts'
import { projectEntity } from './drawing.ts'

const LAYER_ORDER: readonly Layer[] = [
  'frame',
  'outline',
  'cutout',
  'hole',
  'centreline',
  'dimension',
  'service',
  'annotation',
  'title',
]

const FONT_STACK = 'Helvetica, Arial, sans-serif'

export interface SvgOptions {
  /** Background rectangle colour, or `null` for a transparent drawing. */
  background?: string | null
}

export function renderSvg(drawing: Drawing, options: SvgOptions = {}): string {
  const background = options.background === undefined ? '#ffffff' : options.background
  const { sheet } = drawing

  const entities: Entity[] = [
    ...drawing.model.map((entity) => projectEntity(entity, drawing.transform)),
    ...drawing.paper,
  ]

  const byLayer = new Map<Layer, Entity[]>()
  for (const entity of entities) {
    const list = byLayer.get(entity.style.layer)
    if (list) list.push(entity)
    else byLayer.set(entity.style.layer, [entity])
  }

  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(`<!-- ${GENERATOR} -->`)
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${n(sheet.width)}mm" ` +
      `height="${n(sheet.height)}mm" viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}">`,
  )
  lines.push(`  <title>${escapeXml(drawing.title)}</title>`)
  lines.push(`  <desc>${escapeXml(drawing.description)}</desc>`)
  if (background !== null) {
    lines.push(
      `  <rect x="0" y="0" width="${n(sheet.width)}" height="${n(sheet.height)}" fill="${background}"/>`,
    )
  }
  lines.push(
    `  <g fill="none" stroke="none" stroke-linecap="round" stroke-linejoin="round" ` +
      `font-family="${FONT_STACK}" shape-rendering="geometricPrecision">`,
  )

  for (const layer of LAYER_ORDER) {
    const layerEntities = byLayer.get(layer)
    if (!layerEntities || layerEntities.length === 0) continue
    lines.push(`    <g id="${layer}">`)
    for (const entity of layerEntities) {
      lines.push(`      ${renderEntity(entity)}`)
    }
    lines.push('    </g>')
  }

  lines.push('  </g>')
  lines.push('</svg>')
  return `${lines.join('\n')}\n`
}

function renderEntity(entity: Entity): string {
  switch (entity.type) {
    case 'line':
      return `<line x1="${n(entity.a.x)}" y1="${n(entity.a.y)}" x2="${n(entity.b.x)}" y2="${n(
        entity.b.y,
      )}"${strokeAttrs(entity.style)}/>`
    case 'polyline': {
      const points = entity.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')
      const tag = entity.closed ? 'polygon' : 'polyline'
      return `<${tag} points="${points}"${strokeAttrs(entity.style)} fill="none"/>`
    }
    case 'polygon': {
      const points = entity.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')
      return `<polygon points="${points}" fill="${entity.style.fill ?? '#000000'}"/>`
    }
    case 'circle':
      return `<circle cx="${n(entity.center.x)}" cy="${n(entity.center.y)}" r="${n(
        entity.radius,
      )}"${strokeAttrs(entity.style)} fill="${entity.style.fill ?? 'none'}"/>`
    case 'text':
      return renderText(entity)
  }
}

function renderText(entity: TextEntity): string {
  const fontSize = entity.style.fontSize ?? 2.5
  const dy = baselineOffset(entity.baseline, fontSize)
  const anchor =
    entity.anchor === 'middle'
      ? ' text-anchor="middle"'
      : entity.anchor === 'end'
        ? ' text-anchor="end"'
        : ''
  const weight = entity.style.bold ? ' font-weight="bold"' : ''
  const rotate =
    entity.rotate === undefined || entity.rotate === 0
      ? ''
      : ` transform="rotate(${n(entity.rotate)} ${n(entity.at.x)} ${n(entity.at.y)})"`
  return (
    `<text x="${n(entity.at.x)}" y="${n(entity.at.y)}" dy="${n(dy)}" font-size="${n(fontSize)}" ` +
    `fill="${entity.style.fill ?? '#000000'}"${anchor}${weight}${rotate}>${escapeXml(entity.text)}</text>`
  )
}

function strokeAttrs(style: Style): string {
  let out = ` stroke="${style.stroke ?? '#000000'}" stroke-width="${n(style.strokeWidth ?? 0.25)}"`
  if (style.dash && style.dash.length > 0) {
    out += ` stroke-dasharray="${style.dash.map((d) => n(d)).join(' ')}"`
  }
  return out
}

function n(value: number): string {
  return String(round(value, 3))
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
