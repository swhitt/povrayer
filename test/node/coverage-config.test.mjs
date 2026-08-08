// Guard against the config drift the master FILES array in tools/coverage/paths.mjs
// does NOT cover: .c8rc.json and tsconfig.checkjs.json keep their own hand-maintained
// copies of the first-party file set, consumed directly by c8 and tsc. A web module
// added to paths.mjs but forgotten in either config silently drops out of the
// coverage gate or the typecheck (no error), so assert every first-party web module
// is enrolled in both.
//
// Everything here is deliberately EXTENSION-AGNOSTIC. web/ is mid-migration to
// TypeScript, and the cheapest way to fall out of every gate at once used to be a
// rename: a `.js`-keyed discovery walk simply stops seeing a module the day it
// becomes `.ts`, and nothing complains. So the walk matches both extensions, and
// the enrollment checks below distinguish the two only where the toolchain
// genuinely does (c8 measures the COMPILED artifact; tsc checks the source).
//
// It also owns the one hole in the 100% gate: see COVERAGE_EXEMPT below, which is
// an allowlist rather than a loophole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

import { FIRST_PARTY, rel, servedPath } from '../../tools/coverage/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// A web MODULE is any first-party executable source in web/, whichever language
// it is currently written in. `.d.ts` is not a module: it declares types and
// emits nothing, so there is no artifact to measure (web/index.d.ts is the shim
// that hands the browser code the built wrapper's types).
const isWebModule = (p) => p.startsWith('web/') && !p.endsWith('.d.ts') && /\.(js|ts)$/.test(p);

const webModules = FIRST_PARTY.map(rel).filter(isWebModule);
const excludedWebModules = new Set(['web/coi-serviceworker.js']); // vendored, pinned MIT source

// The ONE first-party web module held out of the 100% coverage gate, named here
// with its reason so the hole is an argued allowlist rather than a silent gap.
// This NARROWS the guard instead of relaxing it: an exempt module still has to be
// type-checked, still has to be excluded in .c8rc.json on purpose, and still must
// not appear in the gate's first-party manifest. A future web module therefore
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
  .filter((entry) => entry.isFile())
  .map((entry) => `web/${entry.name}`)
  .filter(isWebModule)
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
function readTsconfigInclude(name) {
  const parsed = ts.parseConfigFileTextToJson(name, readFileSync(resolve(root, name), 'utf8'));
  assert.equal(parsed.error, undefined, `${name} should parse`);
  return parsed.config.include;
}

const tsIncluded = new Set(readTsconfigInclude('tsconfig.checkjs.json'));

// tsconfig.strict.json is the FULL-strict tier: a hand-maintained subset of the
// modules above that graduate one at a time. It is a fourth hand-maintained copy
// of a first-party file list, so it gets the same drift guard as the others.
const strictIncluded = readTsconfigInclude('tsconfig.strict.json');
const strictSet = new Set(strictIncluded);

test('the first-party manifest covers every web module except explicit vendored code', () => {
  assert.deepEqual(
    [...webModules].sort(),
    discoveredWebModules,
    'tools/coverage/paths.mjs must classify every web module (.js or .ts)'
  );
});

test('every first-party web module is measured (in .c8rc include or exclude)', () => {
  assert.ok(webModules.length >= 10, 'sanity: the web first-party set should be non-trivial');
  for (const m of webModules) {
    // c8 filters V8 scripts by the path Node actually loaded, BEFORE applying the
    // source map, so a TypeScript module has to be enrolled under its compiled
    // _build/web name or it is never measured at all. The remapped report still
    // keys on the .ts source, which is what the 100% gate reads.
    const measured = servedPath(m);
    assert.ok(
      c8Listed.has(measured),
      `${m} is first-party but ${measured} is missing from .c8rc.json include/exclude`
    );
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

// The point of the migration. A module may be JavaScript or TypeScript; what it
// may NOT be is ungated. TypeScript files carry real annotations, so there is no
// excuse for them to sit at the relaxed checkJs tier: they go straight to full
// strict, and this is what makes "rename to .ts" mean "opt into strict" rather
// than "quietly turn 254 @param into any".
test('every web module is either TypeScript at full strict or JavaScript under checkJs', () => {
  for (const m of [...webModules, ...COVERAGE_EXEMPT.keys()]) {
    if (m.endsWith('.ts')) {
      assert.ok(
        strictSet.has(m),
        `${m} is TypeScript but not in tsconfig.strict.json include; converted modules go to the strict tier`
      );
    } else {
      assert.ok(
        !strictSet.has(m) || tsIncluded.has(m),
        `${m} is JavaScript and must be enrolled in tsconfig.checkjs.json include`
      );
    }
  }
});

// A compiled module that never got compiled is the one brand-new failure mode the
// build step introduces. tools/build-web.mjs re-verifies _build/web against the
// sources at every serve/assemble/test entry point so stale output cannot ship,
// and this asserts the result from the other end, independently of that logic:
// every .ts source has a fresher artifact sitting exactly where .c8rc.json,
// serve.mjs, and assemble-site.mjs all expect to find it.
test('every TypeScript web module has a fresh compiled artifact in _build/web', () => {
  const tsModules = discoveredWebModules.filter((m) => m.endsWith('.ts'));
  for (const m of tsModules) {
    const artifact = resolve(root, servedPath(m));
    assert.ok(existsSync(artifact), `${m} has no compiled artifact at ${rel(artifact)}`);
    assert.ok(
      statSync(artifact).mtimeMs >= statSync(resolve(root, m)).mtimeMs,
      `${rel(artifact)} is older than ${m}; run \`npm run build:web\``
    );
    // The inline source map is what re-keys coverage (and stack traces) back to
    // TypeScript. Without it the gate would start reporting on _build output and
    // every converted module would read as untested.
    assert.match(
      readFileSync(artifact, 'utf8'),
      /\/\/# sourceMappingURL=data:application\/json;base64,/,
      `${rel(artifact)} has no inline source map; tsconfig.build.json must keep inlineSourceMap`
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
    const measured = servedPath(path);
    assert.ok(
      c8Excluded.has(measured) && !c8Included.has(measured),
      `${path} is coverage-exempt but ${measured} is not excluded in .c8rc.json (the exemption has to be real)`
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
