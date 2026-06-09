// Unit tests for web/assets.js: the pure drag-drop helpers (classification,
// image-map type, identifier derivation, name uniquing, snippet building).
// DOM-free, so it covers to 100% here; the drop events + FS injection are
// browser-tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAsset,
  imageType,
  identForFile,
  safeName,
  uniqueName,
  assetSnippet,
} from '../../web/assets.js';

test('classifyAsset routes by extension', () => {
  assert.equal(classifyAsset('logo.png'), 'image');
  assert.equal(classifyAsset('photo.JPG'), 'image'); // case-insensitive
  assert.equal(classifyAsset('shapes.inc'), 'include');
  assert.equal(classifyAsset('scene.pov'), 'scene');
  assert.equal(classifyAsset('notes.txt'), 'unknown');
  assert.equal(classifyAsset('README'), 'unknown'); // no extension
});

test('imageType maps supported rasters and rejects the rest', () => {
  assert.equal(imageType('a.png'), 'png');
  assert.equal(imageType('a.jpg'), 'jpeg');
  assert.equal(imageType('a.jpeg'), 'jpeg');
  assert.equal(imageType('a.gif'), 'gif');
  assert.equal(imageType('a.tga'), 'tga');
  assert.equal(imageType('a.bmp'), null); // not built into this wasm
  assert.equal(imageType('a.tiff'), null); // built --without-libtiff
});

test('identForFile builds a valid, readable SDL identifier', () => {
  assert.equal(identForFile('my image.png'), 'P_my_image');
  assert.equal(identForFile('a.b.tga'), 'P_a_b');
  assert.equal(identForFile('noext'), 'P_noext');
  assert.equal(identForFile('___.png'), 'P_asset'); // cleans to empty -> fallback
  assert.equal(identForFile('.png'), 'P_png'); // leading dot is part of the name
});

test('uniqueName returns a free name and disambiguates collisions', () => {
  const taken = new Set(['foo.png', 'foo-2.png']);
  assert.equal(uniqueName('bar.png', taken), 'bar.png'); // free
  assert.equal(uniqueName('foo.png', taken), 'foo-3.png'); // -2 also taken -> -3
  assert.equal(uniqueName('foo', new Set(['foo'])), 'foo-2'); // no extension
});

test('safeName strips directories and SDL-breaking characters', () => {
  assert.equal(safeName('photo.png'), 'photo.png'); // already safe
  assert.equal(safeName('sub/dir/photo.png'), 'photo.png'); // POSIX directory
  assert.equal(safeName('a\\b\\photo.png'), 'photo.png'); // Windows directory
  assert.equal(safeName('a"}}\nsphere{}.png'), 'a_}}_sphere{}.png'); // quote + newline -> _ (braces are harmless in the string)
  assert.equal(safeName('   '), 'asset'); // empties to the fallback
});

test('a sanitized name keeps the snippet a single, well-formed declare', () => {
  // The injection-y original would have escaped the string/comment; safeName
  // neutralizes it before it ever reaches assetSnippet.
  const snip = assetSnippet(safeName('a"x\n.png'), 'image');
  assert.equal((snip.match(/\n/g) || []).length, 2); // exactly the two intended lines
  assert.ok(!snip.includes('"a"'), 'no stray inner quote survives');
});

test('assetSnippet builds an image pigment declare with a usage hint', () => {
  const snip = assetSnippet('wood.png', 'image');
  assert.match(snip, /#declare P_wood = pigment \{ image_map \{ png "wood.png" \} \}/);
  assert.match(snip, /use as: texture \{ pigment \{ P_wood \} \}/);
});

test('assetSnippet emits an #include for includes and nothing for scenes', () => {
  assert.equal(assetSnippet('shapes.inc', 'include'), '#include "shapes.inc"\n');
  assert.equal(assetSnippet('scene.pov', 'scene'), '');
  assert.equal(assetSnippet('x', 'unknown'), '');
});
