// Unit tests for web/repl-scene.ts: the pure REPL scene assembler. These keep
// scaffold injection and assembled-line mapping covered without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VERSION_LINE, assembleReplScene } from '../../_build/web/repl-scene.js';

test('assembleReplScene always starts with the version line and default scaffold', () => {
  const out = assembleReplScene([{ source: 'sphere { <0,0,0>, 1 }' }]);

  assert.equal(out.source.split('\n')[0], VERSION_LINE);
  assert.ok(out.source.includes('global_settings { assumed_gamma 1.0 }'));
  assert.ok(out.source.includes('camera { location <0, 2, -5> look_at <0, 0.5, 0> }'));
  assert.ok(out.source.includes('light_source { <5, 10, -5> color rgb 1 }'));
  assert.ok(out.source.includes('background { color rgb <0.15, 0.15, 0.18> }'));
  assert.ok(out.source.endsWith('\n\nsphere { <0,0,0>, 1 }'));
});

test('scaffold probes ignore comments and strings', () => {
  const out = assembleReplScene([
    {
      source: [
        '// camera later',
        '#declare Label = "light_source background global_settings";',
        '/* nested camera /* background */ light_source */',
        'sphere { <0,0,0>, 1 }',
      ].join('\n'),
    },
  ]);

  assert.ok(out.source.includes('global_settings { assumed_gamma 1.0 }'));
  assert.ok(out.source.includes('camera { location <0, 2, -5> look_at <0, 0.5, 0> }'));
  assert.ok(out.source.includes('light_source { <5, 10, -5> color rgb 1 }'));
  assert.ok(out.source.includes('background { color rgb <0.15, 0.15, 0.18> }'));
});

test('scaffold injection omits user-supplied scene elements', () => {
  const out = assembleReplScene([
    {
      source: [
        'global_settings { assumed_gamma 1.0 }',
        'camera { location <0,0,-4> look_at 0 }',
        'light_source { <0,5,-5> color rgb 1 }',
        'background { color rgb 0 }',
      ].join('\n'),
    },
  ]);

  assert.equal(out.source.match(/\bglobal_settings\b/g)?.length, 1);
  assert.equal(out.source.match(/\bcamera\b/g)?.length, 1);
  assert.equal(out.source.match(/\blight_source\b/g)?.length, 1);
  assert.equal(out.source.match(/\bbackground\b/g)?.length, 1);
});

test('entry spans map assembled renderer lines back to entry coordinates', () => {
  const out = assembleReplScene([
    { source: 'sphere {\n  <0,0,0>, 1\n}' },
    { source: 'box {\n  -1, 1\n}' },
  ]);

  assert.deepEqual(out.spans, [
    { start: 7, end: 9 },
    { start: 10, end: 12 },
  ]);
  assert.deepEqual(out.mapLine(8), { entry: 1, line: 2 });
  assert.deepEqual(out.mapLine(10), { entry: 2, line: 1 });
  assert.equal(out.mapLine(1), null);
  assert.equal(out.mapLine(13), null);
});

test('line spans shift when user source suppresses scaffold', () => {
  const out = assembleReplScene([
    { source: 'camera { location <0,0,-4> look_at 0 }\nsphere { <0,0,0>, 1 }' },
  ]);

  assert.deepEqual(out.spans, [{ start: 6, end: 7 }]);
  assert.deepEqual(out.mapLine(7), { entry: 1, line: 2 });
});

test('empty scenes still assemble to renderer handoff source with no spans', () => {
  const out = assembleReplScene([]);

  assert.equal(out.source.split('\n')[0], VERSION_LINE);
  assert.deepEqual(out.spans, []);
  assert.equal(out.mapLine(7), null);
});
