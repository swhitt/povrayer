// Unit tests for web/history.js: the pure scene-history primitives. Exhaustive
// over the dedup/cap, preview, and relative-time branches so the module hits 100%
// without a browser (the DOM glue in ui.js is browser-tested separately).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addSnapshot, snapshotPreview, relativeTime } from '../../web/history.js';

test('addSnapshot prepends newest-first', () => {
  const a = addSnapshot([], 'one', 1000, 20);
  const b = addSnapshot(a, 'two', 2000, 20);
  assert.deepEqual(
    b.map((s) => s.source),
    ['two', 'one']
  );
  assert.equal(b[0].t, 2000);
});

test('addSnapshot dedups against the newest entry, returning the same array', () => {
  const a = addSnapshot([], 'same', 1000, 20);
  const b = addSnapshot(a, 'same', 9999, 20);
  assert.equal(b, a, 'a consecutive duplicate returns the identical reference (no churn)');
  // A non-consecutive repeat is allowed (it is a real later version).
  const c = addSnapshot(addSnapshot(a, 'other', 2000, 20), 'same', 3000, 20);
  assert.deepEqual(
    c.map((s) => s.source),
    ['same', 'other', 'same']
  );
});

test('addSnapshot caps the list at max, dropping the oldest', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = addSnapshot(list, `v${i}`, i, 20);
  assert.equal(list.length, 20);
  assert.equal(list[0].source, 'v24'); // newest kept
  assert.equal(list.at(-1).source, 'v5'); // v0..v4 dropped
});

test('snapshotPreview uses the first non-blank line, comment marker stripped', () => {
  assert.equal(snapshotPreview('\n\n// Two dice scene\nsphere {}'), 'Two dice scene');
  assert.equal(snapshotPreview('  /* block intro */\nbox {}'), 'block intro */');
  assert.equal(snapshotPreview('#declare R = 12;\n'), '#declare R = 12;'); // # is a directive, not stripped
});

test('snapshotPreview truncates long lines and handles a blank scene', () => {
  const long = 'sphere { <0,0,0>, 1 pigment { rgb <1,2,3> } finish { phong 1 ambient 0.2 } }';
  const out = snapshotPreview(long);
  assert.equal(out.length, 48);
  assert.ok(out.endsWith('…'));
  assert.equal(snapshotPreview('   \n\t\n'), '(blank scene)');
});

test('relativeTime buckets seconds / minutes / hours / days', () => {
  const now = 10_000_000;
  assert.equal(relativeTime(now - 10_000, now), 'just now'); // 10s
  assert.equal(relativeTime(now - 120_000, now), '2m ago'); // 2min
  assert.equal(relativeTime(now - 7_200_000, now), '2h ago'); // 2h
  assert.equal(relativeTime(now - 2 * 86_400_000, now), '2d ago'); // 2d
  assert.equal(relativeTime(now + 5000, now), 'just now'); // clamps a future skew to 0
});
