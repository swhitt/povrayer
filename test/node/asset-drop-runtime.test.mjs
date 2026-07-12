import { test } from 'node:test';
import assert from 'node:assert/strict';

import { referencedAssetFiles } from '../../web/asset-drop.js';

const bytes = (...values) => new Uint8Array(values);
/** @param {Array<[string, string | Uint8Array]>} entries */
const registryOf = (entries) => new Map(entries);

test('referencedAssetFiles omits an empty or wholly unrelated registry', () => {
  assert.equal(referencedAssetFiles('sphere { 0, 1 }', new Map()), undefined);
  assert.equal(
    referencedAssetFiles('sphere { 0, 1 } // "unused.png"', new Map([['unused.png', bytes(1)]])),
    undefined
  );
});

test('referencedAssetFiles selects exact literals and ignores commented strings', () => {
  const registry = new Map([
    ['used.png', bytes(1, 2)],
    ['unused.png', bytes(3, 4)],
  ]);
  const selected = referencedAssetFiles(
    [
      '/* nested /* "unused.png" */ still comment */',
      '// "unused.png"',
      'pigment { image_map { png "./used.png" } }',
    ].join('\n'),
    registry
  );
  assert.deepEqual(Object.keys(selected), ['used.png']);
  assert.strictEqual(selected['used.png'], registry.get('used.png'));
});

test('referencedAssetFiles follows dropped includes transitively and terminates cycles', () => {
  const registry = registryOf([
    ['root.inc', '#include "nested.inc"\n#declare P = pigment { image_map { png "tile.png" } };'],
    ['nested.inc', '#include "root.inc"\n#declare N = 1;'],
    ['tile.png', bytes(9, 8, 7)],
    ['other.png', bytes(6)],
  ]);
  const selected = referencedAssetFiles('#include "./root.inc"', registry);
  assert.deepEqual(Object.keys(selected), ['root.inc', 'nested.inc', 'tile.png']);
  assert.strictEqual(selected['tile.png'], registry.get('tile.png'));
});

test('a dynamic include conservatively stages the whole registry', () => {
  const registry = registryOf([
    ['a.inc', '#declare A = 1;'],
    ['b.inc', '#declare B = 1;'],
    ['texture.png', bytes(5)],
  ]);
  const selected = referencedAssetFiles('#declare F = "a.inc";\n#include F', registry);
  assert.deepEqual(selected, Object.fromEntries(registry));
});

test('a dynamic include discovered inside a selected include also stages everything', () => {
  const registry = registryOf([
    ['root.inc', '#include concat("child", ".inc")'],
    ['child.inc', '#declare Child = 1;'],
    ['unused.png', bytes(4)],
  ]);
  const selected = referencedAssetFiles('#include "root.inc"', registry);
  assert.deepEqual(selected, Object.fromEntries(registry));
});
