import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// render-client normally imports the generated flat-deploy ./index.js, which
// does not exist in the repository tree. Load the COMPILED module through a data
// URL with that one import redirected to a tiny mock so its pure runtime policies
// can be tested without a wasm build or a filesystem shim.
//
// _build/web, not web/: the source is TypeScript now, and Node cannot execute
// that (nor can a data: URL declare itself as TS). tools/build-web.mjs keeps the
// artifact current, and the pre-hooks on every `test:*` script run it first.
const wrapperMock = [
  'export async function render() { throw new Error("unused render mock"); }',
  'export async function renderAnimation() { throw new Error("unused animation mock"); }',
  'export class PovrayError extends Error {}',
  'export async function warmup() {}',
].join('\n');
const mockUrl = `data:text/javascript;base64,${Buffer.from(wrapperMock).toString('base64')}`;
const clientSource = readFileSync(
  new URL('../../_build/web/render-client.js', import.meta.url),
  'utf8'
)
  .replace("from './index.js'", `from '${mockUrl}'`)
  // Drop the compiled artifact's inline source map. It is meaningless here (its
  // `sources` are relative to _build/web, which a data: URL cannot resolve), and
  // keeping it breaks the coverage run outright: Node records the map against the
  // data: URL in its source-map cache, and c8's report step calls fileURLToPath on
  // every cache key, which throws ERR_INVALID_URL_SCHEME on anything but file:.
  // This module's own coverage comes from the browser suites either way.
  .replace(/\n\/\/# sourceMappingURL=.*$/, '');
const client = await import(
  `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}#runtime-policy`
);

test('animation memory estimate accounts for encoded and decoded frame storage', () => {
  assert.equal(client.estimateAnimationMemoryBytes(800, 600, 24), 92_160_000);
  assert.ok(
    client.estimateAnimationMemoryBytes(2048, 2048, 16) > client.ANIMATION_MEMORY_BUDGET_BYTES
  );
});

test('oversized animation rejects before claiming the render-client busy lock', async () => {
  await assert.rejects(
    client.renderAnimation('unused', { width: 2048, height: 2048, frames: 16 }),
    /animation needs about .* MiB.*reduce the frame count or resolution/
  );
  assert.equal(client.isBusy(), false);

  // Omitted dimensions use the wrapper's 800x600 defaults and remain below the
  // limit for a short animation (the wrapper mock proves policy ran first).
  await assert.rejects(client.renderAnimation('unused', { frames: 2 }), /unused animation mock/);
  assert.equal(client.isBusy(), false);
});

test('bitmap decoding is concurrency-bounded and preserves frame order', async () => {
  const original = globalThis.createImageBitmap;
  let active = 0;
  let maxActive = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (blob) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return { id: await blob.text(), close() {} };
    },
  });
  try {
    const bitmaps = await client.decodeAnimationBitmaps(
      ['0', '1', '2', '3', '4'].map((value) => new Blob([value]))
    );
    assert.ok(maxActive <= 2, `expected at most two concurrent decodes, saw ${maxActive}`);
    assert.deepEqual(
      bitmaps.map((bitmap) => bitmap.id),
      ['0', '1', '2', '3', '4']
    );
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: original,
      });
  }
});

test('partial bitmap decode failure closes every bitmap that did succeed', async () => {
  const original = globalThis.createImageBitmap;
  const closed = [];
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (blob) => {
      const id = await blob.text();
      if (id === 'bad') throw new Error('decode failed');
      return { id, close: () => closed.push(id) };
    },
  });
  try {
    await assert.rejects(
      client.decodeAnimationBitmaps(['a', 'bad', 'c'].map((value) => new Blob([value]))),
      /decode failed/
    );
    assert.deepEqual(closed.sort(), ['a', 'c']);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        value: original,
      });
  }
});
