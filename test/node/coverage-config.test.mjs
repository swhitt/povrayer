// Guard against the config drift the master FILES array in tools/coverage/paths.mjs
// does NOT cover: .c8rc.json and tsconfig.checkjs.json keep their own hand-maintained
// copies of the first-party file set, consumed directly by c8 and tsc. A web module
// added to paths.mjs but forgotten in either config silently drops out of the
// coverage gate or the typecheck (no error), so assert every first-party web module
// is enrolled in both.
//
// It also owns the one hole in the 100% gate: see COVERAGE_EXEMPT below, which is
// an allowlist rather than a loophole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

import { FIRST_PARTY, rel } from '../../tools/coverage/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webModules = FIRST_PARTY.map(rel).filter((p) => p.startsWith('web/') && p.endsWith('.js'));
const excludedWebModules = new Set(['web/coi-serviceworker.js']); // vendored, pinned MIT source

// The ONE first-party web module held out of the 100% coverage gate, named here
// with its reason so the hole is an argued allowlist rather than a silent gap.
// This NARROWS the guard instead of relaxing it: an exempt module still has to be
// type-checked, still has to be excluded in .c8rc.json on purpose, and still must
// not appear in the gate's first-party manifest. A future web/*.js therefore
// cannot slip out of the gate without an entry (and a reason) landing right here.
const COVERAGE_EXEMPT = new Map([
  [
    'web/turbo-app.js',
    "povrayer turbo's app code, inlined into web/turbo.html by tools/gen-turbo.mjs. " +
      '~5.5k lines of WebGL2 raymarching and DOM wiring: linted, type-checked, and driven ' +
      'end to end by test/browser/turbo.test.mjs, but most of its uncovered arms are ' +
      'GPU-capability and device fallbacks no headless run takes, so 100% of four metrics ' +
      'would have to be bought with fake tests or a wall of c8-ignores.',
  ],
]);

const discoveredWebModules = readdirSync(resolve(root, 'web'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => `web/${entry.name}`)
  .filter((path) => !excludedWebModules.has(path) && !COVERAGE_EXEMPT.has(path))
  .sort();

// .c8rc.json is plain JSON (a "//" doc key, not JS comments), so it parses; each
// web module must be measured Node-side (include) or deliberately not (exclude).
const c8 = JSON.parse(readFileSync(resolve(root, '.c8rc.json'), 'utf8'));
const c8Included = new Set(c8.include);
const c8Excluded = new Set(c8.exclude);
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

test('every coverage exemption is a real file, argued, and still statically checked', () => {
  assert.ok(COVERAGE_EXEMPT.size >= 1, 'sanity: the allowlist should describe itself');
  for (const [path, reason] of COVERAGE_EXEMPT) {
    assert.ok(existsSync(resolve(root, path)), `${path} is exempted but does not exist`);
    assert.ok(reason.length > 80, `${path} needs a written reason, not a shrug`);
    // Exempt from COVERAGE only. Everything else the gate implies still applies.
    assert.ok(
      tsIncluded.has(path),
      `${path} is coverage-exempt, so it MUST at least be in tsconfig.checkjs.json include`
    );
    assert.ok(
      c8Excluded.has(path) && !c8Included.has(path),
      `${path} is coverage-exempt but not excluded in .c8rc.json (the exemption has to be real)`
    );
    assert.ok(
      !webModules.includes(path),
      `${path} is coverage-exempt but listed in tools/coverage/paths.mjs FIRST_PARTY, which would make the 100% gate demand it`
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
