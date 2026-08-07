// Guard against the config drift the master FILES array in tools/coverage/paths.mjs
// does NOT cover: .c8rc.json and tsconfig.checkjs.json keep their own hand-maintained
// copies of the first-party file set, consumed directly by c8 and tsc. A web module
// added to paths.mjs but forgotten in either config silently drops out of the
// coverage gate or the typecheck (no error), so assert every first-party web module
// is enrolled in both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

import { FIRST_PARTY, rel } from '../../tools/coverage/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webModules = FIRST_PARTY.map(rel).filter((p) => p.startsWith('web/') && p.endsWith('.js'));
const excludedWebModules = new Set(['web/coi-serviceworker.js']); // vendored, pinned MIT source
const discoveredWebModules = readdirSync(resolve(root, 'web'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => `web/${entry.name}`)
  .filter((path) => !excludedWebModules.has(path))
  .sort();

// .c8rc.json is plain JSON (a "//" doc key, not JS comments), so it parses; each
// web module must be measured Node-side (include) or deliberately not (exclude).
const c8 = JSON.parse(readFileSync(resolve(root, '.c8rc.json'), 'utf8'));
const c8Listed = new Set([...c8.include, ...c8.exclude]);

// Parse tsconfig's JSONC with TypeScript itself so comments stay legal while
// membership checks remain exact (a prose mention cannot satisfy the guard).
const tsconfigText = readFileSync(resolve(root, 'tsconfig.checkjs.json'), 'utf8');
const parsedTsconfig = ts.parseConfigFileTextToJson('tsconfig.checkjs.json', tsconfigText);
assert.equal(parsedTsconfig.error, undefined, 'tsconfig.checkjs.json should parse');
const tsIncluded = new Set(parsedTsconfig.config.include);

// tsconfig.strict.json is the FULL-strict tier: a hand-maintained subset of the
// modules above that graduate one at a time. It is a fourth hand-maintained copy
// of a first-party file list, so it gets the same drift guard as the others.
const strictText = readFileSync(resolve(root, 'tsconfig.strict.json'), 'utf8');
const parsedStrict = ts.parseConfigFileTextToJson('tsconfig.strict.json', strictText);
assert.equal(parsedStrict.error, undefined, 'tsconfig.strict.json should parse');
const strictIncluded = parsedStrict.config.include;

test('the first-party manifest covers every web module except explicit vendored code', () => {
  assert.deepEqual(
    [...webModules].sort(),
    discoveredWebModules,
    'tools/coverage/paths.mjs must classify every web/*.js module'
  );
});

test('every first-party web module is measured (in .c8rc include or exclude)', () => {
  assert.ok(webModules.length >= 10, 'sanity: the web first-party set should be non-trivial');
  for (const m of webModules) {
    assert.ok(c8Listed.has(m), `${m} is first-party but missing from .c8rc.json include/exclude`);
  }
});

test('every first-party web module is type-checked (in tsconfig.checkjs include)', () => {
  for (const m of webModules) {
    assert.ok(
      tsIncluded.has(m),
      `${m} is first-party but missing from tsconfig.checkjs.json include`
    );
  }
});

test('the strict tier is a real, sorted subset of the type-checked first-party set', () => {
  assert.ok(strictIncluded.length >= 10, 'sanity: the strict tier should be non-trivial');
  for (const m of strictIncluded) {
    assert.ok(
      tsIncluded.has(m),
      `${m} is in tsconfig.strict.json but not in tsconfig.checkjs.json include`
    );
    assert.ok(
      webModules.includes(m),
      `${m} is in tsconfig.strict.json but not first-party per tools/coverage/paths.mjs`
    );
  }
  // Kept alphabetical so graduating a file is a one-line, conflict-free diff.
  assert.deepEqual(strictIncluded, [...strictIncluded].sort(), 'keep the include list sorted');
});
