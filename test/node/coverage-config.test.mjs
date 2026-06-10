// Guard against the config drift the master FILES array in tools/coverage/paths.mjs
// does NOT cover: .c8rc.json and tsconfig.checkjs.json keep their own hand-maintained
// copies of the first-party file set, consumed directly by c8 and tsc. A web module
// added to paths.mjs but forgotten in either config silently drops out of the
// coverage gate or the typecheck (no error), so assert every first-party web module
// is enrolled in both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { FIRST_PARTY, rel } from '../../tools/coverage/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webModules = FIRST_PARTY.map(rel).filter((p) => p.startsWith('web/') && p.endsWith('.js'));

// .c8rc.json is plain JSON (a "//" doc key, not JS comments), so it parses; each
// web module must be measured Node-side (include) or deliberately not (exclude).
const c8 = JSON.parse(readFileSync(resolve(root, '.c8rc.json'), 'utf8'));
const c8Listed = new Set([...c8.include, ...c8.exclude]);

// tsconfig.checkjs.json is JSONC (real // comments), so substring-check its text;
// web/*.js paths only ever appear quoted in the include array, never in prose.
const tsconfigText = readFileSync(resolve(root, 'tsconfig.checkjs.json'), 'utf8');

test('every first-party web module is measured (in .c8rc include or exclude)', () => {
  assert.ok(webModules.length >= 10, 'sanity: the web first-party set should be non-trivial');
  for (const m of webModules) {
    assert.ok(c8Listed.has(m), `${m} is first-party but missing from .c8rc.json include/exclude`);
  }
});

test('every first-party web module is type-checked (in tsconfig.checkjs include)', () => {
  for (const m of webModules) {
    assert.ok(
      tsconfigText.includes(`"${m}"`),
      `${m} is first-party but missing from tsconfig.checkjs.json include`
    );
  }
});
