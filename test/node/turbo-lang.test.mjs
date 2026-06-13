// Drift guard for the inlined editor language tooling in povrayer turbo.
//
// turbo is a single self-contained file, but its SDL/GLSL highlighting + the
// autocomplete are the SAME code the web app imports as modules. tools/gen-turbo.mjs
// inlines web/{highlight,context,complete,glsl-highlight}.js into turbo.html as the
// POVLang/GLSLLang globals. This test fails if someone edits those modules without
// re-running `npm run gen:turbo`, so the two editors can never silently diverge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { render } from '../../tools/gen-turbo.mjs';

const TURBO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'turbo.html');

test('the inlined POVLang/GLSLLang block is up to date with the source modules', async () => {
  const committed = readFileSync(TURBO, 'utf8');
  const fresh = await render(committed);
  assert.equal(
    fresh,
    committed,
    'turbo.html is stale: run `npm run gen:turbo` after editing web/{highlight,context,complete,glsl-highlight}.js'
  );
});

test('turbo.html exposes the shared globals', () => {
  const html = readFileSync(TURBO, 'utf8');
  assert.match(html, /window\.POVLang = /, 'POVLang global must be assigned');
  assert.match(html, /window\.GLSLLang = /, 'GLSLLang global must be assigned');
});
