/**
 * Wording of the text SlabSketch adds to a drawing.
 *
 * Only generated text is translated - titles, labels, notes and metadata come
 * from the input file and are reproduced verbatim in whatever language they
 * were written in. Diagnostics stay in English: they are read by whoever runs
 * the tool, not by whoever receives the drawing.
 */

import { GENERATOR } from './version.ts'

export type Language = 'en' | 'pl'

export const LANGUAGES: readonly Language[] = ['en', 'pl']

export interface Strings {
  material: string
  thickness: string
  scale: string
  units: string
  sheet: string
  project: string
  client: string
  drawnBy: string
  revision: string
  notesHeading: string
  servicesHeading: string
  /** Column words used in the services schedule. */
  wholeSlab: string
  edgeNames: Record<'back' | 'front' | 'left' | 'right', string>
  preliminary: string
  moreItems: (count: number) => string
  generatedWith: (source?: string) => string
  description: (scale: string, sheet: string) => string
}

const en: Strings = {
  material: 'Material',
  thickness: 'Thickness',
  scale: 'Scale',
  units: 'Units',
  sheet: 'Sheet',
  project: 'Project',
  client: 'Client',
  drawnBy: 'Drawn',
  revision: 'Rev.',
  notesHeading: 'NOTES',
  servicesHeading: 'ADDITIONAL SERVICES',
  wholeSlab: 'whole slab',
  edgeNames: { back: 'back edge', front: 'front edge', left: 'left edge', right: 'right edge' },
  preliminary: 'PRELIMINARY DRAWING - all dimensions to be verified on site and by the fabricator.',
  moreItems: (count) => `+${count} more`,
  generatedWith: (source) =>
    source ? `Generated with ${GENERATOR} from ${source}` : `Generated with ${GENERATOR}`,
  description: (scale, sheet) =>
    `SlabSketch technical drawing. Scale ${scale}, units mm, sheet ${sheet}.`,
}

const pl: Strings = {
  material: 'Materiał',
  thickness: 'Grubość',
  scale: 'Skala',
  units: 'Jednostki',
  sheet: 'Format',
  project: 'Projekt',
  client: 'Klient',
  drawnBy: 'Rysował',
  revision: 'Rew.',
  notesHeading: 'UWAGI',
  servicesHeading: 'USŁUGI DODATKOWE',
  wholeSlab: 'cały blat',
  edgeNames: {
    back: 'krawędź tylna',
    front: 'krawędź przednia',
    left: 'krawędź lewa',
    right: 'krawędź prawa',
  },
  preliminary: 'RYSUNEK WSTĘPNY - wszystkie wymiary do weryfikacji na budowie i przez wykonawcę.',
  moreItems: (count) => `+${count} więcej`,
  generatedWith: (source) =>
    source ? `Wygenerowano w ${GENERATOR} z pliku ${source}` : `Wygenerowano w ${GENERATOR}`,
  description: (scale, sheet) =>
    `Rysunek techniczny SlabSketch. Skala ${scale}, jednostki mm, format ${sheet}.`,
}

const TABLES: Record<Language, Strings> = { en, pl }

export function strings(language: Language): Strings {
  return TABLES[language]
}
