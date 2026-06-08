// Pure-data coverage for web/examples.js. The module is also exercised in the
// browser (the REPL and UI import it), but those runs depend on Playwright; this
// node test pins examples.js to 100% on its own so the gate never hinges on a
// browser driver happening to touch every branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EXAMPLES, getExample } from '../../web/examples.js';

test('EXAMPLES is a non-empty array of well-formed scenes', () => {
  assert.ok(Array.isArray(EXAMPLES), 'EXAMPLES must be an array');
  assert.ok(EXAMPLES.length > 0, 'EXAMPLES must not be empty');

  for (const ex of EXAMPLES) {
    assert.equal(typeof ex.name, 'string', 'name must be a string');
    assert.ok(ex.name.length > 0, `name must be non-empty (${JSON.stringify(ex)})`);
    assert.equal(typeof ex.title, 'string', `title must be a string (${ex.name})`);
    assert.ok(ex.title.length > 0, `title must be non-empty (${ex.name})`);
    assert.equal(typeof ex.source, 'string', `source must be a string (${ex.name})`);
    assert.ok(ex.source.length > 0, `source must be non-empty (${ex.name})`);
    // Every scene declares the SDL version it was authored against.
    assert.match(ex.source, /#version 3\.8;/, `source missing #version (${ex.name})`);
  }
});

test('scene names are unique', () => {
  const names = EXAMPLES.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'duplicate scene name(s)');
});

test('csg-die leads (the UI default first impression)', () => {
  assert.equal(EXAMPLES[0].name, 'csg-die');
});

test('getExample returns the matching source for every known name', () => {
  for (const ex of EXAMPLES) {
    assert.equal(getExample(ex.name), ex.source, `getExample('${ex.name}') mismatch`);
  }
});

test('getExample returns undefined for an unknown name (?.source short-circuit)', () => {
  assert.equal(getExample('does-not-exist'), undefined);
  // Non-string inputs miss the strict === match too, exercising the same branch.
  assert.equal(getExample(undefined), undefined);
  assert.equal(getExample(''), undefined);
});
