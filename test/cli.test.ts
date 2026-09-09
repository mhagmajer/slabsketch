import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { promisify } from 'node:util'
import { CLI_PATH, EXAMPLE_YAML } from './helpers.ts'

const run = promisify(execFile)

interface Run {
  code: number
  stdout: string
  stderr: string
}

async function cli(...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (cause) {
    const error = cause as { code?: number; stdout?: string; stderr?: string }
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slabsketch-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('cli', () => {
  it('renders an SVG next to the input by default', async () => {
    const input = join(dir, 'copy.yaml')
    await writeFile(input, await readFile(EXAMPLE_YAML, 'utf8'))
    const result = await cli(input)
    assert.equal(result.code, 0, result.stderr)
    const svg = await readFile(join(dir, 'copy.svg'), 'utf8')
    assert.ok(svg.startsWith('<?xml'))
  })

  it('accepts the explicit render verb and an output path', async () => {
    const out = join(dir, 'nested', 'drawing.svg')
    const result = await cli('render', EXAMPLE_YAML, '-o', out)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /wrote .*drawing\.svg \(SVG, scale 1:10, sheet A3\)/)
    assert.ok((await readFile(out, 'utf8')).includes('<g id="dimension">'))
  })

  it('infers the format from the output extension', async () => {
    const out = join(dir, 'drawing.pdf')
    assert.equal((await cli('render', EXAMPLE_YAML, '-o', out)).code, 0)
    assert.ok((await readFile(out)).subarray(0, 8).toString() === '%PDF-1.4')
  })

  it('writes to stdout when asked', async () => {
    const result = await cli('render', EXAMPLE_YAML, '-o', '-')
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.startsWith('<?xml'))
  })

  it('applies scale and sheet overrides', async () => {
    const result = await cli('render', EXAMPLE_YAML, '-o', '-', '--scale', '1:25', '--sheet', 'a4')
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('width="297mm" height="210mm"'))
    assert.ok(result.stdout.includes('Scale 1:25'))
  })

  it('validates without writing anything', async () => {
    const result = await cli('check', EXAMPLE_YAML)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stderr, /is valid \(0 warnings\)/)
    assert.equal(result.stdout, '')
  })

  it('fails with diagnostics on invalid geometry', async () => {
    const input = join(dir, 'broken.yaml')
    await writeFile(
      input,
      'countertop: { name: S, width: 1000, depth: 600, thickness: 20 }\n' +
        'cutouts: [{ id: sink, x: 900, y: 100, width: 300, height: 200 }]\n',
    )
    const result = await cli('check', input)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /E_CUTOUT_OUT_OF_BOUNDS/)
  })

  it('turns warnings into failures with --strict', async () => {
    const input = join(dir, 'close.yaml')
    await writeFile(
      input,
      'countertop: { name: S, width: 1000, depth: 600, thickness: 20 }\n' +
        'cutouts: [{ id: sink, x: 10, y: 100, width: 300, height: 200 }]\n',
    )
    assert.equal((await cli('check', input)).code, 0)
    const strict = await cli('check', input, '--strict')
    assert.equal(strict.code, 1)
    assert.match(strict.stderr, /W_EDGE_CLEARANCE/)
  })

  it('switches the generated text to Polish', async () => {
    const result = await cli('render', EXAMPLE_YAML, '-o', '-', '--lang', 'pl')
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('Materiał:'))
    assert.ok(result.stdout.includes('RYSUNEK WSTĘPNY'))
    assert.ok(!result.stdout.includes('PRELIMINARY'))
  })

  it('stamps the source file name into the drawing', async () => {
    const result = await cli('render', EXAMPLE_YAML, '-o', '-')
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('from kitchen-countertop.yaml'))
  })

  it('reports usage problems with exit code 2', async () => {
    assert.equal((await cli()).code, 2)
    assert.equal((await cli('render', EXAMPLE_YAML, '-f', 'dxf')).code, 2)
    assert.equal((await cli('render', EXAMPLE_YAML, '--sheet', 'a9')).code, 2)
    assert.equal((await cli('render', EXAMPLE_YAML, '--lang', 'de')).code, 2)
    assert.equal((await cli('render', join(dir, 'missing.yaml'))).code, 2)
  })

  it('prints help and version', async () => {
    const help = await cli('--help')
    assert.equal(help.code, 0)
    assert.match(help.stdout, /Usage:/)
    assert.match(help.stdout, /--lang <code>/)
    const version = await cli('--version')
    assert.equal(version.code, 0)
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/)
  })
})
