// Unit tests for web/stats.js: the pure label/value row builder behind the stats
// chip readout. Exhaustive (every optional row + every compact() branch) so the
// module hits 100% without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStats } from '../../web/stats.js';

const meta = { width: 512, height: 384, elapsedMs: 920 };

/** @param {{label: string, value: string}[]} rows */
const byLabel = (rows) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

test('a full stats object emits every row in order', () => {
  const rows = formatStats(
    { parseSeconds: 0.011, traceSeconds: 0.04, rays: 554341, threads: 15, warnings: 0 },
    meta
  );
  assert.deepEqual(
    rows.map((r) => r.label),
    ['resolution', 'pixels', 'total', 'parse', 'trace', 'rays', 'rays/s', 'threads']
  );
  const m = byLabel(rows);
  assert.equal(m.resolution, '512 × 384');
  assert.equal(m.pixels, '196,608');
  assert.equal(m.total, '0.92s');
  assert.equal(m.parse, '0.01s');
  assert.equal(m.trace, '0.04s');
  assert.equal(m.rays, '554,341');
  assert.equal(m.threads, '15');
});

test('the always-on rows survive an empty stats object', () => {
  const rows = formatStats({}, meta);
  assert.deepEqual(
    rows.map((r) => r.label),
    ['resolution', 'pixels', 'total']
  );
});

test('rays without a trace time drops the rays/s row but keeps rays', () => {
  const rows = formatStats({ rays: 1000 }, meta);
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes('rays'));
  assert.ok(!labels.includes('rays/s'));
});

test('a zero trace time never divides (no rays/s, no Infinity)', () => {
  const rows = formatStats({ rays: 1000, traceSeconds: 0 }, meta);
  assert.ok(!rows.some((r) => r.label === 'rays/s'));
  assert.ok(rows.some((r) => r.label === 'trace' && r.value === '0.00s'));
});

test('warnings show only when > 0', () => {
  assert.ok(!formatStats({ warnings: 0 }, meta).some((r) => r.label === 'warnings'));
  const m = byLabel(formatStats({ warnings: 3 }, meta));
  assert.equal(m.warnings, '3');
});

test('rays/s uses compact magnitude suffixes', () => {
  // >= 1e6 -> M, [1e3, 1e6) -> k, < 1e3 -> bare integer.
  assert.equal(
    byLabel(formatStats({ rays: 14_000_000, traceSeconds: 1 }, meta))['rays/s'],
    '14.0M'
  );
  assert.equal(byLabel(formatStats({ rays: 14_000, traceSeconds: 1 }, meta))['rays/s'], '14.0k');
  assert.equal(byLabel(formatStats({ rays: 500, traceSeconds: 1 }, meta))['rays/s'], '500');
});
