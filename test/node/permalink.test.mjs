// Pure-data coverage for web/permalink.js. The codec also runs in the browser
// (web/ui.js builds + restores shareable links), but those runs depend on
// Playwright; this Node test pins permalink.js to 100% on its own. The shape
// guard's flat `&&` chain and the `mode` disjunction need each operand seen
// both true and false, hence the missing-field and bad-mode cases below.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeState, decodeState } from '../../web/permalink.js';

/** @returns {import('../../web/permalink.js').PermalinkState} */
const fullState = () => ({
  // Newlines + non-ASCII exercise the UTF-8 encode/decode path.
  source: '#version 3.8;\n// cafe ☕\nbox{}',
  width: '640',
  height: '480',
  quality: '3',
  antialias: '0.3',
  threads: '4',
  mode: 'animate',
  frames: '48',
  fps: '30',
});

test('round-trip preserves a full state (UTF-8 source included)', async () => {
  const s = fullState();
  const p = await encodeState(s);
  assert.deepEqual(await decodeState(p), s);
});

test('payload is base64url-safe (no padding, no + or /)', async () => {
  const p = await encodeState(fullState());
  assert.match(p, /^[A-Za-z0-9_-]*$/);
  assert.ok(!p.includes('='), 'no padding');
});

test("round-trips the other mode ('still')", async () => {
  const s = { ...fullState(), mode: /** @type {'still'} */ ('still') };
  const p = await encodeState(s);
  assert.deepEqual(await decodeState(p), s);
});

test('garbage returns null, never throws', async () => {
  // Out-of-alphabet chars -> atob throws -> null.
  assert.equal(await decodeState('not valid base64 @@@@'), null);
  // Empty -> decompresses to empty -> JSON.parse('') throws -> null.
  assert.equal(await decodeState(''), null);
  // 'ABC' is valid base64 but not gzip -> DecompressionStream throws -> null.
  assert.equal(await decodeState('QUJD'), null);
});

test('valid gzip + valid JSON but wrong shape returns null', async () => {
  // Only `source` present: the shape guard's first-true-then-false arms fire.
  const bad = await encodeState(/** @type {any} */ ({ source: 'x' }));
  assert.equal(await decodeState(bad), null);
});

test('all strings present but an invalid mode returns null', async () => {
  const bad = await encodeState(/** @type {any} */ ({ ...fullState(), mode: 'bogus' }));
  assert.equal(await decodeState(bad), null);
});

test('a non-object JSON payload (null / primitive) returns null', async () => {
  // null decodes back to null -> the `!o` guard arm.
  assert.equal(await decodeState(await encodeState(/** @type {any} */ (null))), null);
  // A bare number is valid JSON but not an object -> the typeof guard arm.
  assert.equal(await decodeState(await encodeState(/** @type {any} */ (5))), null);
});

test('a large scene round-trips and the payload is far smaller than the source', async () => {
  const source = 'sphere{<0,0,0>,1 pigment{rgb<1,1,1>}}\n'.repeat(2000);
  const s = { ...fullState(), source };
  const p = await encodeState(s);
  const decoded = await decodeState(p);
  assert.ok(decoded);
  assert.equal(decoded.source, source);
  assert.ok(p.length < source.length, 'gzip must shrink the repetitive scene');
});
