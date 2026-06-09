// Render-verify every shipped example against the dist/ wasm build. Mirrors
// anim.test.mjs's pattern: import the real render() and the EXAMPLES manifest,
// render one tiny still frame per scene, and assert it is a valid, NON-TRIVIAL
// PNG (right signature AND real content, not an all-black frame).
//
// Quality 9 (the editor's default Render quality, the one a visitor actually
// gets) on purpose, not a faster low quality: some scenes only resolve their
// subject at high quality. god-rays, for instance, renders a clean but fully
// black frame at quality 3/5 (its volumetric shafts need shadows + radiosity)
// and would sail through a signature-only check while showing nothing. Gating
// at q9 verifies each scene produces what the UI shows, in ~30s across the
// whole library.
//
// Deterministic (no clock loop, no sleeps): a single frame at clock 0 proves
// each scene parses and renders cleanly. clock 0 is valid for animated scenes
// too, so they render their first frame here. The full N-frame anim verify is
// deliberately NOT on the gate (too slow across the whole library); anim.test.mjs
// covers the animation path with a representative clock-driven example.
//
// Runs against the ./dist artifact (`make dist`); dist/ is gitignored, so only
// this test source is committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { render } from '../../dist/index.js';
import { EXAMPLES } from '../../web/examples.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const GATE = { width: 160, height: 120, antialias: false, quality: 9 };

// A 160x120 all-black/uniform PNG compresses to ~350 bytes; every real scene
// clears 1500. 1000 sits comfortably between, so a scene that renders empty
// (bad camera, unlit, or a feature that needs a quality it isn't given) trips it.
const MIN_CONTENT_BYTES = 1000;

for (const ex of EXAMPLES) {
  test(`${ex.name} renders a non-trivial PNG at the default quality`, async () => {
    const png = await render(ex.source, GATE);
    assert.ok(png instanceof Uint8Array, `${ex.name}: render did not return bytes`);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      PNG_SIGNATURE,
      `${ex.name}: PNG signature mismatch (scene failed to render cleanly)`
    );
    assert.ok(
      png.length > MIN_CONTENT_BYTES,
      `${ex.name}: PNG is only ${png.length} bytes (renders empty/black at q9)`
    );
  });
}
