// Unit tests for web/context.js: block-context detection (the brace-stack walk)
// and the relevance predicate that powers context-aware completion. Exhaustive
// over the comment/string/brace branches and each relevance shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blockContextAt, relevanceFor, CONTEXT_KEYWORDS } from '../../web/context.js';
import { KEYWORDS, BUILTINS } from '../../web/highlight.js';

test('blockContextAt returns empty at the top level', () => {
  assert.equal(blockContextAt('sphere { 0,1 } ', 15), '');
});

test('blockContextAt names the innermost enclosing block', () => {
  const text = 'texture { pigment { rgb 1 } finish { ref';
  assert.equal(blockContextAt(text, text.length), 'finish');
});

test('blockContextAt pops back to the outer block after a nested close', () => {
  const text = 'texture { pigment { rgb 1 } ';
  assert.equal(blockContextAt(text, text.length), 'texture');
});

test('blockContextAt ignores braces inside a line comment', () => {
  const text = 'finish { // a stray } brace\n  amb';
  assert.equal(blockContextAt(text, text.length), 'finish');
});

test('blockContextAt ignores braces inside a nested block comment', () => {
  const text = 'pigment { /* { /* inner */ } */ rgb';
  assert.equal(blockContextAt(text, text.length), 'pigment');
});

test('blockContextAt ignores braces inside a string (with escapes)', () => {
  const text = 'finish { "a \\" } { brace" amb';
  assert.equal(blockContextAt(text, text.length), 'finish');
});

test('blockContextAt ends an unterminated string at the line break', () => {
  // The bad quote closes at the newline, so the pigment block still counts.
  const text = 'finish {\n"oops\npigment { rgb';
  assert.equal(blockContextAt(text, text.length), 'pigment');
});

test('blockContextAt tolerates an unbalanced closing brace', () => {
  const text = 'x } finish { amb';
  assert.equal(blockContextAt(text, text.length), 'finish');
});

test('blockContextAt only scans up to the caret', () => {
  const text = 'finish { } camera { ';
  // Caret right after the finish block closes: back at top level.
  assert.equal(blockContextAt(text, 10), '');
});

test('relevanceFor is null for top level and object blocks', () => {
  assert.equal(relevanceFor(''), null);
  assert.equal(relevanceFor('sphere'), null);
});

test('relevanceFor(finish) boosts finish keywords, finishes, and scene names', () => {
  const rel = relevanceFor('finish');
  assert.equal(rel({ name: 'reflection', kind: 'keyword' }), true); // a finish keyword
  assert.equal(rel({ name: 'F_Glass1', kind: 'finish' }), true); // a finish-kind symbol
  assert.equal(rel({ name: 'MyThing', kind: 'scene' }), true); // the user's own name
  assert.equal(rel({ name: 'sphere', kind: 'keyword' }), false); // unrelated keyword
  assert.equal(rel({ name: 'T_Stone1', kind: 'texture' }), false); // wrong kind here
});

test('relevanceFor(camera) has keywords but no relevant kinds', () => {
  const rel = relevanceFor('camera');
  assert.equal(rel({ name: 'location', kind: 'keyword' }), true);
  assert.equal(rel({ name: 'T_Stone1', kind: 'texture' }), false); // no kind set for camera
});

test('relevanceFor(material) boosts both its keywords and material kinds', () => {
  const rel = relevanceFor('material');
  assert.equal(rel({ name: 'T_Stone1', kind: 'texture' }), true); // texture is a material kind
  assert.equal(rel({ name: 'interior_texture', kind: 'keyword' }), true); // a material keyword
  assert.equal(rel({ name: 'sphere', kind: 'keyword' }), false); // unrelated keyword
});

test('every CONTEXT_KEYWORDS entry is real SDL vocabulary (drift guard)', () => {
  // The curated sets must stay a subset of the highlighter's vocabulary, or a
  // typo'd/removed keyword silently stops boosting. This caught a dead 'pattern'.
  const vocab = new Set([...KEYWORDS, ...BUILTINS]);
  for (const [block, set] of Object.entries(CONTEXT_KEYWORDS)) {
    for (const kw of set) {
      assert.ok(vocab.has(kw), `${block}: "${kw}" is not in KEYWORDS/BUILTINS`);
    }
  }
});
