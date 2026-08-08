// Unit tests for web/sliders.js: the pure logic behind the auto-sliders and
// inline number scrubbing (declare parsing + literal spans + range/step
// heuristics + token hit-testing + value formatting). DOM-free, covers to 100%.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDeclaredNumbers,
  numberTokenAt,
  scrubStep,
  formatScrubbed,
} from '../../_build/web/sliders.js';

test('parseDeclaredNumbers finds a top-level declare and its literal span', () => {
  const text = '#declare Angle = 30;\nsphere { 0, 1 }';
  const [m] = parseDeclaredNumbers(text);
  assert.equal(m.name, 'Angle');
  assert.equal(m.value, 30);
  assert.equal(text.slice(m.start, m.end), '30');
  // Heuristic positive range: 0 .. 2*value.
  assert.deepEqual([m.min, m.max], [0, 60]);
});

test('parseDeclaredNumbers reads an explicit min..max annotation', () => {
  const [m] = parseDeclaredNumbers('#declare Spin = 45; // 0..90');
  assert.deepEqual([m.min, m.max], [0, 90]);
});

test('parseDeclaredNumbers reads an explicit min..max..step annotation', () => {
  const [m] = parseDeclaredNumbers('#declare N = 3; // 1..10..0.5');
  assert.deepEqual([m.min, m.max, m.step], [1, 10, 0.5]);
});

test('a degenerate annotated span falls back to a usable step', () => {
  const [m] = parseDeclaredNumbers('#declare Z = 5; // 5..5');
  assert.equal(m.step, 0.01);
});

test('parseDeclaredNumbers heuristics for negative and zero values', () => {
  const neg = parseDeclaredNumbers('#declare A = -1.5;')[0];
  assert.deepEqual([neg.min, neg.max], [-3, 0]);
  const zero = parseDeclaredNumbers('#declare B = 0;')[0];
  assert.deepEqual([zero.min, zero.max, zero.step], [0, 1, 0.01]);
});

test('parseDeclaredNumbers ignores a #declare inside a // comment, and non-matches', () => {
  const text = '// #declare Fake = 9\ncamera { angle 50 }\n#declare Real = 2;';
  assert.deepEqual(
    parseDeclaredNumbers(text).map((m) => m.name),
    ['Real']
  );
});

test('parseDeclaredNumbers returns multiple models with correct spans', () => {
  const text = '#declare A = 1;\n#declare B = 2.5;';
  const ms = parseDeclaredNumbers(text);
  assert.equal(ms.length, 2);
  assert.equal(text.slice(ms[1].start, ms[1].end), '2.5');
});

test('numberTokenAt locates the literal under an offset', () => {
  const text = 'translate <0, 12.5, 0>';
  const tok = numberTokenAt(text, 15); // inside 12.5
  assert.equal(tok.text, '12.5');
  assert.equal(tok.value, 12.5);
});

test('numberTokenAt returns null off a number, before and after the matches', () => {
  assert.equal(numberTokenAt('a 5', 0), null); // before the first number (break path)
  assert.equal(numberTokenAt('a 5 b', 4), null); // after all numbers (fallthrough path)
});

test('numberTokenAt keeps a sign but drops a subtraction minus', () => {
  // A sign (after a space or `<`) stays part of the number.
  assert.equal(numberTokenAt('x = -1.5', 6).text, '-1.5');
  assert.equal(numberTokenAt('<-1, 2>', 2).text, '-1');
  // A minus after a value is subtraction: the token is just the number.
  const sub = numberTokenAt('a-1.5', 3);
  assert.equal(sub.text, '1.5');
  assert.equal(sub.start, 2);
});

test('numberTokenAt does not mis-hit the second number of a `..` range', () => {
  // The `.90` inside `0..90` must not be returned as a scrub target.
  assert.equal(numberTokenAt('// 0..90', 6), null);
});

test('parseDeclaredNumbers handles CRLF line endings', () => {
  const text = '#declare A = 5;\r\nsphere { 0, 1 }';
  const [m] = parseDeclaredNumbers(text);
  assert.equal(m.name, 'A');
  assert.equal(text.slice(m.start, m.end), '5'); // span still anchored despite the \r
});

test('scrubStep is magnitude-aware', () => {
  assert.equal(scrubStep(0), 0.01);
  assert.equal(scrubStep(500), 10); // span 1000 -> 10^(3-2)
});

test('formatScrubbed honors the precision implied by the step', () => {
  assert.equal(formatScrubbed(2.345, 0.01), '2.35');
  assert.equal(formatScrubbed(30.4, 1), '30');
  assert.equal(formatScrubbed(0.5, 0.1), '0.5');
  assert.equal(formatScrubbed(1.23456789, 1e-9), '1.234568'); // capped at 6 decimals
});
