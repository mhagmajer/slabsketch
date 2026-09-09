/**
 * Pictograms for the additional services.
 *
 * These are drawn, not imported: the schedule needs symbols that scale with the
 * sheet, survive a PDF that embeds nothing, and never depend on an external
 * file. They follow the usual convention for this kind of order form - a plan
 * view for anything cut through the slab, a section for anything done to an
 * edge - but the geometry here is our own.
 *
 * Every icon is authored on a 24 x 14 grid with y pointing down, and scaled
 * uniformly into whatever slot the schedule gives it.
 */

import type { ServiceId } from '../services.ts'

export const ICON_BOX = { width: 24, height: 14 } as const

export type IconPoint = readonly [number, number]

export type IconPrimitive =
  | { kind: 'poly'; points: IconPoint[]; closed: boolean; fill?: boolean }
  | { kind: 'circle'; center: IconPoint; radius: number; fill?: boolean }

/** Points along a circular arc; degrees, with -90 up and 0 to the right. */
function arc(
  cx: number,
  cy: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
  steps = 8,
): IconPoint[] {
  const points: IconPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
  }
  return points
}

/** Outline of the slab seen from above, used by everything cut through it. */
const PLAN_OUTLINE: IconPrimitive = {
  kind: 'poly',
  points: [
    [2, 3],
    [22, 3],
    [22, 11],
    [2, 11],
  ],
  closed: true,
}

/** The slab in section, interrupted by an opening. */
function sectionWithOpening(): IconPrimitive[] {
  return [
    {
      kind: 'poly',
      points: [
        [1, 7],
        [8, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [1, 10],
        [8, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [8, 7],
        [8, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 7],
        [23, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 10],
        [23, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 7],
        [16, 10],
      ],
      closed: false,
    },
  ]
}

/** A four-pointed sparkle, the usual mark for a polished surface. */
function sparkle(x: number, y: number, size: number): IconPrimitive {
  return {
    kind: 'poly',
    points: [
      [x, y - size],
      [x + size * 0.42, y],
      [x, y + size],
      [x - size * 0.42, y],
    ],
    closed: true,
    fill: true,
  }
}

/** A small hole in plan: a circle struck through, as on a fabrication drawing. */
function holeMark(x: number, y: number, radius: number): IconPrimitive[] {
  const reach = radius * 1.25
  return [
    { kind: 'circle', center: [x, y], radius },
    {
      kind: 'poly',
      points: [
        [x - reach * 0.7, y + reach * 0.7],
        [x + reach * 0.7, y - reach * 0.7],
      ],
      closed: false,
    },
  ]
}

const ICONS: Record<ServiceId, IconPrimitive[]> = {
  // --- Openings, in section -----------------------------------------------
  'hob-cutout': [
    ...sectionWithOpening(),
    // The hob rests on the worktop; the circle is a burner seen from the side.
    {
      kind: 'poly',
      points: [
        [6, 5],
        [18, 5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [6, 5],
        [6, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [18, 5],
        [18, 7],
      ],
      closed: false,
    },
    { kind: 'circle', center: [12, 3.2], radius: 1.6 },
  ],
  'top-mount-cutout': [
    ...sectionWithOpening(),
    // The rim rests on top of the worktop and overhangs the opening.
    {
      kind: 'poly',
      points: [
        [6, 5],
        [18, 5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [6, 5],
        [6, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [18, 5],
        [18, 7],
      ],
      closed: false,
    },
  ],
  'undermount-cutout': [
    ...sectionWithOpening(),
    // The rim hangs under the worktop, leaving the top face clear.
    {
      kind: 'poly',
      points: [
        [6, 12],
        [18, 12],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [6, 10],
        [6, 12],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [18, 10],
        [18, 12],
      ],
      closed: false,
    },
  ],
  // Let into a rebate, so the two top faces finish level.
  'flush-cutout': [
    {
      kind: 'poly',
      points: [
        [1, 7],
        [8, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [1, 10],
        [8, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [8, 7],
        [8, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 7],
        [23, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 10],
        [23, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [16, 7],
        [16, 10],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [6, 7],
        [18, 7],
        [18, 8.6],
        [6, 8.6],
      ],
      closed: true,
    },
  ],

  // --- Openings, in plan ---------------------------------------------------
  'stone-sink-single': [PLAN_OUTLINE, { kind: 'circle', center: [12, 7], radius: 1.4 }],
  'stone-sink-double': [
    PLAN_OUTLINE,
    {
      kind: 'poly',
      points: [
        [12, 3],
        [12, 11],
      ],
      closed: false,
    },
    { kind: 'circle', center: [7, 7], radius: 1.2 },
    { kind: 'circle', center: [17, 7], radius: 1.2 },
  ],
  'drainer-grooves': [
    PLAN_OUTLINE,
    {
      kind: 'poly',
      points: [
        [4, 4.5],
        [8.5, 4.5],
        [8.5, 9.5],
        [4, 9.5],
      ],
      closed: true,
    },
    {
      kind: 'poly',
      points: [
        [10.5, 5],
        [20, 5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [10.5, 6.5],
        [20, 6.5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [10.5, 8],
        [20, 8],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [10.5, 9.5],
        [20, 9.5],
      ],
      closed: false,
    },
  ],
  'column-notch': [
    {
      kind: 'poly',
      points: [
        [2, 4],
        [9, 4],
        [9, 7],
        [15, 7],
        [15, 4],
        [22, 4],
        [22, 11],
        [2, 11],
      ],
      closed: true,
    },
  ],

  // --- Drilled holes, in plan ---------------------------------------------
  'tap-hole': [PLAN_OUTLINE, ...holeMark(9, 7, 1.6)],
  'siphon-hole': [PLAN_OUTLINE, ...holeMark(12, 7, 2.6)],
  'soap-dispenser-hole': [
    PLAN_OUTLINE,
    ...holeMark(4.8, 4.8, 1.1),
    {
      kind: 'poly',
      points: [
        [7.5, 4.5],
        [11, 4.5],
        [11, 9.5],
        [7.5, 9.5],
      ],
      closed: true,
    },
    {
      kind: 'poly',
      points: [
        [13, 5.5],
        [20, 5.5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [13, 7],
        [20, 7],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [13, 8.5],
        [20, 8.5],
      ],
      closed: false,
    },
  ],
  'pop-up-waste-hole': [
    PLAN_OUTLINE,
    { kind: 'circle', center: [12, 7], radius: 2 },
    // Eight teeth, for the ring of a pop-up waste.
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((degrees): IconPrimitive => {
      const angle = (degrees * Math.PI) / 180
      return {
        kind: 'poly',
        points: [
          [12 + 2 * Math.cos(angle), 7 + 2 * Math.sin(angle)],
          [12 + 3 * Math.cos(angle), 7 + 3 * Math.sin(angle)],
        ],
        closed: false,
      }
    }),
  ],
  'socket-hole': [
    PLAN_OUTLINE,
    { kind: 'circle', center: [12, 7], radius: 2.6 },
    { kind: 'circle', center: [10.7, 7], radius: 0.5, fill: true },
    { kind: 'circle', center: [13.3, 7], radius: 0.5, fill: true },
  ],

  // --- Edge work, in section ----------------------------------------------
  // Polishing a run of edge: part of the underside is worked, and the run is
  // ticked at both ends.
  'underside-polish': [
    {
      kind: 'poly',
      points: [
        [11, 7],
        [22, 7],
        [22, 9],
        [11, 9],
      ],
      closed: true,
      fill: true,
    },
    {
      kind: 'poly',
      points: [
        [2, 5],
        [22, 5],
        [22, 9],
        [2, 9],
      ],
      closed: true,
    },
    {
      kind: 'poly',
      points: [
        [11, 9],
        [11, 11.5],
      ],
      closed: false,
    },
    {
      kind: 'poly',
      points: [
        [22, 9],
        [22, 11.5],
      ],
      closed: false,
    },
    sparkle(18, 8, 1.4),
  ],
  // The whole underside: the entire section is worked.
  'underside-polish-all': [
    {
      kind: 'poly',
      points: [
        [2, 6.6],
        [22, 6.6],
        [22, 9],
        [2, 9],
      ],
      closed: true,
      fill: true,
    },
    {
      kind: 'poly',
      points: [
        [2, 5],
        [22, 5],
        [22, 9],
        [2, 9],
      ],
      closed: true,
    },
    sparkle(7, 7.8, 1.4),
    sparkle(13, 7.8, 1.4),
    sparkle(19, 7.8, 1.4),
  ],
  'led-groove': [
    {
      kind: 'poly',
      points: [
        [2, 5],
        [22, 5],
        [22, 9],
        [15, 9],
        [15, 7.4],
        [10, 7.4],
        [10, 9],
        [2, 9],
      ],
      closed: true,
    },
  ],
  'thickened-edge': [
    {
      kind: 'poly',
      points: [
        [2, 4],
        [22, 4],
        [22, 7.5],
        [8, 7.5],
        [8, 11],
        [2, 11],
      ],
      closed: true,
    },
  ],
  'half-bullnose': [
    {
      kind: 'poly',
      points: [[7, 3], [13, 3], ...arc(13, 7, 4, -90, 90), [7, 11]],
      closed: true,
    },
  ],
  'quarter-bullnose': [
    {
      kind: 'poly',
      points: [[7, 3], [10, 3], ...arc(10, 7, 4, -90, 0), [14, 11], [7, 11]],
      closed: true,
    },
  ],
  'waterfall-edge': [
    {
      kind: 'poly',
      points: [
        [5, 3],
        [10, 3],
        ...arc(10, 6, 3, -90, 0),
        [13, 8],
        ...arc(13, 11, 3, -90, 0),
        [16, 12],
        [5, 12],
      ],
      closed: true,
      fill: true,
    },
    {
      kind: 'poly',
      points: [
        [5, 3],
        [10, 3],
        ...arc(10, 6, 3, -90, 0),
        [13, 8],
        ...arc(13, 11, 3, -90, 0),
        [16, 12],
        [5, 12],
      ],
      closed: true,
    },
  ],
}

export function serviceIcon(id: ServiceId): IconPrimitive[] {
  return ICONS[id]
}
