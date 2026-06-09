// Render-verify every shipped example against the dist/ wasm build. Mirrors
// anim.test.mjs's pattern: import the real render() and the EXAMPLES manifest,
// render one tiny still frame per scene, and assert it is a valid, NON-TRIVIAL
// PNG (right signature AND real content, not an all-black frame).
//
// Per-scene gate quality: every scene renders at q3 (fast) EXCEPT the few whose
// subject only resolves at high quality. god-rays, for instance, renders a clean
// but fully black frame at q3/q5 (its volumetric shafts need the media + shadow
// pass) and would sail through a signature-only check while showing nothing, so
// it is gated at q9. The honesty is unchanged from a blanket q9 gate -- every
// scene still has to emit real content at a quality where it actually does -- we
// just stop paying q9 on the ~28 scenes that look identical at q3. (At 160x120
// the per-render cost is mostly fixed wasm instantiation, so the q3 saving is
// modest, but it keeps the node shard honest without over-rendering.)
//
// HIGH_QUALITY is the explicit allow-list of scenes that need q9. Anything black
// at q3 MUST be added here (and the content assertion will fail loudly if a new
// scene needs it and isn't listed). Keep this list minimal and justified.
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

// Scenes whose content only appears at high quality (media / GI passes that the
// q3 render skips). Every other scene is gated at q3.
const HIGH_QUALITY = new Set(['god-rays']);
const DEFAULT_QUALITY = 3;
const HIGH = 9;

const gateQuality = (name) => (HIGH_QUALITY.has(name) ? HIGH : DEFAULT_QUALITY);
const gateOpts = (name) => ({
  width: 160,
  height: 120,
  antialias: false,
  quality: gateQuality(name),
});

// A 160x120 all-black/uniform PNG compresses to ~350 bytes; every real scene
// clears 1500. 1000 sits comfortably between, so a scene that renders empty
// (bad camera, unlit, or a feature that needs a quality it isn't given) trips it.
const MIN_CONTENT_BYTES = 1000;

for (const ex of EXAMPLES) {
  test(`${ex.name} renders a non-trivial PNG at its gate quality`, async () => {
    const q = gateQuality(ex.name);
    const png = await render(ex.source, gateOpts(ex.name));
    assert.ok(png instanceof Uint8Array, `${ex.name}: render did not return bytes`);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      PNG_SIGNATURE,
      `${ex.name}: PNG signature mismatch (scene failed to render cleanly)`
    );
    assert.ok(
      png.length > MIN_CONTENT_BYTES,
      `${ex.name}: PNG is only ${png.length} bytes (renders empty/black at q${q}); ` +
        `if this scene needs a higher quality, add it to HIGH_QUALITY`
    );
  });
}
