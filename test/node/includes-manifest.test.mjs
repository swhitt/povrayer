// Unit tests for the include-manifest parser (tools/includes-manifest/parse.mjs):
// the build-time extractor that turns the shipped .inc files into the
// autocomplete's symbol list. Exhaustive over every kind branch and the
// dedup/filter rules so the extraction stays trustworthy as include pins change.
// (The shared comment/string stripper it relies on is tested in sdl-strip.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyKind, parseManifest } from '../../tools/includes-manifest/parse.mjs';

test('classifyKind maps each RHS lead keyword to its kind', () => {
  assert.equal(classifyKind('rgb'), 'color');
  assert.equal(classifyKind('colour'), 'color');
  assert.equal(classifyKind('srgbft'), 'color');
  assert.equal(classifyKind('function'), 'function');
  assert.equal(classifyKind('cubic_spline'), 'spline');
  assert.equal(classifyKind('array'), 'array');
  assert.equal(classifyKind('interior_texture'), 'texture');
  assert.equal(classifyKind('finish'), 'finish');
  assert.equal(classifyKind('pigment'), 'pigment');
  assert.equal(classifyKind('box'), 'object');
  assert.equal(classifyKind('transform'), 'transform');
  assert.equal(classifyKind('matrix'), 'transform');
  assert.equal(classifyKind('version'), 'version');
  assert.equal(classifyKind('SomeUserColor'), 'value');
});

test('parseManifest captures each declaration kind from its RHS lead', () => {
  const text = [
    '#declare My_Tex = texture { pigment { rgb 1 } }',
    '#declare My_Col = rgb <1,0,0>;',
    '#declare My_Vec = <1,2,3>;',
    '#declare My_Num = 1.5;',
    '#declare My_Neg = -3;',
    '#declare My_Dot = .5;',
    '#declare My_Expr = (1+2);',
  ].join('\n');
  const m = Object.fromEntries(
    parseManifest([{ name: 'a.inc', text }]).map((s) => [s.name, s.kind])
  );
  assert.equal(m.My_Tex, 'texture');
  assert.equal(m.My_Col, 'color');
  assert.equal(m.My_Vec, 'vector');
  assert.equal(m.My_Num, 'float');
  assert.equal(m.My_Neg, 'float');
  assert.equal(m.My_Dot, 'float');
  assert.equal(m.My_Expr, 'value'); // RHS lead is '(', no captured keyword
});

test('parseManifest handles a multi-line declaration body', () => {
  const text = '#declare T_Grnt0 =\n  texture {\n    pigment { rgb 1 }\n  }\n';
  const [sym] = parseManifest([{ name: 'stones.inc', text }]);
  assert.deepEqual(sym, { name: 'T_Grnt0', kind: 'texture', file: 'stones.inc' });
});

test('parseManifest filters internal *_Inc_Temp and = version bookkeeping', () => {
  const text = [
    '#declare Stones_Inc_Temp = version;',
    '#declare Real_Thing = finish { phong 1 }',
    '#macro Helper_Inc_Temp(A) #end',
  ].join('\n');
  const names = parseManifest([{ name: 'x.inc', text }]).map((s) => s.name);
  assert.deepEqual(names, ['Real_Thing']);
});

test('parseManifest captures macros with and without parameters', () => {
  const text = '#macro Shear_Trans(A, B, C)\n#end\n#macro NoArgs()\n#end\n';
  const m = Object.fromEntries(parseManifest([{ name: 'm.inc', text }]).map((s) => [s.name, s]));
  assert.deepEqual(m.Shear_Trans.params, ['A', 'B', 'C']);
  assert.equal(m.Shear_Trans.kind, 'macro');
  assert.deepEqual(m.NoArgs.params, []);
});

test('parseManifest recovers params the stdlib forgot to comma-separate', () => {
  // shapes3.inc hides a comma inside a comment, leaving two params on adjacent
  // lines with no separator; splitting on whitespace too recovers both.
  const text = '#macro Bad(A, B // ( >0 ), note\n C)\n#end\n';
  const [sym] = parseManifest([{ name: 'shapes3.inc', text }]);
  assert.deepEqual(sym.params, ['A', 'B', 'C']);
});

test('parseManifest ignores #local (file-private, not exported)', () => {
  const text = '#local Hidden = 1;\n#declare Shown = 2;\n';
  assert.deepEqual(
    parseManifest([{ name: 'x.inc', text }]).map((s) => s.name),
    ['Shown']
  );
});

test('parseManifest dedupes first-wins in file-name order and sorts output', () => {
  const files = [
    { name: 'b.inc', text: '#declare Dup = finish { phong 1 }\n#declare Zeta = rgb 1;' },
    {
      name: 'a.inc',
      text: '#declare Dup = texture { pigment { rgb 1 } }\n#declare Alpha = rgb 1;',
    },
  ];
  const syms = parseManifest(files);
  // Output sorted by name.
  assert.deepEqual(
    syms.map((s) => s.name),
    ['Alpha', 'Dup', 'Zeta']
  );
  // a.inc sorts before b.inc, so its texture definition of Dup wins.
  const dup = syms.find((s) => s.name === 'Dup');
  assert.equal(dup.kind, 'texture');
  assert.equal(dup.file, 'a.inc');
});
