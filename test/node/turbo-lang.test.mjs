// Drift guard for EVERYTHING inlined into povrayer turbo.
//
// turbo ships as one self-contained HTML file, but none of its JavaScript is
// written there. tools/gen-turbo.mjs fills two generated regions: gen:lang bundles
// web/{highlight,context,complete,glsl-highlight}.js (the SAME modules the web app
// imports) into the POVLang/GLSLLang globals, and gen:app inlines web/turbo-app.js,
// turbo's own ~5.5k-line application script, verbatim.
//
// The equality check below is what makes that arrangement safe: turbo.html cannot
// be committed stale, so the two editors can never silently diverge AND the app
// code can never drift away from the file that eslint/prettier/tsc actually see.
//
// The last two tests defend the arrangement itself. Every serious turbo bug (a
// Space handler that cancelled activation on 16 buttons, a visibility deadlock, an
// inverted play glyph, a number-jitter feature that rewrote `#version 3.8`) got in
// because that code sat in a <script> tag no static analysis could reach. Nothing
// stops someone re-opening that hole by hand except a test that says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { render } from '../../tools/gen-turbo.mjs';

const TURBO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'turbo.html');

test('the inlined lang bundle and app script are up to date with their sources', async () => {
  const committed = readFileSync(TURBO, 'utf8');
  const fresh = await render(committed);
  assert.equal(
    fresh,
    committed,
    'turbo.html is stale: run `npm run gen:turbo` after editing web/turbo-app.js or web/{highlight,context,complete,glsl-highlight}.js'
  );
});

test('turbo.html exposes the shared globals', () => {
  const html = readFileSync(TURBO, 'utf8');
  assert.match(html, /window\.POVLang = /, 'POVLang global must be assigned');
  assert.match(html, /window\.GLSLLang = /, 'GLSLLang global must be assigned');
});

test('every script in turbo.html comes from a generated region', () => {
  const html = readFileSync(TURBO, 'utf8');
  const outside = html
    .replace(/<!-- gen:lang:start -->[\s\S]*?<!-- gen:lang:end -->/, '')
    .replace(/<!-- gen:app:start -->[\s\S]*?<!-- gen:app:end -->/, '');
  assert.ok(
    !/<script/i.test(outside),
    'hand-written <script> in turbo.html is invisible to eslint, prettier, and checkJs. ' +
      'Put the code in web/turbo-app.js and run `npm run gen:turbo` instead.'
  );
  // Both regions must still be there to strip, or the check above passes vacuously.
  assert.match(html, /<!-- gen:lang:start -->[\s\S]*<script/);
  assert.match(html, /<!-- gen:app:start -->[\s\S]*<script/);
});

test('turbo.html stays self-contained enough to open from file://', () => {
  const html = readFileSync(TURBO, 'utf8');
  assert.ok(
    !/<script[^>]*\ssrc=/i.test(html),
    'an external script would 404 on a file:// open; turbo inlines its JS on purpose'
  );
  assert.ok(
    !/<script[^>]*\stype\s*=\s*["']module["']/i.test(html),
    "file:// blocks ES module loading, so turbo's scripts must stay classic scripts"
  );
});
