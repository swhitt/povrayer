// Wrapper coverage tests for the renderAnimation() API (dist/index.js, built
// from wrapper/src/index.ts). Drives every branch the still render() tests
// never reach: the frames validator (`!Number.isInteger || < 1`, all three
// outcomes), the default vs explicit initial/final clock args, the TRACE_DONE
// per-frame onFrame fan-out (present, absent, and throwing), the numeric
// out<N>.png collector (filter + numeric-sort comparator + map), and the
// inherited PovrayError / AbortError error semantics.
//
// Run via `node --test test/node/` against the ./dist artifact (`make dist`),
// deliberately WITHOUT --test-force-exit: a clean runner exit is part of what
// we verify (EXIT_RUNTIME=1 must reap the pthread workers).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { renderAnimation, PovrayError } from '../../dist/index.js';
import { getExample } from '../../web/examples.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A clock-driven scene: the sphere slides along +x as clock sweeps, so each
// frame is genuinely a distinct render. Tiny + antialias-off keeps every frame
// well under a second.
const CLOCK_SCENE = [
  '#version 3.8;',
  'global_settings { assumed_gamma 1.0 }',
  'camera { location <0,0,-6> look_at 0 }',
  'light_source { <4,6,-5> color rgb 1 }',
  'sphere { <clock,0,0>, 1 pigment { rgb <1,0,0> } }',
  '',
].join('\n');

// A parse-error scene: lets us prove the animation argv (validation + extraArgs)
// is built before callMain, since POV-Ray bails almost immediately.
const BAD_SCENE = 'sphere {';

const TINY = { width: 64, height: 48, antialias: false };

function assertPng(bytes, label) {
  assert.ok(bytes instanceof Uint8Array, `${label}: not a Uint8Array`);
  assert.deepEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE, `${label}: PNG signature mismatch`);
  // A fresh, non-shared buffer, never a view into growable shared wasm memory.
  assert.ok(!(bytes.buffer instanceof SharedArrayBuffer), `${label}: SharedArrayBuffer-backed`);
}

// A parse-error animation leaves process.exitCode set to POV-Ray's status (see
// render.test.mjs); reset it so node:test doesn't report this file as failed.
afterEach(() => {
  process.exitCode = 0;
});

test('renders N frames with onFrame + onProgress (happy path, default clock)', async () => {
  // One render covers: the frames validator's valid outcome, the omitted
  // initial/final clock defaults, the extraArgs build, TRACE_DONE matching
  // (true on each "Trace Time:" line, false on every other line), fireOnFrame's
  // present path, and collect's filter + numeric-sort comparator + map.
  const frameCalls = [];
  let progressFired = false;
  const frames = await renderAnimation(CLOCK_SCENE, {
    ...TINY,
    frames: 3,
    onFrame: (index, total) => frameCalls.push([index, total]),
    onProgress: () => {
      progressFired = true;
    },
  });

  assert.equal(frames.length, 3, 'expected one PNG per frame');
  frames.forEach((png, i) => assertPng(png, `frame ${i + 1}`));
  assert.deepEqual(
    frameCalls,
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ],
    'onFrame must fire once per frame, in order, 1-based'
  );
  assert.ok(progressFired, 'onProgress must receive raw output lines');
});

test('explicit initialClock + finalClock drive the +KI/+KF args', async () => {
  // The non-default clock values walk the destructuring branches that the
  // happy path (which omits both) leaves on their default arms.
  const frames = await renderAnimation(CLOCK_SCENE, {
    ...TINY,
    frames: 2,
    initialClock: 0.25,
    finalClock: 0.75,
  });
  assert.equal(frames.length, 2);
  frames.forEach((png, i) => assertPng(png, `clock frame ${i + 1}`));
});

test('frames:1 returns a single PNG and fires onFrame once', async () => {
  const calls = [];
  const frames = await renderAnimation(CLOCK_SCENE, {
    ...TINY,
    frames: 1,
    onFrame: (i, t) => calls.push([i, t]),
  });
  assert.equal(frames.length, 1);
  assertPng(frames[0], 'single frame');
  assert.deepEqual(calls, [[1, 1]], 'onFrame must fire exactly once for a 1-frame anim');
});

test('frames:12 returns 12 PNGs in numeric (not lexical) frame order', async () => {
  // 12 frames forces the engine to zero-pad to two digits (out01.png..out12.png)
  // and exercises the numeric-sort comparator across many comparisons: a lexical
  // sort would place out10 before out2, so a correct numeric order is the proof
  // the comparator parses the digits. onFrame fires 1..12 strictly in order.
  const order = [];
  const frames = await renderAnimation(CLOCK_SCENE, {
    width: 32,
    height: 24,
    antialias: false,
    frames: 12,
    onFrame: (i) => order.push(i),
  });
  assert.equal(frames.length, 12, 'expected 12 frames');
  frames.forEach((png, i) => assertPng(png, `frame ${i + 1}`));
  assert.deepEqual(
    order,
    Array.from({ length: 12 }, (_, i) => i + 1),
    'onFrame must fire 1..12 strictly in order'
  );
});

test('ignores caller-staged decoy out files outside the frame range and padding', async () => {
  // Regression (frame-collection bounding): the collector must return only the
  // frames POV-Ray produced THIS run, never a caller-staged stray. A 10-frame
  // run zero-pads to out01..out10, so the collector matches exactly 2-digit
  // padding AND bounds N to [1, 10]. Stage decoys the OLD unbounded
  // /^out(\d+)\.png$/ matcher would have swept in:
  //   - out00.png : 2-digit padding but n=0  -> fails the n >= 1 lower bound
  //   - out99.png : 2-digit padding but n=99 -> fails the n <= frames upper bound
  //   - out9.png  : 1-digit, so the exact-width regex rejects it outright
  // None are valid PNGs, so if any leaked into the result assertPng would fail;
  // the count assertion catches the inflation either way.
  const decoy = new Uint8Array([0x2f, 0x2f, 0x0a]); // "//\n", deliberately not a PNG
  const frames = await renderAnimation(CLOCK_SCENE, {
    width: 32,
    height: 24,
    antialias: false,
    frames: 10,
    files: {
      'out00.png': decoy,
      'out99.png': decoy,
      'out9.png': decoy,
    },
  });
  assert.equal(frames.length, 10, 'decoy out files must not inflate the frame count');
  frames.forEach((png, i) => assertPng(png, `frame ${i + 1}`));
});

test('a throwing onFrame is swallowed; the animation still resolves', async () => {
  // fireOnFrame mirrors append's swallow: a callback that blows up must never
  // corrupt the render, so all frames still come back.
  let calls = 0;
  const frames = await renderAnimation(CLOCK_SCENE, {
    ...TINY,
    frames: 2,
    onFrame: () => {
      calls++;
      throw new Error('frame callback blew up (must be swallowed)');
    },
  });
  assert.equal(frames.length, 2, 'a throwing onFrame must not drop frames');
  assert.equal(calls, 2, 'onFrame must still be invoked for every frame');
});

test('frames:2 with no onFrame and no onProgress resolves (absent callback arms)', async () => {
  // Covers fireOnFrame's `!onFrame` early return and the onProgress `?.` absent
  // side: the wrapper still wires its own internal onProgress, but neither user
  // callback is present.
  const frames = await renderAnimation(CLOCK_SCENE, { ...TINY, frames: 2 });
  assert.equal(frames.length, 2);
  frames.forEach((png, i) => assertPng(png, `silent frame ${i + 1}`));
});

test('a parse-error scene rejects with PovrayError (argv built before callMain)', async () => {
  await assert.rejects(renderAnimation(BAD_SCENE, { ...TINY, frames: 2 }), (err) => {
    assert.ok(err instanceof PovrayError, `expected PovrayError, got ${err?.constructor?.name}`);
    assert.notEqual(err.exitCode, 0, 'exitCode should be non-zero');
    return true;
  });
});

test('invalid frames reject synchronously without rendering', async () => {
  // The validator's `||` has three testable outcomes:
  //  - frames: 0    -> integer but < 1 (the second operand)
  //  - frames: 2.5  -> not an integer  (the first operand short-circuits)
  //  - frames omitted -> undefined is not an integer (first operand again)
  // None of these may be a PovrayError: validation precedes any engine work.
  for (const bad of [{ frames: 0 }, { frames: 2.5 }, {}]) {
    // Deliberately invalid AnimationOptions (frames missing or non-integer); the
    // cast is the point of the test, that renderAnimation rejects before work.
    const opts = /** @type {import('../../dist/index.js').AnimationOptions} */ ({
      ...TINY,
      ...bad,
    });
    await assert.rejects(
      renderAnimation(CLOCK_SCENE, opts),
      /** @param {Error} err */ (err) => {
        assert.ok(!(err instanceof PovrayError), 'frame validation must be a plain Error');
        assert.match(err.message, /frames must be an integer >= 1/);
        return true;
      }
    );
  }
});

test('non-finite animation clock bounds reject before rendering', async () => {
  await assert.rejects(
    renderAnimation(CLOCK_SCENE, { ...TINY, frames: 2, initialClock: Number.NaN }),
    /initialClock and finalClock must be finite/
  );
  await assert.rejects(
    renderAnimation(CLOCK_SCENE, { ...TINY, frames: 2, finalClock: Number.POSITIVE_INFINITY }),
    /initialClock and finalClock must be finite/
  );
});

test('a pre-aborted signal rejects with AbortError', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    renderAnimation(CLOCK_SCENE, { ...TINY, frames: 2, signal: controller.signal }),
    /** @param {Error} err */ (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

test('a clock-driven example renders as an animation', async () => {
  // Guards that the new animated examples are clock-valid: orbit-moons must
  // produce one PNG per frame at a tiny size.
  const source = getExample('orbit-moons');
  assert.equal(typeof source, 'string', 'orbit-moons example must exist');
  const frames = await renderAnimation(source, {
    width: 48,
    height: 36,
    antialias: false,
    frames: 2,
  });
  assert.equal(frames.length, 2);
  frames.forEach((png, i) => assertPng(png, `orbit-moons frame ${i + 1}`));
});
