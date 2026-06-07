// Node render tests. Run via `node --test test/node/` against the exported
// ./dist artifact (`make dist`), and deliberately WITHOUT --test-force-exit:
// a clean runner exit is itself part of what we verify (EXIT_RUNTIME=1 must
// reap the pthread workers, otherwise the process hangs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { render, PovrayError } from '../../dist/index.js';

const DIST_URL = new URL('../../dist/index.js', import.meta.url).href;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const scene = await readFile(new URL('../fixtures/basic.pov', import.meta.url), 'utf8');

test('renders the fixture to a 320x240 PNG', async () => {
  const png = await render(scene, { width: 320, height: 240, antialias: false });

  assert.ok(png instanceof Uint8Array, 'render() must resolve to a Uint8Array');
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature mismatch');

  // IHDR is always the first chunk: width at bytes 16-19, height at 20-23 (big-endian).
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16), 320, 'IHDR width');
  assert.equal(view.getUint32(20), 240, 'IHDR height');

  assert.ok(png.length > 2000, `suspiciously small PNG (${png.length} bytes)`);

  // The wrapper must hand back a copy, never a view into (growable, shared) wasm memory.
  assert.ok(
    !(png.buffer instanceof SharedArrayBuffer),
    'returned buffer is SharedArrayBuffer-backed'
  );
});

test('rejects with PovrayError on a parse error', async () => {
  await assert.rejects(render('sphere {'), (err) => {
    assert.ok(err instanceof PovrayError, `expected PovrayError, got ${err?.constructor?.name}`);
    assert.notEqual(err.exitCode, 0, 'exitCode should be non-zero');
    assert.match(err.log, /Parse Error/i);
    return true;
  });
});

test('process exits on its own after a render (EXIT_RUNTIME reaps workers)', () => {
  // A child process renders once and then does nothing. If leaked pthread
  // workers keep the event loop alive, the child never exits and spawnSync
  // kills it at the timeout (signal !== null).
  //
  // The child must run from a real .mjs file, NOT `--input-type=module -e`:
  // emscripten's pthread Workers inherit the child's execArgv, and a Worker
  // whose entry is a file URL dies with ERR_INPUT_TYPE_NOT_ALLOWED when
  // --input-type is present (observed on Node 25).
  const script = join(tmpdir(), `povrayer-exit-test-${process.pid}.mjs`);
  writeFileSync(
    script,
    [
      `const { render } = await import(${JSON.stringify(DIST_URL)});`,
      `await render(${JSON.stringify(scene)}, { width: 64, height: 48, antialias: false });`,
    ].join('\n')
  );

  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 120_000,
    });

    assert.equal(
      result.signal,
      null,
      `child did not exit on its own (killed with ${result.signal}); stderr:\n${result.stderr}`
    );
    assert.equal(result.status, 0, `child exited ${result.status}; stderr:\n${result.stderr}`);
  } finally {
    rmSync(script, { force: true });
  }
});

test('honors threads and raw args options', async () => {
  const png = await render(scene, {
    width: 160,
    height: 120,
    threads: 2,
    args: ['+A0.5'],
  });
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature mismatch');
});
