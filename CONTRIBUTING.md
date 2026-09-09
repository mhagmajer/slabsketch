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

## Adding an exporter

Exporters consume a `Drawing` (see `src/render/drawing.ts`) and nothing else.
Model-space entities are real millimetres, which is what a DXF exporter wants;
paper-space entities are sheet furniture. Add the format to `OutputFormat` in
`src/index.ts` and to the CLI's `--format` handling.
