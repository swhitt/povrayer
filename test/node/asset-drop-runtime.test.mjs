import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missingImageReferences, referencedAssetFiles } from '../../web/asset-drop.js';

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

test('missingImageReferences names the dropped images a reload lost', () => {
  // The boot advisory. An EMPTY registry is the whole point (it is the state
  // after a reload), which is exactly where referencedAssetFiles early-returns,
  // and this wants the complement rather than the intersection.
  const source = [
    '#declare P = pigment { image_map { png "tile.png" } }',
    'plane { y, 0 pigment { image_map { jpeg "./ground.jpg" } } }',
    'sphere { 0, 1 pigment { image_map { png "tile.png" } } } // the same file twice',
  ].join('\n');
  assert.deepEqual(
    missingImageReferences(source, new Map()),
    ['tile.png', 'ground.jpg'],
    'first-reference order, deduped, with the ./ prefix normalized away'
  );
  assert.deepEqual(
    missingImageReferences(source, new Map([['tile.png', bytes(1)]])),
    ['ground.jpg'],
    'a staged image drops off the list'
  );
  assert.deepEqual(
    missingImageReferences(
      source,
      new Map([
        ['ground.jpg', bytes(1)],
        ['tile.png', bytes(2)],
      ])
    ),
    [],
    'nothing is missing once every reference is staged'
  );
});

test('missingImageReferences reads escaped quotes and a truncated include', () => {
  // Scanner edges reachable from real scene text: POV-Ray lets a filename escape
  // a quote, so the literal must not end early (`we"ird.png` is ONE name), and a
  // `#include` with nothing after it runs the directive scan off the end of the
  // buffer, which must not throw or invent a reference.
  assert.deepEqual(
    missingImageReferences('pigment { image_map { png "we\\"ird.png" } }', new Map()),
    ['we"ird.png']
  );
  assert.deepEqual(missingImageReferences('#include ', new Map()), []);
});

test('missingImageReferences ignores non-image references and commented ones', () => {
  // A blanket "referenced but not staged" scan would flag colors.inc on 27
  // shipped scenes, which resolve from the wasm build's own include path; only a
  // missing IMAGE is unrecoverable, so only images are reported.
  const source = [
    '#include "colors.inc"',
    '#include "woods.inc"',
    '#include "mystuff.inc"',
    '// "commented.png"',
    '/* "blocked.png" */',
    '#declare Label = "not a filename";',
    'text { ttf "timrom.ttf" "hi" 0.5, 0 }',
  ].join('\n');
  assert.deepEqual(missingImageReferences(source, new Map()), []);
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
