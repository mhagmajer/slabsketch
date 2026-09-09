/**
 * Wording of the text SlabSketch adds to a drawing.
 *
 * Only generated text is translated - titles, labels, notes and metadata come
 * from the input file and are reproduced verbatim in whatever language they
 * were written in. Diagnostics stay in English: they are read by whoever runs
 * the tool, not by whoever receives the drawing.
 */

import type { DrawingStatus } from './model/types.ts'
import { GENERATOR, HOMEPAGE } from './version.ts'

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
  /** Words drawn on the band that marks what an edge runs up against. */
  edgeConstraints: Record<'wall' | 'cabinet', string>
  /** The banner over the notes, which states what the drawing is. */
  statusBanner: (status: DrawingStatus, surveyedOn?: string, surveyedBy?: string) => string
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
  edgeConstraints: { wall: 'WALL', cabinet: 'CABINET' },
  statusBanner: (status, surveyedOn, surveyedBy) => {
    if (status === 'preliminary') {
      return 'PRELIMINARY DRAWING - all dimensions to be verified on site and by the fabricator.'
    }
    const survey = surveyedOn ? `surveyed ${surveyedOn}` : 'surveyed on site'
    const who = surveyedBy ? ` by ${surveyedBy}` : ''
    return `FOR FABRICATION - outline ${survey}${who}. Appliance sizes per makers' documentation.`
  },
  moreItems: (count) => `+${count} more`,
  generatedWith: (source) =>
    `Generated with ${GENERATOR}${source ? ` from ${source}` : ''} · ${HOMEPAGE}`,
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
  edgeConstraints: { wall: 'ŚCIANA', cabinet: 'MEBLE' },
  statusBanner: (status, surveyedOn, surveyedBy) => {
    if (status === 'preliminary') {
      return 'RYSUNEK WSTĘPNY - wszystkie wymiary do weryfikacji na budowie i przez wykonawcę.'
    }
    const survey = surveyedOn ? `z pomiaru z dnia ${surveyedOn}` : 'z pomiaru na miejscu'
    const who = surveyedBy ? `, ${surveyedBy}` : ''
    return `RYSUNEK WYKONAWCZY - obrys ${survey}${who}. Wymiary urządzeń wg dokumentacji producentów.`
  },
  moreItems: (count) => `+${count} więcej`,
  generatedWith: (source) =>
    `Wygenerowano w ${GENERATOR}${source ? ` z pliku ${source}` : ''} · ${HOMEPAGE}`,
  description: (scale, sheet) =>
    `Rysunek techniczny SlabSketch. Skala ${scale}, jednostki mm, format ${sheet}.`,
}

const TABLES: Record<Language, Strings> = { en, pl }

export function strings(language: Language): Strings {
  return TABLES[language]
}
