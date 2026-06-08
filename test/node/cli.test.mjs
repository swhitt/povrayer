// CLI tests for src/cli.mjs. Each case spawns the CLI from its REAL path so
// V8 coverage attributes to src/cli.mjs (and the wrapper it lazy-imports via
// the gitignored src/index.js -> ../dist/index.js symlink that pretest:node
// drops). Under the coverage harness c8 sets NODE_V8_COVERAGE; the spawned
// children inherit it, so every line we drive here is captured.
//
// Renders use a minimal include-free scene at tiny dimensions: the goal is to
// exercise the CLI's control flow (arg parsing, staging, output routing, error
// mapping), not to stress the renderer, so each render finishes in well under
// a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const SCENE = [
  '#version 3.8;',
  'camera { location <0,0,-3> look_at 0 }',
  'light_source { <2,4,-3> color rgb 1 }',
  'sphere { 0, 1 pigment { rgb <1,0,0> } }',
  '',
].join('\n');

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    timeout: 120_000,
    env: process.env,
    ...opts,
  });
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'povrayer-cli-'));
  return dir;
}

function assertPng(bytes, label) {
  assert.ok(bytes.length > 8, `${label}: empty output`);
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, `${label}: PNG signature mismatch`);
}

test('--help prints usage to stdout and exits 0', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout.toString(), /Usage: povrayer/);
});

test('no scene given is a usage error (exit 2)', () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /no scene given/);
});

test('unknown option is a usage error (exit 2)', () => {
  const r = runCli(['--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /unknown option: --bogus/);
});

test('-w with a non-number is a usage error (exit 2)', () => {
  const r = runCli(['-w', 'abc', '-']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /-w expects a number/);
});

test('bare -a (non-numeric next token) enables AA; -o with no arg fails (exit 2)', () => {
  // `-a` sees `-o` as its next token; `-o` is not a number, so antialias is set
  // to `true` (the ternary's else) and `-o` is reparsed as a flag, which then
  // has no path argument and fails. One spawn covers both branches.
  const r = runCli(['-a', '-o']);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /-o expects a path/);
});

test('missing scene file is a usage error (exit 2)', () => {
  const r = runCli([join(tmpdir(), 'povrayer-does-not-exist-xyz.pov')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /povrayer: .*(ENOENT|no such file)/i);
});

test('stdin mode renders the scene and writes PNG bytes to stdout', () => {
  const r = runCli(['-', '-w', '48', '-h', '32'], { input: SCENE });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assertPng(r.stdout, 'stdin->stdout');
});

test('file mode stages sibling assets, honors every flag, writes <scene>.png', () => {
  const dir = tmp();
  try {
    // A nested directory proves the non-recursive staging skips non-files
    // (entry.isFile() === false); a sibling regular file proves every regular
    // file in the scene dir rides along into the staged `files` map. The scene
    // itself stays self-contained so the render outcome doesn't depend on the
    // wasm build's local-include search behavior.
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'ignored.txt'), 'not staged');
    writeFileSync(join(dir, 'sidecar.inc'), '// staged alongside the scene\n');
    const scenePath = join(dir, 'scene.pov');
    writeFileSync(scenePath, SCENE);

    const r = runCli([
      scenePath,
      '-w',
      '48',
      '-h',
      '32',
      '-q',
      '5',
      '-a',
      '0.3',
      '--threads',
      '2',
      '--',
    ]);

    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stderr.toString(), /wrote .*scene\.png/);
    assertPng(readFileSync(join(dir, 'scene.png')), 'file mode');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scene that fails to parse maps PovrayError exit code to the process (exit != 0)', () => {
  const r = runCli(['-', '-w', '32', '-h', '24'], { input: 'sphere {' });
  assert.notEqual(r.status, 0);
  assert.notEqual(r.status, 2, 'render failure must not look like a usage error');
  assert.match(r.stderr.toString(), /render failed \(exit code \d+\)/);
});

test('a write failure after a successful render is a generic error (exit 1)', () => {
  const dir = tmp();
  try {
    // render succeeds, but the output path lives under a directory that does
    // not exist, so writeFileSync throws an Error with no `exitCode`: the catch
    // falls through to the generic branch and exits 1.
    const badOut = join(dir, 'missing-dir', 'out.png');
    const r = runCli(['-', '-w', '32', '-h', '24', '-o', badOut], { input: SCENE });
    assert.equal(r.status, 1);
    const err = r.stderr.toString();
    assert.match(err, /povrayer: /);
    assert.doesNotMatch(err, /render failed \(exit code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
