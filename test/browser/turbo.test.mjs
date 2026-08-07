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

const watchdog = setTimeout(async () => {
  console.error('watchdog: turbo test still running after 120s, force-exiting');
  try {
    await Promise.race([
      page ? saveBrowserCoverage(page, 'turbo') : Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 10_000).unref()),
    ]);
  } catch {
    // best-effort; the process is exiting regardless
  }
  process.exit(1);
}, 120_000);

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
let failure;

try {
  server = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await startBrowserCoverage(page);
  await page.addInitScript(() => sessionStorage.setItem('turbo-intro', '1'));
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

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
  await page.click('#raytrace');
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
} catch (err) {
  failure = err;
} finally {
  if (page) await saveBrowserCoverage(page, 'turbo');
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
