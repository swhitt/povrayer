// Turbo browser test: exercises the real inline SDL parser/compiler and WebGL2
// renderer through its narrow headless hooks, then drives the editor pipeline
// and real-render handoff through the DOM.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import {
  startBrowserCoverage,
  saveBrowserCoverage,
} from '../../tools/coverage/browser-collect.mjs';
import { decodeState } from '../../web/permalink.js';

/**
 * @typedef {Window & typeof globalThis & {
 *   __povgl?: {
 *     leaves: number,
 *     materials: number,
 *     slots: number,
 *     warnings: string[],
 *     usesClock: boolean,
 *     error: string | null,
 *   },
 *   __buildScene: (source: string) => { glsl: string },
 *   __checkGLSL: (source: string) => string | null,
 *   __curSrc: () => string | null,
 *   __probe: () => { mean: number, max: number, lit: number } | null,
 *   __setScale: (scale: number) => void,
 *   __opened?: { url: string, target: string },
 * }} TurboWindow
 */

const SCENE = `#version 3.8;
global_settings { assumed_gamma 1.0 }
camera { location <0, 0, -5> look_at 0 angle 45 }
light_source { <-3, 4, -4> color rgb 1 }
background { color rgb <0.20, 0.30, 0.40> }
sphere {
  0, 1
  pigment { color rgb <0.80, 0.10, 0.10> }
  finish { diffuse 0.8 specular 0.2 }
}
`;
const TWEAKED = SCENE.replace('0.80, 0.10, 0.10', '0.60, 0.10, 0.10');
const UNSUPPORTED = TWEAKED.replace(
  'finish { diffuse 0.8 specular 0.2 }',
  'finish { diffuse 0.8 specular 0.2 }\n  normal { bumps 0.5 }'
);
const STRUCTURAL = `${UNSUPPORTED}sphere {
  <2, 0, 0>, 0.5
  pigment { color rgb <0.10, 0.70, 0.30> }
}
`;
const BAD_SOURCE = `${STRUCTURAL}sphere { <0, 0, 0>, }
`;

// Generous on purpose: this suite loads THREE turbo pages, and each 'load' waits
// on a real shader compile that a GPU-less CI runner software-rasterises (the two
// auxiliary gotos below allow 90s each). The watchdog only exists to stop a wedged
// browser hanging the job forever, so it has to sit well above the sum of those.
const watchdog = setTimeout(async () => {
  console.error('watchdog: turbo test still running after 420s, force-exiting');
  try {
    await Promise.race([
      page ? saveBrowserCoverage(page, 'turbo') : Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 10_000).unref()),
    ]);
  } catch {
    // best-effort; the process is exiting regardless
  }
  process.exit(1);
}, 420_000);

/** Overlap AREA of two rects, in px². Zero when they do not intersect at all. */
const overlapArea = (a, b) => {
  const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const setSource = (page, source) =>
  page.evaluate((value) => {
    const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
    editor.value = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    const w = /** @type {TurboWindow} */ (window);
    const pill = document.getElementById('pill');
    return {
      current: w.__curSrc(),
      error: w.__povgl?.error ?? null,
      pillClass: pill.className,
      pillText: pill.textContent,
    };
  }, source);

const consoleLines = [];
let server;
let browser;
let page;
let phone;
let failure;

/** Wire console/pageerror capture onto a page so failures come with context. */
const watch = (target) => {
  target.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  target.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));
};

try {
  server = await startServer();
  browser = await chromium.launch();
  // DESKTOP context. This suite used to run entirely at 640x360, which is below
  // turbo's own 760px phone breakpoint, so every assertion below was silently
  // made against the phone layout (where #glslWrap, .fps and #glslBtn are
  // display:none !important). The GLSL/HUD paths belong on a desktop viewport;
  // the phone floors get their own context further down.
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await startBrowserCoverage(page);
  await page.addInitScript(() => sessionStorage.setItem('turbo-intro', '1'));
  watch(page);

  const encodedScene = Buffer.from(SCENE, 'utf8').toString('base64');
  const url = new URL(`turbo.html?pov=/#s=${encodedScene}`, server.url);
  await page.goto(url.href, { waitUntil: 'load' });

  assert.equal(
    await page.evaluate(() => globalThis.crossOriginIsolated),
    true,
    'Turbo must retain the cross-origin isolation headers used by the main renderer'
  );
  await page.waitForFunction(
    (source) => {
      const w = /** @type {TurboWindow} */ (window);
      return w.__curSrc?.() === source && w.__povgl?.error === null;
    },
    SCENE,
    { timeout: 30_000 }
  );

  // Parser -> compiler -> valid fragment shader -> visible WebGL output.
  const smoke = await page.evaluate((source) => {
    const w = /** @type {TurboWindow} */ (window);
    w.__setScale(0.25);
    const build = w.__buildScene(source);
    return {
      state: w.__povgl,
      glsl: build.glsl.slice(0, 80),
      compileError: w.__checkGLSL(build.glsl),
      probe: w.__probe(),
    };
  }, SCENE);
  assert.equal(smoke.state?.leaves, 1, 'the scene should compile to one render leaf');
  assert.equal(smoke.state?.materials, 1, 'the scene should compile to one material');
  assert.ok((smoke.state?.slots ?? 0) > 8, 'compiled uniforms should be allocated');
  assert.match(smoke.glsl, /^#version 300 es/, 'Turbo should emit a WebGL2 fragment shader');
  assert.equal(smoke.compileError, null, 'the emitted fragment shader should compile');
  assert.ok(smoke.probe && smoke.probe.max > 0.1, 'the rendered frame should contain color');
  assert.ok(smoke.probe && smoke.probe.lit > 0.5, 'the rendered frame should not be blank');

  // Numeric-only edits stream through the uniform path without a shader rebuild.
  const tweak = await setSource(page, TWEAKED);
  assert.equal(tweak.current, TWEAKED, 'a numeric edit should apply synchronously');
  assert.equal(tweak.pillClass, 'tweak', 'a numeric edit should use the tweak path');
  assert.equal(tweak.error, null);

  // Unsupported CPU-only features warn but preserve a usable GPU approximation.
  const unsupported = await setSource(page, UNSUPPORTED);
  assert.equal(unsupported.current, UNSUPPORTED, 'unsupported normal{} should be skipped safely');
  assert.equal(unsupported.pillClass, 'tweak', 'skipping normal{} should not rebuild the shader');
  assert.ok(
    await page.evaluate(() => {
      const w = /** @type {TurboWindow} */ (window);
      return (w.__povgl?.warnings ?? []).some((warning) => warning.includes('normal{} bump maps'));
    }),
    'the user should get a specific unsupported-feature warning'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('warnChip').classList.contains('show')),
    true,
    'unsupported-feature warnings should be visible in the UI'
  );

  // Structural edits take the debounced compile/swap path.
  const structural = await setSource(page, STRUCTURAL);
  assert.equal(structural.pillClass, 'build');
  assert.match(structural.pillText ?? '', /compiling/);
  assert.notEqual(
    structural.current,
    STRUCTURAL,
    'the previous program should stay live while linking'
  );
  await page.waitForFunction(
    (source) => {
      const w = /** @type {TurboWindow} */ (window);
      return w.__curSrc() === source && w.__povgl?.leaves === 2;
    },
    STRUCTURAL,
    { timeout: 30_000 }
  );

  // Parse failures surface line detail while the last good program keeps running.
  const bad = await setSource(page, BAD_SOURCE);
  assert.equal(bad.current, STRUCTURAL, 'a parse failure must keep the last good scene');
  assert.match(bad.error ?? '', /expected an expression|unexpected|expected/i);
  await page.waitForFunction(
    () => document.getElementById('errDetail').classList.contains('show'),
    null,
    {
      timeout: 3_000,
    }
  );
  const errorUI = await page.evaluate(() => ({
    pill: document.getElementById('pill').textContent,
    detail: document.getElementById('errDetail').textContent,
  }));
  assert.match(errorUI.pill ?? '', /line/);
  assert.match(errorUI.detail ?? '', /kept your last good scene running/);

  await setSource(page, STRUCTURAL);
  assert.equal(
    await page.evaluate(() => /** @type {TurboWindow} */ (window).__povgl?.error),
    null,
    'a valid edit should clear the parse error'
  );

  // "make it weirder" jitters scene numbers, but #version is a parser directive,
  // not scene data: turbo ignores its value, so a jittered one only fails later,
  // in the real renderer, via Copy/Download/Ray-trace ("requires POV-Ray version
  // 4.33 or later! ... Cannot parse input."). Roll it repeatedly (each number has
  // a 55% chance of moving) and assert #version never drifts while other decimals
  // do. turbo's inline script is outside checkJs and the coverage gate, so this
  // behavioral assertion is the only thing guarding it.
  const weird = await page.evaluate(() => {
    const ed = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
    const before = ed.value;
    let anyOtherChanged = false;
    for (let i = 0; i < 12; i++) {
      ed.value = before;
      /** @type {HTMLElement} */ (document.getElementById('weird')).click();
      if (!/#version\s+3\.8\s*;/.test(ed.value)) return { versionBroken: true, anyOtherChanged };
      if (ed.value !== before) anyOtherChanged = true;
    }
    return { versionBroken: false, anyOtherChanged };
  });
  assert.equal(weird.versionBroken, false, '#version must survive every weirder roll');
  assert.equal(weird.anyOtherChanged, true, 'weirder should still jitter other numbers');
  // Put the known-good scene back through the real input path so the Ray-trace
  // handoff below sees turbo's normal state, not a jittered leftover.
  assert.equal((await setSource(page, STRUCTURAL)).current, STRUCTURAL);

  // Ray-trace handoff carries the exact source and render mode into the real editor.
  await page.evaluate(() => {
    const w = /** @type {TurboWindow} */ (window);
    window.open = (url = '', target = '') => {
      w.__opened = { url: String(url), target };
      return null;
    };
  });
  await page.evaluate(() => document.getElementById('raytrace')?.click());
  await page.waitForFunction(() => !!(/** @type {TurboWindow} */ (window).__opened), null, {
    timeout: 5_000,
  });
  const opened = await page.evaluate(() => /** @type {TurboWindow} */ (window).__opened);
  assert.equal(opened?.target, '_blank');
  assert.match(opened?.url ?? '', /^\/#[-_A-Za-z0-9]+$/);
  const handoff = await decodeState((opened?.url ?? '').split('#')[1]);
  assert.equal(handoff?.source, STRUCTURAL);
  assert.equal(handoff?.mode, 'still');
  assert.equal(handoff?.width, '800');

  // ---- identity is stable, the gag is cosmetic --------------------------------
  // The title used to be `${random joke filename} - povrayer turbo`, so six loads
  // gave four different titles and crawlers indexed the page as
  // untitled_render_final_FINAL2.pov. The joke keeps its home in #fileName.
  assert.equal(await page.title(), 'povrayer turbo');
  assert.match(
    await page.evaluate(() => document.getElementById('fileName').textContent ?? ''),
    /\.pov$/,
    'the joke filename still lives in the editor title bar'
  );

  // ---- a11y baseline ----------------------------------------------------------
  const a11y = await page.evaluate(() => {
    const at = (sel, name) => document.querySelector(sel)?.getAttribute(name);
    return {
      toastRole: at('#toast', 'role'),
      toastLive: at('#toast', 'aria-live'),
      errLive: at('#errDetail', 'aria-live'),
      glRole: at('#gl', 'role'),
      glLabel: at('#gl', 'aria-label'),
      glTab: at('#gl', 'tabindex'),
      warnTag: document.getElementById('warnChip')?.tagName,
      resetTag: document.getElementById('camReset')?.tagName,
      snapLabel: at('#snap', 'aria-label'),
      playLabel: at('#play', 'aria-label'),
      playKeys: at('#play', 'aria-keyshortcuts'),
      glyphHidden: at('#playGlyph', 'aria-hidden'),
      scrubLabel: at('#scrub', 'aria-label'),
      scrubValueText: at('#scrub', 'aria-valuetext'),
      toggleControls: at('#toggle', 'aria-controls'),
      glslControls: at('#glslBtn', 'aria-controls'),
      headings: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()),
      mains: document.querySelectorAll('main').length,
      presetGroup: document.querySelector('[role="group"][aria-label="presets"]')
        ?.childElementCount,
    };
  });
  assert.equal(a11y.toastRole, 'status', '#toast is the one announcement channel');
  assert.equal(a11y.toastLive, 'polite', 'announcements must not interrupt');
  assert.equal(a11y.errLive, 'polite');
  assert.equal(a11y.glRole, 'img');
  assert.match(
    a11y.glLabel ?? '',
    /^live raymarched preview, \d+ objects?, \d+ materials?$/,
    'the canvas label describes the scene shape, and never the per-frame clock'
  );
  assert.doesNotMatch(a11y.glLabel ?? '', /clock/, 'the clock must not be in a per-frame label');
  assert.equal(a11y.glTab, '0', 'the camera must be reachable without a pointer');
  assert.equal(a11y.warnTag, 'BUTTON', '#warnChip is clickable, so it must be a button');
  assert.equal(a11y.resetTag, 'BUTTON', 'camera reset was a mouse-only <b>');
  assert.ok(a11y.snapLabel, 'a bare 📸 has no accessible name');
  assert.match(a11y.playLabel ?? '', /clock/i);
  assert.equal(a11y.playKeys, 'Space');
  assert.equal(a11y.glyphHidden, 'true');
  assert.equal(a11y.scrubLabel, 'clock');
  assert.match(a11y.scrubValueText ?? '', /^clock = \d\.\d{3}$/, 'a bare "0.557" names nothing');
  assert.equal(a11y.toggleControls, 'editorWrap');
  assert.equal(a11y.glslControls, 'glslWrap');
  assert.equal(a11y.headings.length, 1, 'exactly one <h1>');
  assert.match(a11y.headings[0] ?? '', /^povrayer turbo/);
  assert.equal(a11y.mains, 1, 'exactly one <main> landmark');
  assert.equal(a11y.presetGroup, 6, 'the preset group holds the five presets plus the dice');

  // Space must ACTIVATE a focused button, not be swallowed by the transport. The
  // global handler used to preventDefault for everything except #editor, which
  // cancelled the synthetic click on every button in the bar and paused the clock
  // instead, with no visible cause.
  const spaceOnButton = await page.evaluate(() => {
    const glow = /** @type {HTMLElement} */ (document.getElementById('glow'));
    const before = document.getElementById('play')?.getAttribute('aria-label');
    glow.focus();
    return { before, focused: document.activeElement === glow };
  });
  assert.equal(spaceOnButton.focused, true);
  const glowBefore = await page.evaluate(() =>
    document.getElementById('glow')?.getAttribute('aria-pressed')
  );
  await page.keyboard.press('Space');
  const afterSpace = await page.evaluate(() => ({
    pressed: document.getElementById('glow')?.getAttribute('aria-pressed'),
    on: document.getElementById('glow')?.classList.contains('on'),
    play: document.getElementById('play')?.getAttribute('aria-label'),
  }));
  assert.notEqual(afterSpace.pressed, glowBefore, 'Space on a focused button must click it');
  assert.equal(
    afterSpace.pressed === 'true',
    afterSpace.on,
    'aria-pressed and .on are one state, written together'
  );
  assert.equal(
    afterSpace.play,
    spaceOnButton.before,
    'Space on a button must NOT also toggle the clock'
  );

  // ...and Space still means play/pause when focus is on the canvas or nowhere.
  await page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('gl')).focus());
  await page.keyboard.press('Space');
  assert.notEqual(
    await page.evaluate(() => document.getElementById('play')?.getAttribute('aria-label')),
    spaceOnButton.before,
    'the canvas has no activation of its own, so Space is play/pause there'
  );

  // Keyboard camera: arrows orbit (which raises the off-script chip) and Home
  // gets you back. Without this a keyboard-only visitor arriving on a shared #t=
  // link with an off-script camera had no way out.
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page.evaluate(() => document.getElementById('camChip')?.classList.contains('show')),
    true,
    'arrow keys must drive the same orbit state the pointer writes'
  );
  await page.keyboard.press('Home');
  assert.equal(
    await page.evaluate(() => document.getElementById('camChip')?.classList.contains('show')),
    false,
    'Home resets the camera'
  );

  // aria-pressed tracks .on across the whole preset row, not just the clicked one.
  await page.evaluate(() =>
    /** @type {HTMLElement} */ (document.querySelector('[data-preset="csg"]'))?.click()
  );
  const presetState = await page.evaluate(() =>
    [...document.querySelectorAll('.preset')].map((b) => ({
      on: b.classList.contains('on'),
      pressed: b.getAttribute('aria-pressed'),
    }))
  );
  assert.equal(presetState.filter((p) => p.on).length, 1, 'exactly one preset is current');
  for (const p of presetState) assert.equal(p.pressed, p.on ? 'true' : 'false');

  // ---- one owner for editor visibility ---------------------------------------
  // Kill transitions on this page too, for the same reason the phone and matrix
  // contexts below do: toggling the sheet animates #editorWrap, and under headless
  // GL that slide is slow enough that Playwright's "visible, enabled and stable"
  // actionability wait on the toolbar never settles (measured: page.click('#toggle')
  // times out at 30s on the Linux CI runner while passing locally). None of the
  // assertions from here down are about the slide.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });

  // "Hide UI" and { } used to write DIFFERENT classes and only one touched the
  // label, so the button could read "Show UI" over an already-hidden sheet.
  const visibilityRoundTrip = await page.evaluate(async () => {
    const toggle = /** @type {HTMLElement} */ (document.getElementById('toggle'));
    const wrap = /** @type {HTMLElement} */ (document.getElementById('editorWrap'));
    const seen = [];
    const snap = () => {
      const cs = getComputedStyle(wrap);
      seen.push({
        label: toggle.textContent?.trim(),
        expanded: toggle.getAttribute('aria-expanded'),
        shown: cs.display !== 'none' && cs.visibility !== 'hidden',
      });
    };
    snap();
    for (let i = 0; i < 3; i++) {
      toggle.click();
      snap();
    }
    return seen;
  });
  assert.deepEqual(
    visibilityRoundTrip.map((s) => s.label),
    ['Hide UI', 'Show UI', 'Hide UI', 'Show UI'],
    'the label must flip on every press'
  );
  for (const s of visibilityRoundTrip) {
    assert.equal(s.shown, s.label === 'Hide UI', 'the sheet is visible iff the label says Hide UI');
    assert.equal(s.expanded, s.label === 'Hide UI' ? 'true' : 'false');
  }
  // Restore the sheet for the layout matrix below, clicking and reading back
  // inside ONE evaluate so nothing here waits on requestAnimationFrame.
  //
  // turbo drives a continuous WebGL render loop, and on a software-GL CI runner
  // that starves rAF (the job log shows "GPU stall due to ReadPixels"). Both of
  // Playwright's waiting mechanisms poll via rAF: page.click's "visible, enabled
  // and stable" actionability check, and waitForFunction's default polling. Each
  // timed out here on the runner while passing locally on a real GPU. The state
  // change itself is synchronous (setEditorVisible writes the class, the label
  // and aria-expanded in one go), so reading it back in the same task is exact
  // and needs no polling at all.
  const restoredLabel = await page.evaluate(() => {
    const t = /** @type {HTMLElement} */ (document.getElementById('toggle'));
    t.click();
    return t.textContent?.trim();
  });
  assert.equal(restoredLabel, 'Hide UI', 'the sheet is restored for the layout matrix');

  // Desktop work is done. Flush its coverage and CLOSE it before opening another
  // turbo page: each one runs a full-screen WebGL2 raymarch loop forever, and on a
  // software-GL CI runner three of those alive at once starves the box badly enough
  // that a fresh page.goto never reaches its load event inside 30s (measured: the
  // phone context's goto timed out on the runner while passing locally on a real
  // GPU). One live render loop at a time keeps this suite about turbo's behavior
  // rather than about the runner's GPU budget.
  await saveBrowserCoverage(page, 'turbo');
  await page.close();
  page = null;

  // ---- phone context: the floors the 640x360 suite never covered -------------
  phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.addInitScript(() => sessionStorage.setItem('turbo-intro', '1'));
  watch(phone);
  // waitUntil 'load' on this page does not fire until turbo has parsed the scene
  // and linked its first shader program. On a GPU-less CI runner that is software
  // rasterised and legitimately slow, so the default 30s is too tight (measured: it
  // timed out there while taking a couple of seconds locally). Nothing below cares
  // how fast the first frame arrives.
  await phone.goto(new URL('turbo.html?pov=/', server.url).href, {
    waitUntil: 'load',
    timeout: 90_000,
  });
  await phone.waitForFunction(() => !!(/** @type {TurboWindow} */ (window).__curSrc?.()), null, {
    timeout: 30_000,
  });
  // Quarter-scale like the desktop context above: every assertion from here on is
  // about layout and state, so paying for full-resolution raymarching each frame
  // only starves the runner.
  await phone.evaluate(() => /** @type {TurboWindow} */ (window).__setScale?.(0.25));
  // Same reason as the matrix below: the sheet's slide is far too slow in
  // headless GL to sleep on, and none of these assertions are about the slide.
  await phone.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });

  const phoneBoot = await phone.evaluate(() => ({
    label: document.getElementById('toggle')?.textContent?.trim(),
    expanded: document.getElementById('toggle')?.getAttribute('aria-expanded'),
    codeExpanded: document.getElementById('codeBtn')?.getAttribute('aria-expanded'),
    closed: document.getElementById('editorWrap')?.classList.contains('closed'),
  }));
  assert.equal(phoneBoot.closed, true, 'a phone boots canvas-first');
  assert.equal(
    phoneBoot.label,
    'Show UI',
    'the label must not claim "Hide UI" over a closed sheet'
  );
  assert.equal(phoneBoot.expanded, 'false');
  assert.equal(phoneBoot.codeExpanded, 'false', 'both controls read the same single state');

  // The { } button and "Show UI" drive the SAME state, in either order.
  // Dispatched inside evaluate, not phone.click: see the rAF note above. turbo's
  // render loop starves requestAnimationFrame on software GL, and page.click waits
  // on an rAF-polled actionability check. Tap-target GEOMETRY is still asserted
  // from real rects further down, so nothing is lost by not routing through the
  // synthetic pointer here.
  await phone.evaluate(() => document.getElementById('codeBtn')?.click());
  const afterCode = await phone.evaluate(() => {
    const ed = document.getElementById('editorWrap').getBoundingClientRect();
    const tp = document.getElementById('transport').getBoundingClientRect();
    return {
      label: document.getElementById('toggle')?.textContent?.trim(),
      closed: document.getElementById('editorWrap')?.classList.contains('closed'),
      codeExpanded: document.getElementById('codeBtn')?.getAttribute('aria-expanded'),
      sheetTop: ed.y,
      transportBottom: tp.bottom,
    };
  });
  assert.equal(afterCode.closed, false, '{ } must actually open the sheet');
  assert.equal(afterCode.label, 'Hide UI', '{ } owns the toggle label too');
  assert.equal(afterCode.codeExpanded, 'true');
  // An open sheet owns the bottom of a phone screen, so the transport rides above
  // it rather than being drawn over the code it covers.
  assert.ok(
    afterCode.transportBottom <= afterCode.sheetTop,
    `the transport (bottom ${afterCode.transportBottom}) must clear the open sheet (top ${afterCode.sheetTop})`
  );
  await phone.evaluate(() => document.getElementById('toggle')?.click());
  assert.equal(
    await phone.evaluate(() => document.getElementById('editorWrap')?.classList.contains('closed')),
    true,
    '"Hide UI" closes the sheet { } opened, instead of stacking a second class'
  );

  // Same as above: flush and close before the third context opens.
  await saveBrowserCoverage(phone, 'turbo-phone');
  await phone.close();
  phone = null;

  // ---- layout invariants across the viewport matrix ---------------------------
  // A third context so nothing has been clicked: crossing 760px must re-apply
  // each layout's default, which is what the old boot-time IS_PHONE snapshot
  // could not do (portrait load left .collapsed on, and a rotation to landscape
  // popped the sheet open unbidden because .collapsed only existed under 760px).
  const matrix = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await matrix.addInitScript(() => sessionStorage.setItem('turbo-intro', '1'));
  watch(matrix);
  await matrix.goto(new URL('turbo.html?pov=/', server.url).href, {
    waitUntil: 'load',
    timeout: 90_000,
  });
  await matrix.waitForFunction(() => !!(/** @type {TurboWindow} */ (window).__curSrc?.()), null, {
    timeout: 30_000,
  });
  // Quarter-scale like the desktop context above: every assertion from here on is
  // about layout and state, so paying for full-resolution raymarching each frame
  // only starves the runner.
  await matrix.evaluate(() => /** @type {TurboWindow} */ (window).__setScale?.(0.25));
  // These are RESTING-layout invariants, so kill the animations first. The sheet's
  // 280ms slide is a main-thread transition behind a backdrop-filter over a live
  // raymarcher, which in headless software GL advances at roughly 5fps (measured:
  // 21% of the way through the transform after 450ms), so sleeping "long enough"
  // for it would be a flake waiting to happen.
  await matrix.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
  await matrix.evaluate(() => document.getElementById('camChip')?.classList.add('show'));
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [820, 1180],
    [1280, 800],
    [1600, 900],
  ]) {
    await matrix.setViewportSize({ width, height });
    await matrix.waitForTimeout(150); // one style/layout pass after the MQL change
    const at = `${width}x${height}`;
    const geom = await matrix.evaluate(() => {
      const r = (sel) => {
        const el = /** @type {HTMLElement} */ (document.querySelector(sel));
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: b.x,
          y: b.y,
          right: b.right,
          bottom: b.bottom,
          h: b.height,
          visible: cs.display !== 'none' && cs.visibility !== 'hidden',
        };
      };
      const cta = document.getElementById('raytrace').getBoundingClientRect();
      const hit = document.elementFromPoint(cta.x + cta.width / 2, cta.y + cta.height / 2);
      return {
        bar: r('.bar'),
        editor: r('#editorWrap'),
        transport: r('#transport'),
        chip: r('#camChip'),
        ctaHit: hit ? hit.id || hit.tagName : null,
        ctaInView: cta.right <= window.innerWidth && cta.x >= 0,
        label: document.getElementById('toggle').textContent?.trim(),
      };
    });
    // The old bar wrapped into 2-3 rows at every width under ~1690px: measured
    // 76px at 1024 and 1280, 70px at 1366-1600, 56px at 1620-1680.
    assert.ok(geom.bar.h <= 40, `${at}: .bar must stay one row, got ${geom.bar.h}px`);
    assert.equal(
      overlapArea(geom.editor, geom.transport),
      0,
      `${at}: #transport must never be drawn over #editorWrap`
    );
    // #camChip used to hard-code top:56px / top:calc(160px + env()), which put it
    // ON the toolbar in the 761-960px band, covering the yellow CTA with a span
    // that has no click handler.
    assert.ok(
      geom.chip.y >= geom.bar.bottom,
      `${at}: #camChip (top ${geom.chip.y}) must clear the bar (bottom ${geom.bar.bottom})`
    );
    assert.equal(geom.ctaInView, true, `${at}: the primary CTA must stay on screen`);
    assert.equal(geom.ctaHit, 'raytrace', `${at}: nothing may cover the primary CTA`);
    assert.equal(
      geom.label,
      geom.editor.visible ? 'Hide UI' : 'Show UI',
      `${at}: the toggle label must match the sheet it controls`
    );
  }
  await matrix.close();
} catch (err) {
  failure = err;
} finally {
  if (page) await saveBrowserCoverage(page, 'turbo');
  if (phone) await saveBrowserCoverage(phone, 'turbo-phone');
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

if (failure) {
  console.error('turbo test failed:', failure);
  if (consoleLines.length) {
    console.error('--- page console ---');
    console.error(consoleLines.join('\n'));
  }
  process.exit(1);
}

clearTimeout(watchdog);
console.log('turbo browser test passed (parse, compile, render, edit paths, handoff)');
