// Unit tests for web/settings.js: the control-field schema and the three coercion
// rules (untrusted saved blob, pre-parsed URL params, decoded permalink). Pure, so
// exhaustive over every kind x value branch hits 100% without a browser. The five
// ui.js call sites share this, so a drift here would silently change persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_FIELDS, coerceSaved, coerceParam, coerceHydrate } from '../../web/settings.js';

const byKey = Object.fromEntries(CONTROL_FIELDS.map((f) => [f.key, f]));
const yes = () => true;
const no = () => false;

test('schema covers exactly the eight persisted controls, once each', () => {
  assert.deepEqual(
    CONTROL_FIELDS.map((f) => f.key),
    ['width', 'height', 'quality', 'antialias', 'threads', 'flags', 'frames', 'fps']
  );
});

test('coerceSaved: ints keep only a whole number inside [min,max]', () => {
  assert.equal(coerceSaved(byKey.frames, '24', yes), '24');
  assert.equal(coerceSaved(byKey.frames, 24, yes), '24'); // number coerces via parseInt
  assert.equal(coerceSaved(byKey.frames, '0', yes), null); // below min (1)
  assert.equal(coerceSaved(byKey.frames, '999', yes), null); // above max (240)
  assert.equal(coerceSaved(byKey.fps, 'abc', yes), null); // NaN
  assert.equal(coerceSaved(byKey.fps, '60', yes), '60'); // upper bound inclusive
});

test('coerceSaved: non-string values are rejected for text/select', () => {
  assert.equal(coerceSaved(byKey.width, 512, yes), null); // a number is not a valid text value
  assert.equal(coerceSaved(byKey.quality, null, yes), null);
  assert.equal(coerceSaved(byKey.flags, undefined, yes), null);
});

test('coerceSaved: selects pass only when the option exists', () => {
  assert.equal(coerceSaved(byKey.quality, '5', yes), '5');
  assert.equal(coerceSaved(byKey.antialias, 'weird', no), null);
});

test('coerceSaved: allowEmpty governs whether "" is kept', () => {
  assert.equal(coerceSaved(byKey.threads, '', yes), ''); // auto: empty is meaningful
  assert.equal(coerceSaved(byKey.flags, '', yes), '');
  assert.equal(coerceSaved(byKey.width, '', yes), null); // empty width would break a render
  assert.equal(coerceSaved(byKey.width, '800', yes), '800');
});

test('coerceParam: absent params are skipped, present ones pass through', () => {
  assert.equal(coerceParam(byKey.width, undefined, yes), null);
  assert.equal(coerceParam(byKey.width, '1200', yes), '1200');
  assert.equal(coerceParam(byKey.frames, '48', yes), '48'); // already clamped upstream
});

test('coerceParam: selects still re-check membership', () => {
  assert.equal(coerceParam(byKey.quality, '7', yes), '7');
  assert.equal(coerceParam(byKey.quality, '7', no), null);
});

test('coerceHydrate: selects re-checked, flags defaults to "", rest verbatim', () => {
  assert.equal(coerceHydrate(byKey.quality, '3', yes), '3');
  assert.equal(coerceHydrate(byKey.quality, '3', no), null); // an old link's dropped option
  assert.equal(coerceHydrate(byKey.flags, '+A0.1', yes), '+A0.1');
  assert.equal(coerceHydrate(byKey.flags, undefined, yes), ''); // link predates the flags field
  assert.equal(coerceHydrate(byKey.width, '640', yes), '640'); // trusted, taken as-is
  assert.equal(coerceHydrate(byKey.threads, '8', yes), '8');
});
