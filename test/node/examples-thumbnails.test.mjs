import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { EXAMPLES } from '../../web/examples.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

for (const ex of EXAMPLES) {
  test(`${ex.name} has a generated thumbnail`, () => {
    assert.equal(ex.thumbnail, `example-thumbnails/${ex.name}.png`);
    const png = readFileSync(resolve('web', ex.thumbnail));
    assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, `${ex.name}: bad PNG signature`);
    assert.ok(png.length > 1000, `${ex.name}: thumbnail looks empty (${png.length} bytes)`);
  });
}
