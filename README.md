# SlabSketch

Generate clean, dimensioned 2D technical drawings of countertops and stone slabs
from structured input, instead of drawing them by hand in CAD.

```text
YAML / JSON  →  validation  →  CountertopDocument  →  layout + dimensions  →  SVG / PDF
```

No generative image model is involved anywhere. The geometry is computed
deterministically from the numbers you supply: the same input always produces
byte-identical output.

The result is a **preliminary** drawing — the kind you send to a stone fabricator
so they can confirm the layout before producing their own CAD/CNC documentation.

## What it produces

One sheet, laid out the way a shop drawing is:

```text
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                                                                         │
 │                    ├────────────── 2840 ──────────────┤   ← overall     │
 │                ├────────── 2010 ─────────┤                              │
 │            ├────── 1650 ─────┤                            ← offsets     │
 │        ├─ 500 ─┤                                            from the    │
 │                                                             left edge   │
 │   │  ┌──────────────────────────────────────────────────────┐           │
 │   │  │        ┌──────────┐              ⊕  ⊕ ─── Ø35 Faucet │           │
 │  620 │        │├── 560 ──┤│           ┌────────┐            │           │
 │   │  │        │   Hob    │            │  Sink  │            │           │
 │   │  │        └──────────┘            └────────┘            │           │
 │   │  └──────────────────────────────────────────────────────┘           │
 │                                                                         │
 │  PRELIMINARY DRAWING — verify on site        ┌────────────────────────┐ │
 │  1. Undermount sink; …                       │ Kitchen countertop     │ │
 │                                              │ Material · Thickness   │ │
 │                                              │ Scale 1:10 · mm · A3   │ │
 │                                              └────────────────────────┘ │
 └─────────────────────────────────────────────────────────────────────────┘
```

- slab outline, cutouts and circular holes, drawn to scale on a real paper size
- **overall dimensions**, and each feature's **offset from a reference edge**
- **cutout sizes** dimensioned inside the opening, where there is room for them
- **diameter leaders** for holes, staggered so their labels never collide
- centre lines on holes, labels on cutouts, an explicit `(0,0)` origin marker
- title block with material, thickness, scale, units, sheet size and metadata
- notes block, always headed by a preliminary-drawing disclaimer
- generator stamp in the bottom margin, naming the version and the source file
- optional Polish wording for everything SlabSketch writes itself (`--lang pl`)

Generate the example drawings and open one:

```bash
npm run example
open examples/output/kitchen-countertop.svg
```

Generated drawings are not committed to this repository; the inputs that produce
them are:

| Example | What it shows |
| --- | --- |
| [`kitchen-countertop.yaml`](examples/kitchen-countertop.yaml) | a wall run with a hob, an undermount sink and two tap holes |
| [`kitchen-island.yaml`](examples/kitchen-island.yaml) | a deeper island, taps drilled in open material rather than against a wall |
| [`bathroom-vanity.yaml`](examples/bathroom-vanity.yaml) | a smaller part, drawn at 1:5 because `scale: auto` found it fits |
| [`tight-clearances.yaml`](examples/tight-clearances.yaml) | deliberately marginal geometry, so every proximity warning fires |
| [`blat-kuchenny.yaml`](examples/blat-kuchenny.yaml) | the same kind of part described in Polish, with `language: pl` |

## Installation

```bash
npm install -g slabsketch      # CLI
npm install slabsketch         # library
```

Or run it straight out of a clone:

```bash
git clone https://github.com/your-name/slabsketch.git
cd slabsketch
npm install
npm run build
node dist/cli.js examples/kitchen-countertop.yaml
```

## CLI

```bash
slabsketch countertop.yaml                          # → countertop.svg
slabsketch render countertop.yaml -o drawing.svg
slabsketch render countertop.yaml -o drawing.pdf    # format inferred
slabsketch check countertop.yaml --strict           # validate only
```

| Option | Meaning |
| --- | --- |
| `-o, --output <file>` | output path; `-` writes to stdout |
| `-f, --format <fmt>` | `svg` or `pdf` (default: inferred from `--output`, else `svg`) |
| `-s, --scale <scale>` | `1:10`, `1:20`, … or `auto` |
| `--sheet <size>` | `a5` `a4` `a3` `a2` `a1` |
| `--orientation <o>` | `landscape` or `portrait` |
| `--dimensions <d>` | `auto` or `none` |
| `--lang <code>` | `en` or `pl` — language of generated text |
| `--strict` | treat warnings as errors |
| `-q, --quiet` | print errors only |

Exit codes: `0` success, `1` validation errors (or warnings under `--strict`),
`2` usage problems.

With `scale: auto`, SlabSketch picks the largest scale from 1:1, 1:2, 1:5, 1:10,
1:20, 1:25, 1:50, 1:100, 1:200 at which the part *and its dimensions* still fit
the sheet.

### Language

`--lang pl` (or `drawing.language: pl` in the file) switches the text SlabSketch
writes itself: the title block field names, the preliminary-drawing note, the
notes heading and the generator stamp.

Names, labels, notes and metadata come from the input file and are reproduced
exactly as written — SlabSketch never translates your content. Diagnostics stay
in English: they are read by whoever runs the tool, not by whoever receives the
drawing.

The PDF writer keeps its promise of embedding no fonts. Polish characters are
absent from WinAnsiEncoding, so the characters a drawing actually uses are
collected and the missing ones are mapped, by their standard PostScript glyph
names, onto spare codes through an `/Encoding /Differences` table.

### Margins and the generator stamp

The frame sits 10 mm inside the page edge, with a further 8 mm of clear space
before the drawing, and the title block strip is reserved at the bottom. The
drawing is centred in what is left, so nothing ever touches the frame; a test
asserts this for every example on A4, A3 and A2.

The bottom margin, outside the frame, carries a stamp naming what produced the
file and from which input:

```text
Generated with SlabSketch v0.1.0 from kitchen-countertop.yaml
```

The SVG repeats it as a comment and in `<desc>`; the PDF puts it in `/Producer`
and `/Creator`.

## Input format

YAML or JSON — the same schema, pick whichever you prefer.

```yaml
version: 1

countertop:
  name: Kitchen countertop
  width: 2840          # along x
  depth: 620           # along y
  thickness: 20
  material: Silestone Blanco Norte

cutouts:
  - id: hob            # x, y = back-left corner of the opening
    label: Hob
    x: 500
    y: 65
    width: 560
    height: 490

holes:
  - id: faucet         # x, y = centre of the hole
    label: Faucet
    x: 1920
    y: 75
    diameter: 35

notes:
  - Undermount sink; cutout dimensions are the finished opening.

checks:                # thresholds for the proximity warnings
  minEdgeDistance: 50
  minFeatureDistance: 50

drawing:
  scale: auto          # or "1:10"
  sheet: a3
  orientation: landscape
  dimensions: auto     # or "none"
  language: en         # en | pl - language of generated text only
  reference:           # which edges offsets are measured from
    x: left            # left | right
    y: back            # back | front

metadata:
  project: Flat 4, Rosebery Avenue
  client: M. Nowak
  drawnBy: SlabSketch
  revision: A
```

Only `countertop` is required; everything else has a documented default.
Objects are **strict** — an unknown key such as `hight: 490` is an error, not a
silently ignored field. That matters when a coding agent is editing the file.

### Coordinate system

All lengths are millimetres. The drawing is a plan view, seen from above.

```text
      (0,0)
        ●──────────── x ─────────────▶      back edge (against the wall)
        │
        │        ┌──────────┐
        │  ┌ y ──┤  cutout  │            cutout x,y = its back-left corner
        │  │     └──────────┘
        │  ▼          ⊕                  hole  x,y = its centre
        │
        ▼                                     front edge
```

- origin `(0,0)` is the **back-left** corner of the slab
- `x` increases to the right
- `y` increases toward the front edge
- a rectangular cutout is anchored by its **back-left corner**
- a circular hole is anchored by its **centre**

By default, offsets are dimensioned from the left edge (x) and the back edge
(y). Change that per drawing with `drawing.reference`.

### Editing with a coding agent

The format exists so that geometry never lives in application code. A request
like

> Move the sink 80 mm to the right and add a 35 mm faucet hole 70 mm behind its
> centreline.

is a two-field edit to the YAML plus one new list entry, followed by a re-run of
the generator. Strict schema validation and the geometric checks catch the
mistakes such an edit can introduce (a cutout pushed off the slab, a duplicated
id, a hole landing inside an opening).

## Validation

Errors — the document will not render:

| Code | Meaning |
| --- | --- |
| `E_PARSE` | the file is not valid YAML/JSON, or is not a mapping |
| `E_SCHEMA` | wrong type, missing field, unknown key, non-positive size |
| `E_DUPLICATE_ID` | two features share an id |
| `E_CUTOUT_OUT_OF_BOUNDS` / `E_HOLE_OUT_OF_BOUNDS` | the feature leaves the slab |
| `E_HOLE_INSIDE_CUTOUT` | a hole overlaps an opening, so there is nothing to drill |

Warnings — rendered, but worth a look:

| Code | Meaning |
| --- | --- |
| `W_EDGE_CLEARANCE` | a feature is closer to an edge than `checks.minEdgeDistance` |
| `W_FEATURE_CLEARANCE` | the bridge between two features is thinner than `checks.minFeatureDistance` |
| `W_FEATURE_OVERLAP` | two cutouts, or two holes, overlap |
| `W_SCALE_CLAMPED` | the drawing does not fit the sheet at any standard scale |

> **The warnings are generic proximity heuristics, not fabrication rules.**
> Whether a given bridge of material is safe depends on the stone, the slab, the
> reinforcement and the fabricator's equipment. SlabSketch cannot know any of
> that. Every drawing it produces is preliminary and must be confirmed by the
> fabricator.

## Architecture

Six layers, each depending only on the ones above it. The geometry never knows
about SVG, and the renderers never know about YAML.

```text
  input/parse.ts       YAML | JSON  →  unknown          format detection
  input/schema.ts      Zod           →  InputFile        types, shape, positivity
  model/normalize.ts   InputFile     →  CountertopDocument
  validate/checks.ts   document      →  Diagnostic[]     bounds, overlaps, clearances
  geometry/            document      →  Dimension[]      what to measure, and where
  render/drawing.ts    document      →  Drawing          renderer-neutral primitives
  render/svg.ts        Drawing       →  string
  render/pdf.ts        Drawing       →  Uint8Array

  i18n.ts              wording of generated text (en, pl)
  text.ts              Helvetica metrics, shared by dimensioning and both writers
```

Two ideas carry most of the extensibility:

**`CountertopDocument`** is wider than the v1 input format. A slab owns a closed
`outline` polygon rather than a width/depth pair, features are a discriminated
union, and a document owns an *array* of slabs. L-shaped tops, polygonal
cutouts and multi-slab jobs therefore need a new normaliser, not a new renderer.

**`Drawing`** is a flat list of primitives — lines, polylines, circles, filled
polygons, text — in two spaces: `model` (real millimetres) and `paper` (sheet
millimetres, for the frame and title block). Stroke widths and font sizes are
always paper millimetres, so scale never changes line weights. A DXF exporter is
a small addition: it consumes `model` and ignores the rest.

Dimension placement is deterministic and rule-based:

1. openings large enough on paper carry their own width and height *inside* them
2. everything else is measured from the reference edge into stacked bands above
   and to the left of the part, innermost band first
3. a dimension moves one band outwards for as long as its label would collide
   with one already placed in that band, so chains nest by span length
4. a hole leader is placed in open material when a clear spot exists, and
   otherwise pushed out through whichever edge of the part is nearest; labels
   leaving through the same edge are staggered and kept off one another

### Library use

```ts
import { loadDocument, renderDocument } from 'slabsketch'

const loaded = loadDocument(source, { filename: 'countertop.yaml' })
if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join('\n'))

const { content } = renderDocument(loaded.document, 'svg')
```

Every stage is exported separately (`readInput`, `normalizeDocument`,
`checkDocument`, `autoDimensions`, `buildDrawing`, `renderSvg`, `renderPdf`) if
you want to stop partway or replace a step.

## Development

```bash
npm install
npm test              # node:test, no test framework dependency
npm run test:update   # accept changed SVG snapshots
npm run typecheck
npm run lint
npm run example       # render every examples/*.yaml into examples/output/
```

Requires Node 22.18+ for development (test and dev scripts run TypeScript
directly through Node's type stripping). The published package is plain
JavaScript and runs on Node 18+.

Runtime dependencies are `yaml` and `zod`. The SVG and PDF writers are written
from scratch; the PDF uses the base-14 Helvetica faces and embeds no fonts.

## Roadmap

- [ ] DXF export (the `Drawing` model space is already the right shape for it)
- [ ] L-shaped and polygonal countertops, rounded corners
- [ ] multiple slabs and backsplash pieces on one sheet
- [ ] seams and joints, with their own annotation style
- [ ] edge finishing annotations (profile, polished edges)
- [ ] undermount vs top-mount sink representation
- [ ] per-feature dimension overrides and manual placement hints
- [ ] more languages for the generated text (the tables live in `src/i18n.ts`)
- [ ] manufacturer constraint profiles for the proximity checks
- [ ] a browser editor over the same document model

## License

MIT — see [LICENSE](LICENSE).
