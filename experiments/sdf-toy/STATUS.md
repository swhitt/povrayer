# SDF Toy: status

Two toys now live here:

- `index.html`: the original GLSL playground (Shadertoy-style `mainImage`, three presets, randomize). Unchanged, still works.
- `turbo.html`: **povrayer turbo**, the main event. You type real POV-Ray SDL and it raymarches on the GPU at 60-120fps. Same scene text ray-traces for real at povrayer.com, one click away.

## povrayer turbo, in one paragraph

A single self-contained HTML file (no build, no deps, no WASM) containing a
recursive-descent parser for a useful subset of POV-Ray SDL, a compiler that
turns scene STRUCTURE into GLSL once and streams all NUMBERS through a std140
UBO every frame, and a POV-faithful raymarcher (plain N·L diffuse, no distance
falloff, both phong and specular lobes, additive reflection, exponential fog,
clamp + sRGB out). Editing a number or scrubbing `clock` updates uniforms in
the same frame; only structural edits recompile (debounced, background-linked
via `KHR_parallel_shader_compile`, old scene keeps rendering through it).

## What works (verified in browser via playwright-cli)

- **SDL subset**: camera (location/look*at/angle/right/up/sky/direction),
  light_source (point, shadowless, area_light→soft shadows, fade*\*),
  background, fog, sky_sphere, sphere/box/plane/cylinder/cone/torus/blob
  (real density field, negative strengths)/superellipsoid (rounded-box
  stand-in, warns), union/merge/difference/intersection/object,
  translate/rotate/scale/matrix, texture/pigment/finish with declared-and-
  extended idiom, checker/gradient/marble/bozo/radial/spherical pigments +
  color_map + turbulence, finish ambient/diffuse/specular/roughness/phong/
  phong_size/metallic/emission/reflection{min,max fresnel falloff metallic},
  rgbt transparency (straight-through tint, no refraction),
  `#declare/#local/#while/#for/#if/#ifdef/#else/#macro/#include/array`,
  full expression eval (vectors, dot-members, rand/seed, vrotate, the lot),
  `clock` everywhere.
- **POV semantics that matter**: left-handed coords with `cross(sky, dir)`
  camera basis (verified pixel-comparable against real POV-Ray output),
  `angle` FOV against `right` length, `image_width/image_height`, rotate
  X-then-Y-then-Z in degrees, transforms compose in source order, difference
  cut faces take the cutter's texture, checker defaults to blue/green,
  finish defaults ambient 0.1 / diffuse 0.6 / roughness 0.05 / phong_size 40,
  lights don't attenuate unless fade'd, `assumed_gamma 1.0` pipeline
  (clamp + 1/2.2, dithered).
- **The twin trick**: "Ray-trace it →" gzips the same source into povrayer's
  own permalink format and opens povrayer.com (override target with
  `?pov=<url>`). Verified end-to-end against a local `make web` serving the
  real editor: scene hydrates and draft-renders. Side-by-side GPU vs real
  POV-Ray renders of the hello preset match in framing, checker phase, fog,
  sky, and materials.
- **Compatibility proof**: povrayer's actual gallery `csg-die` scene (macros,
  #if pip layout, superellipsoid dice, area lights, spherical-gradient
  backdrop) pastes in unmodified and renders at 60fps looking like the real
  render. Backdrop planes work because standalone planes march two-sided,
  which is what POV primary rays see.
- **Editor feel**: parse on EVERY keystroke; pill flashes green "tweak"
  (same-frame uniform update) vs amber "rebuilt" (structural). alt+↑/↓ nudges
  the number under the caret (shift=10x, ctrl=0.1x) and the scene answers in
  the same frame. Errors speak POV ("did you mean 'sphere'?", source excerpt,
  "kept your last good scene running") and bad news is delayed 550ms so
  mid-typing never flashes red. Unsupported constructs are warnings that
  funnel to the Ray-trace button ("N things only the real tracer can do →"),
  never errors.
- **clock as a transport**: play/pause/scrub bottom-center, `clock = 0.42`
  readout, loop period picker, spacebar toggles. Scenes whose STRUCTURE
  depends on clock (loop bounds) re-parse per scrub and only recompile if the
  GLSL actually changed.
- **Performance**: flat unions of same-primitive/same-material leaves (the
  `#for`-grid idiom) compile to ONE GLSL loop over a UBO range instead of N
  inlined functions; this took the 50-sphere preset from multi-second Metal
  compiles to ~instant. Resolution governor drops/raises render scale to hold
  frame time. 120fps on Apple M5 Pro for 4 presets, 44fps for the 50-sphere
  farm at full res.
- **Joy**: first-load scanline gag ("Rendering... line 312 of 540" then it
  starts MOVING), share links carry source + paused clock + camera orbit
  (gzip+base64url, versioned), orbit shows a "camera off-script · reset"
  chip, generated retro filenames (`untitled_render_final_FINAL2.pov`),
  `photons` says "buy a Cray", `radiosity` says "ooh, fancy", generated-GLSL
  view behind the `glsl` button with provenance comments.

## Presets (all five verified valid in BOTH renderers via dist/ node render)

hello, 1994 (chrome/glass/red on checker, orbiting via clock) · render farm
(49-sphere #for grid, magenta/cyan, sine ripple) · the carousel (six
difference{} monoliths around a breathing blob) · csg lab (Steinmetz
intersection + a die with pigmented pips) · skyvase.pov (POVBENCH homage,
camera orbits via clock).

## Running it

- `python3 -m http.server 8137` in this directory → http://127.0.0.1:8137/turbo.html
  (plain static file; no COOP/COEP needed, no WASM)
- For local handoff testing: `make web` at repo root serves the real editor on
  :8080; open turbo with `?pov=http://127.0.0.1:8080/index.html`.
- Debug surface: `window.__fps`, `window.__povgl` (leaves/materials/slots/
  warnings/error), `window.__scanNaN()`.

## Gallery sweep (2026-06-12)

All 96 povrayer gallery scenes were swept through turbo headless (parse ->
GLSL -> driver compile -> render probe via `gallery-sweep.json` + the
`window.__*` hooks): **95/96 render on the GPU, 1 funnels gracefully**
(menger-sponge: 1265 objects is past the 512-leaf real-time budget; the error
says to Ray-trace it). 30 render with zero warnings; the rest warn-and-
approximate (normal{}, media, refraction, etc. funnel to the real tracer).

What the sweep forced into existence: C-style ternary `?:`, real
`#switch/#case/#range` execution, directives inside object-modifier lists
(`#if ... texture{A} #else texture{B} #end`), block-valued macro args
(`Slab(-2, pigment {...})`), macros that open with `#local` in object
context, texture-level patterns (`checker texture{} texture{}` synthesises a
checker pigment; `texture_map` approximates with its middle entry), texture
arrays (`Mats[I]`), `transmit/filter` as pigment items, crackle/object/
function/pigment_map/warp handling, `photons`/`projected_through` in lights,
two-arg `angle`, unknown Capitalised include-names warn instead of erroring,
and params moved from a UBO (ANGLE/Metal caps them at 16KB) to an RGBA32F
data texture (16k vec4 budget).

Two hard-won stability fixes: an overtaken in-flight shader build used to
leak a GPU pipeline per rebuild (animated structural scenes leaked ~4/sec
until the GPU process silently zombied, `isContextLost()` still false), and
giant scenes taking their FIRST frame at full resolution could trip the macOS
GPU watchdog, killing the process the same way. Now: pending builds are
deleted on overtake, and scenes >250/>600 leaves clamp the render scale
before their first frame (the governor climbs back within a per-scene cap).

## Known limits (deliberate)

No refraction/interior (glass is fresnel reflection + tinted transmission),
no normal{} bumps, no media/radiosity/photons (funneled to the real tracer),
no lathe/prism/sor/height_field/mesh/text/isosurface (warn + skip), merge
behaves as union (identical for opaque), fog is exponential type-1 only,
color_map capped at 8 stops, ≤8 lights, UBO budget 1024 vec4 (~50-200 objects
depending on type). POV's `rotate` on cameras is warned-and-skipped.

## Screenshots

`shot-turbo-hello.png` (GPU hello preset), `shot-turbo-farm.png`,
`shot-turbo-die.png` (the unmodified povrayer gallery scene on GPU).
CPU ground-truth comparisons were rendered via dist/ during verification
(/tmp/hello-cpu.png et al).
