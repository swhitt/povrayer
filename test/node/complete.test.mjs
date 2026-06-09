// Unit tests for web/complete.js: the pure autocomplete logic (token extraction,
// ranking, buffer scanning, insertion). DOM-free, so it covers to 100% here; the
// popup wiring is covered separately in the browser suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenAt,
  rank,
  buildPool,
  directivePool,
  scanBufferSymbols,
  signatureText,
  complete,
  applyCompletion,
} from '../../web/complete.js';

test('tokenAt reads the identifier immediately left of the caret', () => {
  const text = 'pigment { rgb';
  assert.deepEqual(tokenAt(text, text.length), { start: 10, end: 13, word: 'rgb', hashed: false });
});

test('tokenAt returns an empty word when the caret is not on an identifier', () => {
  assert.deepEqual(tokenAt('a ', 2), { start: 2, end: 2, word: '', hashed: false });
});

test('tokenAt flags a directive position right after a #', () => {
  const t = tokenAt('#dec', 4);
  assert.equal(t.word, 'dec');
  assert.equal(t.hashed, true);
  assert.equal(t.start, 1);
});

test('tokenAt ignores a run that begins with a digit (a number, not a name)', () => {
  assert.deepEqual(tokenAt('3.14', 4), { start: 4, end: 4, word: '', hashed: false });
});

test('rank: prefix beats substring, exact-case beats case-folded', () => {
  const cands = [
    { name: 'Brass', kind: 'color' },
    { name: 'P_Brass1', kind: 'color' },
    { name: 'brassy', kind: 'color' },
    { name: 'Iron', kind: 'color' },
  ];
  const out = rank('Bra', cands).map((c) => c.name);
  assert.equal(out[0], 'Brass'); // case-sensitive prefix, shortest
  assert.equal(out[1], 'brassy'); // case-insensitive prefix
  assert.equal(out[2], 'P_Brass1'); // substring
  assert.ok(!out.includes('Iron')); // no match dropped
});

test('rank: shorter name then alphabetical breaks ties within a tier', () => {
  const cands = [
    { name: 'Tab', kind: 'k' },
    { name: 'Ta', kind: 'k' },
    { name: 'Tac', kind: 'k' },
  ];
  assert.deepEqual(
    rank('Ta', cands).map((c) => c.name),
    ['Ta', 'Tab', 'Tac']
  );
});

test('rank: an empty query matches everything, capped by limit', () => {
  const cands = [
    { name: 'aaa', kind: 'k' },
    { name: 'bb', kind: 'k' },
    { name: 'c', kind: 'k' },
  ];
  assert.deepEqual(
    rank('', cands, 2).map((c) => c.name),
    ['c', 'bb'] // shortest first
  );
});

test('buildPool merges keyword + builtin vocabulary with manifest symbols', () => {
  const pool = buildPool([{ name: 'T_Stone1', kind: 'texture', file: 'stones.inc' }]);
  const names = new Set(pool.map((c) => c.name));
  assert.ok(names.has('sphere')); // a keyword
  assert.ok(names.has('vrotate')); // a builtin
  assert.ok(names.has('T_Stone1')); // the manifest symbol
  assert.ok(pool.some((c) => c.name === 'sphere' && c.kind === 'keyword'));
});

test('directivePool lists the preprocessor directives', () => {
  assert.ok(directivePool().some((c) => c.name === 'declare' && c.kind === 'directive'));
});

test('scanBufferSymbols finds declare/local/macro names and excludes the typed one', () => {
  const text = '#declare Radius = 2;\n#local Helper = 3;\n#macro Ring(R, H)\n#end\n#declare Rad';
  const found = scanBufferSymbols(text, 'Rad');
  const m = Object.fromEntries(found.map((s) => [s.name, s]));
  assert.equal(m.Radius.kind, 'scene');
  assert.equal(m.Helper.kind, 'scene');
  assert.deepEqual(m.Ring.params, ['R', 'H']);
  assert.equal(m.Ring.kind, 'macro');
});

test('scanBufferSymbols dedupes repeated definitions', () => {
  const found = scanBufferSymbols('#declare A = 1;\n#declare A = 2;', '');
  assert.equal(found.filter((s) => s.name === 'A').length, 1);
});

test('signatureText renders macro params, empty for non-macros', () => {
  assert.equal(signatureText({ name: 'F', kind: 'macro', params: ['A', 'B'] }), '(A, B)');
  assert.equal(signatureText({ name: 'F', kind: 'macro', params: [] }), '()');
  assert.equal(signatureText({ name: 'sphere', kind: 'keyword' }), '');
});

test('complete offers ranked matches for the token under the caret', () => {
  const pool = buildPool([{ name: 'T_Stone1', kind: 'texture', file: 'stones.inc' }]);
  const text = 'texture { T_Sto';
  const res = complete(text, text.length, pool);
  assert.ok(res);
  assert.equal(res.query, 'T_Sto');
  assert.deepEqual({ from: res.from, to: res.to }, { from: 10, to: 15 });
  assert.equal(res.items[0].name, 'T_Stone1');
});

test('complete switches to directive candidates after a #', () => {
  const res = complete('#dec', 4, buildPool());
  assert.ok(res.items.some((c) => c.name === 'declare' && c.kind === 'directive'));
});

test('complete merges the scene buffer symbols', () => {
  const text = '#declare MyShinyThing = finish { phong 1 }\nobject { MyShi';
  const res = complete(text, text.length, buildPool());
  assert.equal(res.items[0].name, 'MyShinyThing');
});

test('complete returns null below the minimum length and when nothing matches', () => {
  assert.equal(complete('s', 1, buildPool(), { minLength: 2 }), null);
  assert.equal(complete('zzqqxx', 6, buildPool()), null);
});

test('complete with minLength 0 browses on an empty token', () => {
  const res = complete('', 0, buildPool(), { minLength: 0, limit: 5 });
  assert.ok(res);
  assert.equal(res.items.length, 5);
});

test('applyCompletion inserts a bare name with the caret after it', () => {
  const text = 'object { T_Sto }';
  const out = applyCompletion(text, { from: 9, to: 14 }, { name: 'T_Stone1', kind: 'texture' });
  assert.equal(out.text, 'object { T_Stone1 }');
  assert.equal(out.caret, 9 + 'T_Stone1'.length);
});

test('applyCompletion puts the caret inside the parens of a macro that takes args', () => {
  const out = applyCompletion(
    'x Ring',
    { from: 2, to: 6 },
    {
      name: 'Ring',
      kind: 'macro',
      params: ['R', 'H'],
    }
  );
  assert.equal(out.text, 'x Ring()');
  assert.equal(out.caret, 2 + 'Ring('.length); // between ( and )
});

test('applyCompletion puts the caret after the parens of a no-arg macro', () => {
  const out = applyCompletion(
    'x No',
    { from: 2, to: 4 },
    { name: 'NoArgs', kind: 'macro', params: [] }
  );
  assert.equal(out.text, 'x NoArgs()');
  assert.equal(out.caret, out.text.length);
});

test('rank sinks __internal names below ordinary ones within a tier', () => {
  const cands = [
    { name: '__Fx', kind: 'function' },
    { name: 'Fade', kind: 'finish' },
  ];
  // Both are case-sensitive prefix matches for 'F'; the ordinary name wins.
  assert.deepEqual(
    rank('F', cands).map((c) => c.name),
    ['Fade', '__Fx']
  );
  // But when the query targets them, internals still complete.
  assert.equal(rank('__F', cands)[0].name, '__Fx');
});

test('complete shadows a library symbol with a scene definition of the same name', () => {
  const pool = buildPool([{ name: 'Brass', kind: 'color', file: 'metals.inc' }]);
  // Type a prefix (not the full name) so the scene's own Brass isn't excluded as
  // the in-progress token; it should then shadow the library color of the same name.
  const text = '#declare Brass = finish { metallic }\nobject { Bra';
  const res = complete(text, text.length, pool);
  const brass = res.items.filter((c) => c.name === 'Brass');
  assert.equal(brass.length, 1, 'Brass appears once, not twice');
  assert.equal(brass[0].kind, 'scene', 'the scene definition wins over the library color');
});

test('scanBufferSymbols recovers whitespace-separated macro params', () => {
  // A stdlib-style header that forgot a comma still resolves to two names.
  const found = scanBufferSymbols('#macro Foo(A_\n   B_)\n', '');
  assert.deepEqual(found[0].params, ['A_', 'B_']);
});
