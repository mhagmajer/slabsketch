# Contributing to SlabSketch

Thanks for taking a look. SlabSketch is small on purpose; the aim is that
anyone can read the whole thing in an afternoon.

## Getting set up

```bash
npm install
npm test
```

Development needs Node 22.18 or newer — the dev and test scripts run TypeScript
directly through Node's built-in type stripping, so there is no build step and
no test framework to install.

## Before opening a pull request

```bash
npm run check     # lint, typecheck, test and build, in that order
```

That is exactly what CI runs, so a green `npm run check` should mean a green
build. Run it rather than the individual steps: the formatter is part of
`npm run lint`, and it is easy to reformat a file by accident and only find out
from CI.

If a change alters the example drawing, run `npm run test:update` and include
the updated snapshot in `test/__snapshots__/`. Review the diff: a snapshot that
changed for a reason you cannot explain is a bug, not a snapshot to accept.

## Design rules worth knowing

- **The layers only point one way.** `input → model → validate → geometry →
  render`. Geometry code must not import a renderer; renderers must not import
  the input schema.
- **Output is deterministic.** No timestamps, no random ids, no iteration over
  unordered collections. Both the SVG and the PDF writer are covered by
  render-twice-and-compare tests; keep them passing.
- **Paper units and model units are different things.** Coordinates are model
  millimetres. Stroke widths, font sizes and dimension offsets are *paper*
  millimetres and are divided by the scale at the point of use.
- **Geometry belongs in input files, never in code.** If a feature needs new
  geometry to demonstrate it, add an example, not a fixture in a source file.
- **Warnings are heuristics.** SlabSketch does not encode fabrication safety
  rules and should not claim to. Keep the wording of new warnings honest.
- **A new layer has to be registered.** `LAYER_ORDER` in `render/svg.ts` is the
  list the SVG walks, so a layer missing from it is dropped from the SVG while
  still appearing in the PDF. A test asserts the list covers the `Layer` union;
  keep it that way.
- **A new character needs a width.** The PDF states its own font metrics, and a
  glyph absent from the tables in `text.ts` is advanced by the fallback width,
  which shows up as text that overlaps or straggles. If you add a character to
  any generated string, add it to both the regular and the bold table.
- **Nothing is dropped in silence.** Notes that do not fit, a drawing too big
  for its sheet, a service on an edge nobody will see: each of these raises a
  diagnostic. A fabrication drawing that quietly loses information is worse
  than one that looks wrong.

## Judging a change to the drawing

Two things decide whether a layout change is an improvement, and only one of
them is automated.

The snapshot in `test/__snapshots__/` will tell you that the drawing changed.
It cannot tell you whether it got better: every placement fault in this
project's history — leaders crossing, a balloon on a label, hatching too faint
to read, Polish letters colliding in the PDF — was found by looking at the
output, not by a failing test. Render the examples and look at them:

```bash
npm run example
open examples/output/solgaz-optimex-wenecja-easy.svg
```

That example is the busiest one: three walled edges, two openings with
different mounting, five holes, a radius callout and ten notes. If a change
survives it, it will survive most things.

## Documentation

The README is checked, not just written. `test/readme.test.ts` parses its
reference YAML block, validates it and renders it, and asserts that every
diagnostic code, service id, drawing layer and language appears in the file. So
adding any of those to the code fails the suite until the README catches up,
and the example in the README cannot quietly stop being valid input.

## Adding an exporter

Exporters consume a `Drawing` (see `src/render/drawing.ts`) and nothing else.
Model-space entities are real millimetres, which is what a DXF exporter wants;
paper-space entities are sheet furniture. Add the format to `OutputFormat` in
`src/index.ts` and to the CLI's `--format` handling.
