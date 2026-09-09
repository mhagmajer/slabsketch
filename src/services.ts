/**
 * Catalogue of the additional services a fabricator can be asked for.
 *
 * SlabSketch records *what was chosen and where*, and marks it on the drawing.
 * It deliberately knows nothing about prices: they vary by workshop, material
 * and job, and a preliminary drawing is the wrong place to quote them.
 *
 * Each service declares the kind of thing it can be applied to, and how its
 * extent is reported in the schedule:
 *
 *   edge    a run along one edge of the slab, measured in millimetres
 *   cutout  a rectangular opening, counted
 *   hole    a drilled hole, counted
 *   slab    the whole part, measured in square metres
 */

import type { Language } from './i18n.ts'

export type ServiceScope = 'edge' | 'cutout' | 'hole' | 'slab'
export type ServiceMeasure = 'length' | 'count' | 'area'

export interface ServiceDefinition {
  id: ServiceId
  scope: ServiceScope
  measure: ServiceMeasure
  names: Record<Language, string>
}

const DEFINITIONS = [
  // --- Openings -----------------------------------------------------------
  //
  // Named for the operation, not for what will sit in the hole - the fitting
  // is spelled out on the feature's own `product` line, so the service does not
  // have to guess between a sink and a basin. A hob keeps an entry of its own
  // because the work differs: its flange hides the cut, where an undermount
  // opening is polished and radiused.
  //
  // A price list groups these differently, by what they cost. A drawing is not
  // a price list.
  {
    id: 'hob-cutout',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Hob cutout', pl: 'Wycięcie pod płytę grzewczą' },
  },
  {
    id: 'top-mount-cutout',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Top-mounted cutout', pl: 'Wycięcie nakładane' },
  },
  {
    id: 'undermount-cutout',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Undermount cutout', pl: 'Wycięcie podwieszane' },
  },
  {
    id: 'flush-cutout',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Flush cutout, rebated', pl: 'Wycięcie licowane, z wpustem' },
  },
  {
    id: 'stone-sink-single',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Stone sink, single bowl', pl: 'Zlew kamienny jednokomorowy' },
  },
  {
    id: 'stone-sink-double',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Stone sink, two bowls', pl: 'Zlew kamienny dwukomorowy' },
  },
  {
    id: 'drainer-grooves',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Drainer grooves', pl: 'Ociekacz' },
  },
  {
    id: 'column-notch',
    scope: 'cutout',
    measure: 'count',
    names: { en: 'Notch for a concrete column', pl: 'Wycięcie pod słup żelbetowy' },
  },

  // --- Drilled holes ------------------------------------------------------
  {
    id: 'tap-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Tap hole', pl: 'Otwór pod baterię' },
  },
  {
    id: 'soap-dispenser-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Soap dispenser hole', pl: 'Otwór pod dozownik płynu' },
  },
  {
    id: 'pop-up-waste-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Pop-up waste hole', pl: 'Otwór pod korek automatyczny' },
  },
  {
    id: 'socket-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Socket hole', pl: 'Otwór na gniazdko' },
  },
  {
    // Not on the price list, which stops at fittings; the work exists all the
    // same, and a hole nobody named is a hole nobody drills.
    id: 'pipe-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Hole for a pipe or conduit', pl: 'Otwór na rurę lub przewód' },
  },
  {
    id: 'siphon-hole',
    scope: 'hole',
    measure: 'count',
    names: { en: 'Siphon hole', pl: 'Otwór na syfon' },
  },

  // --- Edge work ----------------------------------------------------------
  {
    id: 'underside-polish',
    scope: 'edge',
    measure: 'length',
    names: { en: 'Polished underside', pl: 'Poler od spodu' },
  },
  {
    id: 'led-groove',
    scope: 'edge',
    measure: 'length',
    names: { en: 'LED strip groove', pl: 'Nacięcie pod listwę LED' },
  },
  {
    id: 'thickened-edge',
    scope: 'edge',
    measure: 'length',
    names: { en: 'Thickened edge', pl: 'Pogrubienie' },
  },
  {
    id: 'half-bullnose',
    scope: 'edge',
    measure: 'length',
    names: { en: 'Half bullnose edge', pl: 'Półwałek' },
  },
  {
    id: 'quarter-bullnose',
    scope: 'edge',
    measure: 'length',
    names: { en: 'Quarter bullnose edge', pl: 'Ćwierćwałek' },
  },
  {
    id: 'waterfall-edge',
    scope: 'edge',
    measure: 'length',
    names: { en: 'Waterfall edge', pl: 'Kaskada' },
  },

  // --- Whole part ---------------------------------------------------------
  {
    id: 'underside-polish-all',
    scope: 'slab',
    measure: 'area',
    names: { en: 'Polished underside, whole slab', pl: 'Poler od spodu po całości' },
  },
] as const satisfies ReadonlyArray<{
  id: string
  scope: ServiceScope
  measure: ServiceMeasure
  names: Record<Language, string>
}>

export type ServiceId = (typeof DEFINITIONS)[number]['id']

export const SERVICE_IDS = DEFINITIONS.map((d) => d.id) as ServiceId[]

const BY_ID = new Map<string, ServiceDefinition>(
  DEFINITIONS.map((d) => [d.id, d as unknown as ServiceDefinition]),
)

export function serviceDefinition(id: ServiceId): ServiceDefinition {
  const definition = BY_ID.get(id)
  if (!definition) throw new Error(`unknown service "${id}"`)
  return definition
}

export function serviceName(id: ServiceId, language: Language): string {
  return serviceDefinition(id).names[language]
}

/** Services that may be applied to something of this kind. */
export function servicesForScope(scope: ServiceScope): ServiceDefinition[] {
  return SERVICE_IDS.map(serviceDefinition).filter((d) => d.scope === scope)
}
