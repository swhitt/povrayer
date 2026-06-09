// Unit tests for web/sdl-strip.js: the shared comment/string-stripping scanner.
// Exhaustive over the line/nested-block/string branches (terminated AND
// unterminated each), so the module hits 100% without a browser. The manifest
// parser and the REPL scaffold probe both rely on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripCommentsAndStrings as strip } from '../../web/sdl-strip.js';

test('blanks a line comment but keeps the newline and length', () => {
  const out = strip('a // secret\nb');
  assert.equal(out.length, 'a // secret\nb'.length);
  assert.ok(!out.includes('secret'));
  assert.ok(out.startsWith('a ') && out.endsWith('\nb'));
});

test('blanks a line comment that runs to EOF', () => {
  assert.equal(strip('a //x'), 'a    ');
});

test('blanks nested block comments and keeps interior newlines', () => {
  const out = strip('x /* a /* b */\nc */ y');
  assert.ok(!/[abc]/.test(out), 'all nested-comment content is blanked');
  assert.equal((out.match(/\n/g) || []).length, 1, 'the interior newline survives');
  assert.ok(out.startsWith('x ') && out.trimEnd().endsWith('y'));
});

test('runs an unterminated block comment to EOF', () => {
  assert.equal(strip('keep /* open forever').trimEnd(), 'keep');
});

test('blanks string content (with escapes) but keeps the quotes', () => {
  assert.equal(strip('a "b\\"c" d'), 'a "    " d');
});

test('ends an unterminated string at the line break', () => {
  const out = strip('"x\nback');
  assert.ok(out.includes('back') && !out.includes('x'));
});

test('runs an unterminated string to EOF', () => {
  assert.equal(strip('p "open').trimEnd(), 'p "');
});

test('leaves plain code untouched', () => {
  assert.equal(strip('sphere { 0, 1 }'), 'sphere { 0, 1 }');
});
