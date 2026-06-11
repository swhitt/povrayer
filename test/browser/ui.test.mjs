// UI page test: drives web/index.html (served at /) through the COOP/COEP
// server. This script owns the server lifecycle; nothing else starts it.
//
// Mirrors browser.test.mjs's timeout discipline: page.evaluate has NO timeout
// option, so every long wait here is a waitForFunction with an explicit
// timeout, and a hard 300s process watchdog force-exits if anything (including
// a hung browser.close()) wedges.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import {
  startBrowserCoverage,
  saveBrowserCoverage,
} from '../../tools/coverage/browser-collect.mjs';
import { encodeState } from '../../web/permalink.js';

// Hard watchdog: only cleared on success, after browser and server have shut
// down cleanly.
const watchdog = setTimeout(async () => {
  console.error('watchdog: ui test still running after 300s, force-exiting');
  // process.exit skips the finally, so flush V8 coverage here too (bounded, in
  // case the wedge is the browser itself) so a late hang never drops this
  // page's first-party coverage from the merged report.
  try {
    await Promise.race([
      page ? saveBrowserCoverage(page, 'ui') : Promise.resolve(),
      new Promise((r) => setTimeout(r, 10_000).unref()),
    ]);
  } catch {
    // best-effort; we're force-exiting regardless
  }
  process.exit(1);
}, 300_000);

const consoleLines = [];
let server;
let browser;
let page;
let failure;

try {
  server = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage();
  // Start V8 coverage before navigation so ui.js/render-client.js/examples.js
  // are captured (no-op unless POVRAYER_COVERAGE is set).
  await startBrowserCoverage(page);
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto(server.url, { waitUntil: 'load' });

  // quality/antialias/threads live in the collapsed "advanced" disclosure; using
  // them means expanding it first (as a user would). These wrappers open advanced
  // before each interaction so the steps stay robust across the reloads below that
  // reset the disclosure to its saved/default state.
  const openAdvanced = () => page.evaluate(() => (document.getElementById('advanced').open = true));
  const selAdvanced = async (sel, val) => {
    await openAdvanced();
    await page.selectOption(sel, val);
  };
  const fillAdvanced = async (sel, val) => {
    await openAdvanced();
    await page.fill(sel, val);
  };
  // Set the editor source and fire the input event the app listens on (rebuilds
  // the scene-params panel, schedules a save/draft). Shared by the slider steps.
  const setSceneSource = (val) =>
    page.evaluate((v) => {
      const e = document.getElementById('editor');
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, val);

  // FIRST: cross-origin isolation, so a header regression fails distinctly
  // from a UI regression.
  const iso = await page.evaluate(() => globalThis.crossOriginIsolated);
  assert.equal(iso, true, 'page is not crossOriginIsolated (COOP/COEP header regression)');
  assert.equal(
    await page.evaluate(() => document.getElementById('iso-warning').hidden),
    true,
    'iso warning banner should stay hidden on an isolated page'
  );

  // Bounded wait for ui.js: the module builds the example browser's options on
  // load (the panel is hidden but the options exist in the DOM), so if the
  // import chain fails we die here in 30s with the page console attached
  // instead of riding out the watchdog.
  await page.waitForFunction(
    () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
    null,
    { timeout: 30_000 }
  );

  // Idle-state contract: Cancel is hidden until a render is in flight, and
  // the status line is a live region.
  assert.equal(
    await page.evaluate(() => document.getElementById('cancel-btn').hidden),
    true,
    'cancel button should be hidden while idle'
  );
  assert.ok(
    await page.evaluate(() => !!document.querySelector('#status[role=status]')),
    '#status should carry role="status"'
  );

  // Cold-load contract: live draft is on by default, and the restored scene
  // auto-renders on load BEFORE any keystroke. Regression guard for the bug
  // where the render plate sat empty until the first edit (read as "live is
  // broken"). Wait for the on-load draft's decoded image, then confirm it was a
  // draft (no download button) rather than a full render.
  assert.equal(
    await page.evaluate(() => document.getElementById('live-toggle').getAttribute('aria-pressed')),
    'true',
    'live draft should default to on'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('advanced').open),
    false,
    'advanced disclosure should default closed (calm toolbar on first load)'
  );
  await page.waitForFunction(
    () => {
      const img = document.getElementById('output');
      return img && img.src.startsWith('blob:') && img.naturalWidth > 0;
    },
    null,
    { timeout: 120_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('download-btn').hidden),
    true,
    'the on-load image should be a live draft (no download), not a full render'
  );

  // Happy path: small fast render, wait for the decoded blob image.
  await page.fill('#width', '160');
  await page.fill('#height', '120');
  await selAdvanced('#antialias', 'off');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => {
      const img = document.getElementById('output');
      return img.src.startsWith('blob:') && img.naturalWidth === 160 && img.naturalHeight === 120;
    },
    null,
    { timeout: 120_000 }
  );
  const doneStatus = await page.evaluate(() => document.getElementById('status').textContent);
  // The done-line is the brief headline: time + resolution only. The per-phase
  // timings/rays/threads belong to the stat chips, never repeated up here.
  assert.match(
    doneStatus,
    /^done in \d+\.\d\ds · 160×120$/,
    `unexpected status after render: ${doneStatus}`
  );
  assert.ok(
    !/trace|rays|thread/.test(doneStatus),
    `done-line should not repeat the chip stats, got: ${doneStatus}`
  );
  const download = await page.evaluate(() => {
    const a = document.getElementById('download-btn');
    return { hidden: a.hidden, href: a.href };
  });
  assert.equal(download.hidden, false, 'download link should be visible after a render');
  assert.ok(
    download.href.startsWith('blob:'),
    `download href should be a blob URL, got: ${download.href}`
  );
  const downloadName = await page.evaluate(() =>
    document.getElementById('download-btn').getAttribute('download')
  );
  assert.match(
    downloadName ?? '',
    /^render-160x120/,
    `download filename should reflect the render opts, got: ${downloadName}`
  );
  // The raw log lives behind a disclosure whose summary carries the label +
  // dim line-count pair (the shared disclosure-label/-count structure).
  const logSummary = await page.evaluate(() => ({
    label: document.getElementById('log-label').textContent,
    count: document.getElementById('log-count').textContent,
  }));
  assert.equal(logSummary.label, 'render log', 'log summary label after a successful render');
  assert.match(
    logSummary.count,
    /^\(\d+ lines\)$/,
    `unexpected log summary count after a successful render: ${logSummary.count}`
  );

  // Stats readout: the still render populates the chip row (showStats). The
  // always-on pixels row is present plus the timing/ray rows the log carries.
  // resolution and total time live in the done-line, so they must NOT appear here.
  assert.equal(
    await page.evaluate(() => document.getElementById('stats').hidden),
    false,
    'the stats readout is visible after a still render'
  );
  const statChips = await page.evaluate(() =>
    [...document.querySelectorAll('#stats .stat')].map((c) => c.querySelector('dt').textContent)
  );
  assert.ok(
    statChips.includes('pixels'),
    `stats chips should include the always-on pixels row, got: ${statChips.join(',')}`
  );
  assert.ok(
    !statChips.includes('resolution') && !statChips.includes('total'),
    `stats chips should not repeat the done-line's resolution/total, got: ${statChips.join(',')}`
  );

  // Raw flags ride along as args on an explicit render (collectOptions's truthy
  // branch). The field lives in the collapsed "advanced" disclosure, so open it
  // first (as a user would). Typing persists it (input -> debounced scheduleSave)
  // and the next render runs with the flag appended; +Q1 is a fast, valid extra.
  await page.evaluate(() => (document.getElementById('advanced').open = true));
  await page.fill('#flags', '+Q1');
  await page.waitForFunction(
    () => {
      try {
        return JSON.parse(localStorage.getItem('povrayer.ui.v1') || '{}').flags === '+Q1';
      } catch {
        return false;
      }
    },
    null,
    { timeout: 5_000 }
  );
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').dataset.state === 'done',
    null,
    { timeout: 120_000 }
  );
  await page.fill('#flags', ''); // clear so later renders see the default opts again

  // Cancel path: start a deliberately slow render (big frame, tight AA),
  // abort it, and require the 'render cancelled' status. Only the AbortError branch
  // sets that text, so this proves cancellation actually rejects the render.
  await page.fill('#width', '1024');
  await page.fill('#height', '768');
  await selAdvanced('#antialias', '0.05');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('rendering'),
    null,
    { timeout: 10_000 }
  );
  // The progress bar only exists while a render is in flight.
  await page.waitForSelector('#progress', { state: 'visible', timeout: 10_000 });
  await page.click('#cancel-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent === 'render cancelled',
    null,
    { timeout: 30_000 }
  );
  // Controls return to idle and the previous 160x120 image is kept.
  await page.waitForFunction(() => !document.getElementById('render-btn').disabled, null, {
    timeout: 5_000,
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('output').naturalWidth),
    160,
    'cancelled render must not replace the previous image'
  );

  // ===========================================================================
  // Stop control (#status-row): the prominent, always-visible render-stop the
  // toolbar Cancel / Escape are easy to miss on mobile. It tracks the SAME
  // in-flight signal as the spinner (busy render OR live draft) and activating
  // it stops whatever is running. The live-draft case is exercised in the
  // live-draft suite further down; here the explicit-render + idle cases.
  // ===========================================================================
  // Idle: nothing in flight, so Stop is hidden (it agrees with the spinner). A
  // click while idle is a defensive no-op (neither abortCtl nor draftCtl set).
  await page.waitForFunction(() => document.getElementById('status-spinner').hidden, null, {
    timeout: 30_000,
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('stop-btn').hidden),
    true,
    'stop button should be hidden while idle'
  );
  const idleStatus = await page.evaluate(() => document.getElementById('status').textContent);
  await page.evaluate(() => document.getElementById('stop-btn').click()); // idle no-op
  assert.equal(
    await page.evaluate(() => document.getElementById('status').textContent),
    idleStatus,
    'clicking Stop while idle must do nothing'
  );

  // Explicit render: Stop appears with the spinner the instant a render is in
  // flight, and activating it cancels exactly like the toolbar Cancel. Stop is
  // the single-column affordance (CSS hides it at the two-column breakpoint,
  // where the toolbar Cancel is the one stop control), so click it at a mobile
  // viewport.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.fill('#width', '1024');
  await page.fill('#height', '768');
  await selAdvanced('#antialias', '0.05');
  await page.click('#render-btn');
  await page.waitForFunction(
    () =>
      document.getElementById('status').dataset.state === 'busy' &&
      !document.getElementById('stop-btn').hidden,
    null,
    { timeout: 15_000 }
  );
  await page.click('#stop-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent === 'render cancelled',
    null,
    { timeout: 30_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('stop-btn').hidden),
    true,
    'stop button hides once the explicit render is cancelled'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('output').naturalWidth),
    160,
    'a Stop-cancelled render must not replace the previous image'
  );
  await page.setViewportSize({ width: 1280, height: 720 });

  // --- render-client.js direct coverage --------------------------------------
  // The UI's happy/cancel paths leave a handful of render-client branches
  // unreached: parseStats with no timing lines, errorHeadline on a worker-crash
  // log (no file reference), formatError's abort voice, the onProgress callback
  // (pages pass onEvent, never onProgress), the onEvent-absent branch, and the
  // busy backstop throw. render-client is an ES-module singleton keyed by URL,
  // so a dynamic import returns the very instance ui.js loaded; V8 coverage
  // attributes these hits to web/render-client.js.

  // Pure helpers first (no wasm). Each covers a render-client branch the
  // happy/cancel UI paths skip; the inline comments name the source line.
  const helpers = await page.evaluate(async () => {
    const mod = await import('/render-client.js');
    return {
      // parseStats: log with no Trace/Parse/Rays lines -> the undefined branches.
      noStats: mod.parseStats('Persistence Of Vision Raytracer 3.8\n(no timing lines here)\n'),
      // errorHeadline: no error-looking line at all -> early `i < 0` return null.
      headlineNoError: mod.errorHeadline('just a clean log\nTrace Time: 0.1\nall done'),
      // errorHeadline: `File '...' line N` sits ABOVE the error line, so the
      // scan-back lands on j !== i and the message falls to lines[i].trim().
      headlineFileAbove: mod.errorHeadline(
        "File 'scene.pov' line 5:\nParse Error: Expected ; but found }"
      ),
      // errorHeadline: error line present but no file reference -> trailing null.
      headlineNull: mod.errorHeadline('worker sent an error: boom\nnothing useful follows'),
      // formatError(PovrayError) whose log has no error line: the excerpt falls
      // to lines.slice(-12) and the synthesized head is null (no head prefix).
      povNoErrorLine: mod.formatError(
        new mod.PovrayError(
          'crash',
          -1,
          'POV-Ray wasm runtime aborted: out of memory\nstack unavailable\ndone'
        )
      ),
      // formatError abort voice.
      abortMsg: mod.formatError(new DOMException('stop', 'AbortError')),
      // formatError generic error WITH a message (the err.message side of `??`).
      genericMsg: mod.formatError(new Error('boom')),
      // formatError of a message-less value (the `?? err` fallback side).
      genericNoMsg: mod.formatError('plain string failure'),
      // formatError(PovrayError) with a `File '...' line N: Parse Error: ...`
      // line: the synthesized headline speaks that line once, so the excerpt
      // must DROP the original File line (head !== null && from+k === i) rather
      // than restate it as a second "File scene line N:" right below.
      dedupHead: mod.formatError(
        new mod.PovrayError(
          'parse',
          1,
          "some parsing notes\nFile '/work/scene.pov' line 4: Parse Error: Expected ; but found }\nRender failed"
        )
      ),
    };
  });
  assert.deepEqual(
    [helpers.noStats.traceSeconds, helpers.noStats.parseSeconds, helpers.noStats.rays],
    [undefined, undefined, undefined],
    'parseStats must return undefined for a log missing Trace/Parse/Rays lines'
  );
  assert.equal(helpers.headlineNoError, null, 'errorHeadline must be null with no error line');
  assert.equal(
    helpers.headlineFileAbove,
    'line 5 · Parse Error: Expected ; but found }',
    'errorHeadline must map a file ref that precedes the error line'
  );
  assert.equal(helpers.headlineNull, null, 'errorHeadline must be null without a file reference');
  assert.ok(
    helpers.povNoErrorLine.includes('out of memory') && !helpers.povNoErrorLine.startsWith('line'),
    'formatError must fall back to the log tail (no head) when there is no error line'
  );
  assert.equal(
    helpers.abortMsg,
    'render cancelled',
    'formatError must voice an AbortError as cancelled'
  );
  assert.equal(helpers.genericMsg, 'boom', 'formatError must surface a generic error message');
  assert.equal(
    helpers.genericNoMsg,
    'plain string failure',
    'formatError must stringify a message-less failure value'
  );
  // The headline is spoken exactly once; the original File line is de-duplicated
  // out of the excerpt (not restated below the headline).
  assert.match(
    helpers.dedupHead,
    /^line 4 · Parse Error: Expected ; but found }/,
    'formatError must lead with the synthesized headline'
  );
  assert.ok(
    !/File .*line 4:/.test(helpers.dedupHead),
    'formatError must drop the original File line once a headline restates it'
  );
  assert.equal(
    (helpers.dedupHead.match(/Parse Error/g) ?? []).length,
    1,
    'the parse error message must not appear twice (headline + restated File line)'
  );

  // A real (tiny) render with onProgress and no onEvent covers the onProgress
  // call + onEvent-absent branches. A second concurrent call proves the busy
  // backstop throw. wasm is already warm from the renders above, so this is
  // sub-second.
  const direct = await page.evaluate(async () => {
    const mod = await import('/render-client.js');
    const scene = [
      '#version 3.8;',
      'global_settings { assumed_gamma 1.0 }',
      'camera { location <0,0,-4> look_at 0 }',
      'light_source { <2,4,-3> rgb 1 }',
      'sphere { 0, 1 pigment { rgb <1,0,0> } }',
      '',
    ].join('\n');
    let progress = 0;
    const p = mod.renderScene(scene, {
      width: 32,
      height: 24,
      antialias: false,
      onProgress: () => {
        progress++;
      },
    });
    // p is now in flight (renderScene set busy synchronously before its await),
    // so this second call must hit the backstop and throw immediately.
    let busyThrew = false;
    try {
      await mod.renderScene(scene, { width: 8, height: 8, antialias: false });
    } catch (e) {
      busyThrew = /already in progress/.test(e.message);
    }
    const res = await p;
    const lean = await mod.renderScene(scene, {
      width: 16,
      height: 12,
      antialias: false,
      keepBytes: false,
    });
    const leanHasBytes = Object.hasOwn(lean, 'bytes');
    URL.revokeObjectURL(lean.blobUrl);
    const blob = res.blobUrl.startsWith('blob:');
    URL.revokeObjectURL(res.blobUrl);
    return {
      busyThrew,
      progress,
      busyAfter: mod.isBusy(),
      bytes: res.bytes.length,
      blob,
      leanHasBytes,
      logLen: res.log.length,
    };
  });
  assert.ok(direct.busyThrew, 'a second concurrent renderScene must throw the busy backstop');
  assert.ok(direct.progress > 0, 'onProgress must fire for a real render');
  assert.equal(direct.busyAfter, false, 'isBusy must clear after the render resolves');
  assert.ok(direct.bytes > 0 && direct.blob, 'direct render should resolve bytes + a blob url');
  assert.equal(direct.leanHasBytes, false, 'keepBytes:false should omit raw PNG bytes');
  assert.ok(direct.logLen > 0, 'direct render should carry a raw log');

  // --- render-client.js renderAnimation direct -------------------------------
  // A 3-frame clock animation through render-client covers the wrapper->client
  // frame fan-out (onEvent 'frame' + onFrame), the raw onProgress contract, the
  // blob/bitmap playback-asset build, elapsedMs, and busy set/clear. wasm is
  // warm from the renders above, so this is sub-second.
  const anim = await page.evaluate(async () => {
    const mod = await import('/render-client.js');
    const scene = [
      '#version 3.8;',
      'global_settings { assumed_gamma 1.0 }',
      'camera { location <0,0,-6> look_at 0 }',
      'light_source { <4,6,-5> rgb 1 }',
      'sphere { <clock,0,0>, 1 pigment { rgb <1,0,0> } }',
    ].join('\n');
    const events = [];
    const frameCalls = [];
    let progress = 0;
    const res = await mod.renderAnimation(scene, {
      width: 32,
      height: 24,
      antialias: false,
      frames: 3,
      initialClock: 0,
      finalClock: 1,
      onEvent: (ev) => events.push(ev.kind),
      onFrame: (i, t) => frameCalls.push([i, t]),
      onProgress: () => {
        progress++;
      },
    });
    const lean = await mod.renderAnimation(scene, {
      width: 16,
      height: 12,
      antialias: false,
      frames: 2,
      keepFrames: false,
    });
    const out = {
      count: res.frames.length,
      isPng: res.frames.every((b) => b[0] === 0x89 && b[1] === 0x50),
      blobUrls: res.blobUrls.every((u) => u.startsWith('blob:')),
      bitmapW: res.bitmaps[0].width,
      bitmapsAreImageBitmap: res.bitmaps.every((b) => b instanceof ImageBitmap),
      leanHasFrames: Object.hasOwn(lean, 'frames'),
      leanBlobUrls: lean.blobUrls.every((u) => u.startsWith('blob:')),
      leanBitmapW: lean.bitmaps[0].width,
      elapsed: typeof res.elapsedMs === 'number' && res.elapsedMs > 0,
      logLen: res.log.length,
      frameEvents: events.filter((k) => k === 'frame').length,
      frameCalls,
      progress,
      busyAfter: mod.isBusy(),
    };
    res.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    res.bitmaps.forEach((b) => b.close());
    lean.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    lean.bitmaps.forEach((b) => b.close());
    return out;
  });
  assert.equal(anim.count, 3, 'renderAnimation should return one PNG per frame');
  assert.ok(anim.isPng, 'each animation frame should be a PNG');
  assert.ok(anim.blobUrls, 'renderAnimation should hand back blob: playback URLs');
  assert.equal(anim.bitmapW, 32, 'bitmaps should match the render width');
  assert.equal(anim.leanHasFrames, false, 'keepFrames:false should omit raw PNG frame arrays');
  assert.ok(anim.leanBlobUrls, 'keepFrames:false should still hand back playback URLs');
  assert.equal(anim.leanBitmapW, 16, 'keepFrames:false should still hand back decoded bitmaps');
  assert.ok(anim.bitmapsAreImageBitmap, 'bitmaps should be ImageBitmaps');
  assert.ok(anim.elapsed, 'renderAnimation should report elapsedMs');
  assert.ok(anim.logLen > 0, 'renderAnimation should carry a raw log');
  assert.equal(anim.frameEvents, 3, 'onEvent should see one frame event per frame');
  assert.deepEqual(
    anim.frameCalls,
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ],
    'onFrame should fire per frame in order'
  );
  assert.ok(anim.progress > 0, 'onProgress should receive raw lines');
  assert.equal(anim.busyAfter, false, 'isBusy must clear after renderAnimation resolves');

  // Busy backstop + the absent-callback arms: a frames:1 call with no callbacks
  // started while a second renderAnimation is in flight must throw.
  const animBusy = await page.evaluate(async () => {
    const mod = await import('/render-client.js');
    const scene = [
      '#version 3.8;',
      'camera { location <0,0,-4> look_at 0 }',
      'light_source { <2,4,-3> rgb 1 }',
      'sphere { 0, 1 pigment { rgb <1,0,0> } }',
    ].join('\n');
    const p = mod.renderAnimation(scene, { width: 24, height: 18, antialias: false, frames: 1 });
    let busyThrew = false;
    try {
      await mod.renderAnimation(scene, { width: 8, height: 8, antialias: false, frames: 1 });
    } catch (e) {
      busyThrew = /already in progress/.test(e.message);
    }
    const res = await p;
    const count = res.frames.length;
    res.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    res.bitmaps.forEach((b) => b.close());
    return { busyThrew, count };
  });
  assert.ok(animBusy.busyThrew, 'a concurrent renderAnimation must throw the busy backstop');
  assert.equal(animBusy.count, 1, 'a single-frame animation should return one frame');

  // ===========================================================================
  // ui.js DOM-controller coverage: example switch + dirty guard, editor
  // mechanics, persistence restore, zoom, error path, status throttle, and the
  // render shortcuts. Everything below drives controller branches the happy +
  // cancel paths above never reach.
  // ===========================================================================

  const VALID_SCENE = [
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <5,5,-5> color rgb 1 }',
    'sphere { 0, 1 pigment { color rgb <1,0,0> } }',
  ].join('\n');
  const BROKEN_SCENE = [
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <5,5,-5> color rgb 1 }',
    'sphere { 0, 1 pigment { color BROKEN_NOPE } }',
  ].join('\n');

  const waitState = (s, t = 120_000) =>
    page.waitForFunction((st) => document.getElementById('status').dataset.state === st, s, {
      timeout: t,
    });
  const editorValue = () => page.evaluate(() => document.getElementById('editor').value);

  // --- zoom toggle (the kept 160x120 image from the cancel path is on screen) -
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return !o.hidden && o.naturalWidth === 160;
    },
    null,
    { timeout: 5_000 }
  );
  // A 160px image in a wider pane fits at 100%, where fit IS 1:1: the toggle
  // would be a no-op, so the chip hides and the image click is the pointer
  // path into 1:1.
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // updateZoomLabel fit path
  assert.equal(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').hidden),
    true,
    'the zoom chip hides while fit equals 100%'
  );
  await page.click('#output'); // clicking the image engages 1:1
  assert.equal(
    await page.evaluate(() => document.getElementById('output').classList.contains('zoom-1x')),
    true,
    'clicking the image should engage 1:1'
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const z = document.querySelector('#output-pane .zoom-toggle');
      return { hidden: z.hidden, text: z.textContent };
    }),
    { hidden: false, text: '1:1' },
    'the zoom chip shows, reading 1:1, while engaged'
  );
  await page.click('#output-pane .zoom-toggle'); // the cycle's next step: 4x
  assert.deepEqual(
    await page.evaluate(() => {
      const o = document.getElementById('output');
      return {
        cls4x: o.classList.contains('zoom-4x'),
        width: o.style.width,
        label: document.querySelector('#output-pane .zoom-toggle').textContent,
        pixelated: getComputedStyle(o).imageRendering,
      };
    }),
    { cls4x: true, width: '640px', label: '4×', pixelated: 'pixelated' },
    'the second zoom step is the 4x pixel-peep (4 x 160 natural, pixelated)'
  );
  await page.click('#output-pane .zoom-toggle'); // 4x cycles back to fit
  assert.deepEqual(
    await page.evaluate(() => {
      const o = document.getElementById('output');
      return { cls: o.className, width: o.style.width };
    }),
    { cls: '', width: '' },
    'the third click returns to fit, dropping both zoom classes and the width'
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').hidden),
    true,
    'back at a 100% fit the chip hides again'
  );

  // --- example browser: open / filter / navigate / select + dirty guard ------
  // The flat <select> is gone; the example picker is now an editable-combobox
  // popover (trigger + filter + grouped listbox + attribution footer). These
  // drive every controller branch the popover added.
  const browserExpanded = () =>
    page.evaluate(() => document.getElementById('example-trigger').getAttribute('aria-expanded'));
  const triggerName = () =>
    page.evaluate(() => document.getElementById('example-trigger').dataset.name);
  const galleryState = () =>
    page.evaluate(() => ({
      hidden: document.getElementById('gallery').hidden,
      focused: document.activeElement?.id,
      search: document.getElementById('gallery-search').value,
      license: document.getElementById('gallery-license').value,
      clearHidden: document.getElementById('gallery-clear').hidden,
      empty: document.getElementById('gallery-empty').hidden,
      browser: document.getElementById('example-trigger').getAttribute('aria-expanded'),
      shortcuts: document.getElementById('shortcuts').hidden,
    }));
  const visibleGalleryNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.gallery-card')]
        .filter((card) => !card.hidden)
        .map((card) => card.dataset.name)
    );
  const activeName = () =>
    page.evaluate(() => document.querySelector('.ex-option.is-active')?.dataset.name ?? null);
  // The roving item may be a HEAD or an OPTION; read its id off the search box's
  // aria-activedescendant (heads have no dataset.name).
  const activeDesc = () =>
    page.evaluate(() =>
      document.getElementById('example-search').getAttribute('aria-activedescendant')
    );
  const headExpanded = (key) =>
    page.evaluate((k) => document.getElementById(`exgrp-${k}`).getAttribute('aria-expanded'), key);
  const visibleNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.ex-option')]
        .filter((o) => !o.hidden && !o.closest('.ex-group').hidden)
        .map((o) => o.dataset.name)
    );
  const visibleCount = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('.ex-option')].filter(
          (o) => !o.hidden && !o.closest('.ex-group').hidden
        ).length
    );
  const expectedExampleNames = (filters) =>
    page.evaluate(async (f) => {
      const { groupByCategory } = await import('/examples.js');
      const bucket = (ex) =>
        ex.license === 'CC0-1.0'
          ? 'cc0'
          : ex.license === 'GPL-3.0-or-later'
            ? 'gpl'
            : 'share-alike';
      return groupByCategory().flatMap((g) =>
        g.items
          .filter((ex) => {
            const typeMatch =
              f.type === 'all' || (f.type === 'animated' ? ex.animated : !ex.animated);
            return (
              typeMatch &&
              (f.difficulty === 'all' || ex.difficulty === f.difficulty) &&
              (f.tier === 'all' || ex.renderTier === f.tier) &&
              (f.license === 'all' || bucket(ex) === f.license)
            );
          })
          .map((ex) => ex.name)
      );
    }, filters);
  const applyExampleFilters = async (filters) => {
    await page.selectOption('#example-type', filters.type);
    await page.selectOption('#example-difficulty', filters.difficulty);
    await page.selectOption('#example-tier', filters.tier);
    await page.selectOption('#example-license', filters.license);
  };
  const assertFilteredExamples = async (filters, message) => {
    await applyExampleFilters(filters);
    const expected = await expectedExampleNames(filters);
    await page.waitForFunction(
      (names) =>
        JSON.stringify(
          [...document.querySelectorAll('.ex-option')]
            .filter((o) => !o.hidden && !o.closest('.ex-group').hidden)
            .map((o) => o.dataset.name)
        ) === JSON.stringify(names),
      expected,
      { timeout: 5_000 }
    );
    assert.deepEqual(await visibleNames(), expected, message);
  };
  const groupHidden = (key) =>
    page.evaluate((k) => document.getElementById(`exgrp-${k}`).parentElement.hidden, key);
  const focusSearch = () => page.evaluate(() => document.getElementById('example-search').focus());
  const openBrowser = async () => {
    await page.click('#example-trigger');
    await page.waitForFunction(
      () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 5_000 }
    );
  };
  // The panel opens compact (accordion): a target category may be collapsed, so
  // expand its head before the option is clickable.
  const clickOption = async (name) => {
    await page.evaluate((n) => {
      const head = document
        .getElementById(`ex-opt-${n}`)
        .closest('.ex-group')
        .querySelector('.ex-group-head');
      if (head.getAttribute('aria-expanded') !== 'true') head.click();
    }, name);
    await page.click(`.ex-option[data-name="${name}"]`);
  };
  const switchExample = async (name) => {
    await openBrowser();
    await clickOption(name);
    await page.waitForFunction(
      (n) => document.getElementById('example-trigger').dataset.name === n,
      name,
      { timeout: 5_000 }
    );
  };

  // Open via click: the panel shows, focus moves to the search, the loaded scene
  // (csg-die) is the active roving option, and the footer reads its '' -source
  // attribution with the link hidden. (openBrowser, renderList, setActive
  // first-call (no prior active) + updateAttribution.)
  await openBrowser();
  assert.equal(await activeName(), 'csg-die', 'opening focuses the loaded scene');
  assert.deepEqual(
    await page.evaluate(() => ({
      focused: document.activeElement?.id,
      aria: document.querySelector('.ex-option.is-active')?.getAttribute('aria-selected'),
      loaded: document.querySelector('.ex-option[data-loaded="true"]')?.dataset.name,
      thumb: document
        .querySelector('.ex-option[data-name="csg-die"] .ex-thumb')
        ?.getAttribute('src'),
      thumbW: document
        .querySelector('.ex-option[data-name="csg-die"] .ex-thumb')
        ?.getAttribute('width'),
      attr: document.querySelector('#example-attribution .ex-attr-text').textContent,
      srcHidden: document.querySelector('#example-attribution .ex-attr-src').hidden,
    })),
    {
      focused: 'example-search',
      aria: 'true',
      loaded: 'csg-die',
      thumb: 'example-thumbnails/csg-die.png',
      thumbW: '64',
      attr: 'by povrayer · CC0-1.0',
      srcHidden: true,
    },
    'open focuses search, marks the loaded option active, shows a thumbnail and CC0 attribution'
  );

  const modelingNames = await page.evaluate(async () => {
    const { groupByCategory } = await import('/examples.js');
    return groupByCategory()
      .find((g) => g.key === 'modeling')
      .items.map((e) => e.name);
  });
  const modelingCount = modelingNames.length;

  // open-collapses-others: the accordion opens COMPACT. Only the loaded scene's
  // category (Solid Modeling) is expanded; every other category is collapsed, so
  // the panel shows that category's rows, not a full-library wall. Each head
  // carries a scene-count chip matching its category size.
  assert.deepEqual(
    await page.evaluate(() => ({
      expanded: [...document.querySelectorAll('.ex-group-head')]
        .filter((h) => h.getAttribute('aria-expanded') === 'true')
        .map((h) => h.id),
      visible: [...document.querySelectorAll('.ex-option')]
        .filter((o) => !o.hidden && !o.closest('.ex-group').hidden)
        .map((o) => o.dataset.name),
    })),
    {
      expanded: ['exgrp-modeling'],
      visible: modelingNames,
    },
    'opening collapses every category except the loaded scene’s (compact panel)'
  );
  assert.ok(
    await page.evaluate(async () => {
      const { groupByCategory } = await import('/examples.js');
      const expected = groupByCategory().map((g) => String(g.items.length));
      const rendered = [...document.querySelectorAll('.ex-group-head .ex-group-count')].map(
        (c) => c.textContent
      );
      return expected.length === 9 && JSON.stringify(expected) === JSON.stringify(rendered);
    }),
    'every category head shows a scene-count chip matching its size'
  );

  // click-head-toggle: clicking a collapsed head expands that category (its rows
  // appear) and ropes the roving onto the head; a second click collapses it. The
  // toggle leaves every OTHER category alone.
  await page.click('#exgrp-implicit');
  await page.waitForFunction(
    () => document.getElementById('exgrp-implicit').getAttribute('aria-expanded') === 'true',
    null,
    { timeout: 5_000 }
  );
  assert.ok((await visibleNames()).includes('blobs'), 'expanding a head reveals its rows');
  assert.equal(await activeDesc(), 'exgrp-implicit', 'a head click ropes the roving onto the head');
  assert.equal(await headExpanded('modeling'), 'true', 'toggling one head leaves the others alone');
  await page.click('#exgrp-implicit');
  await page.waitForFunction(
    () => document.getElementById('exgrp-implicit').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  assert.ok(!(await visibleNames()).includes('blobs'), 'a second click collapses the head');

  // search auto-expand: while the filter is non-empty, collapse state is ignored.
  // Typing "modeling" surfaces the whole Solid Modeling group (every row matches
  // the category label) and hides every non-matching head; #example-empty stays
  // hidden while anything matches. Real typing also runs the search keydown
  // handler's non-navigation default arms.
  await page.type('#example-search', 'modeling');
  await page.waitForFunction(
    (count) =>
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === count && document.getElementById('exgrp-implicit').parentElement.hidden,
    modelingCount,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await visibleNames(),
    modelingNames,
    'filtering "modeling" shows exactly the Solid Modeling group'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('example-clear').hidden),
    false,
    'typing a filter shows the clear button'
  );
  await page.click('#example-clear');
  await page.waitForFunction(
    (count) =>
      document.getElementById('example-search').value === '' &&
      document.getElementById('example-clear').hidden &&
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === count,
    modelingCount,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await visibleNames(),
    modelingNames,
    'clear restores the compact unfiltered list'
  );

  // structured filters: animation / difficulty / render cost / license all use
  // the same auto-expand path as text search, and the clear button resets them
  // as one filter set.
  await assertFilteredExamples(
    { type: 'animated', difficulty: 'all', tier: 'all', license: 'all' },
    'the animation filter shows only animated examples'
  );
  await assertFilteredExamples(
    { type: 'still', difficulty: 'advanced', tier: 'heavy', license: 'all' },
    'combined still + difficulty + render-cost filters intersect cleanly'
  );
  await assertFilteredExamples(
    { type: 'all', difficulty: 'all', tier: 'all', license: 'share-alike' },
    'the license filter surfaces adapted share-alike examples'
  );
  await assertFilteredExamples(
    { type: 'all', difficulty: 'all', tier: 'all', license: 'gpl' },
    'the license filter surfaces GPL examples'
  );
  await assertFilteredExamples(
    { type: 'all', difficulty: 'all', tier: 'all', license: 'cc0' },
    'the license filter surfaces first-party CC0 examples'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('example-clear').hidden),
    false,
    'a structured filter shows the clear button'
  );
  await page.click('#example-clear');
  await page.waitForFunction(
    (count) =>
      document.getElementById('example-type').value === 'all' &&
      document.getElementById('example-difficulty').value === 'all' &&
      document.getElementById('example-tier').value === 'all' &&
      document.getElementById('example-license').value === 'all' &&
      document.getElementById('example-clear').hidden &&
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === count,
    modelingCount,
    { timeout: 5_000 }
  );

  await page.type('#example-search', 'modeling');
  await page.waitForFunction(
    (count) =>
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === count,
    modelingCount,
    { timeout: 5_000 }
  );
  assert.equal(await groupHidden('modeling'), false, 'the matched group stays visible');
  assert.equal(await groupHidden('implicit'), true, 'an unmatched group head hides');
  assert.equal(
    await page.evaluate(() => document.getElementById('example-empty').hidden),
    true,
    'the empty-state stays hidden while options match'
  );

  // empty-state-only-while-searching: a no-match query is the ONLY time
  // #example-empty shows (never merely because categories are collapsed). The
  // active item clears, and ArrowDown / ArrowLeft / Space / Enter are all
  // clamp/no-ops with nothing matching (no active item to act on).
  await page.fill('#example-search', 'zzz-no-match');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === 0 && !document.getElementById('example-empty').hidden,
    null,
    { timeout: 5_000 }
  );
  assert.equal(await activeName(), null, 'a no-match filter clears the active option');
  assert.equal(await activeDesc(), '', 'a no-match filter clears aria-activedescendant');
  await focusSearch();
  await page.keyboard.press('ArrowDown'); // moveActiveTo empty-guard
  await page.keyboard.press('ArrowLeft'); // isHead(null) + activeItem-null arms
  await page.keyboard.press('Space'); // isHead(null) -> types, still no match
  await page.keyboard.press('Enter'); // no active -> no select
  assert.equal(await browserExpanded(), 'true', 'an empty-filter Enter must not select or close');
  assert.equal(await triggerName(), 'csg-die', 'an empty-filter Enter must not load anything');

  // restore-on-clear: clearing the search restores the prior collapse state (the
  // search auto-expand was temporary), so only Solid Modeling is expanded again,
  // its five rows show, and csg-die is the active row.
  await page.fill('#example-search', '');
  await page.waitForFunction(
    (count) =>
      [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      ).length === count &&
      document.getElementById('exgrp-modeling').getAttribute('aria-expanded') === 'true' &&
      document.getElementById('exgrp-implicit').getAttribute('aria-expanded') === 'false' &&
      document.querySelector('.ex-option.is-active')?.dataset.name === 'csg-die',
    modelingCount,
    { timeout: 5_000 }
  );

  // restore-on-clear survives a SECOND manual expand: expand another category,
  // run a search that matches neither, then clear. Both manually-expanded
  // categories come back expanded (collapse state is preserved across a search).
  await page.click('#exgrp-optics'); // modeling + optics now expanded
  await page.waitForFunction(
    () => document.getElementById('exgrp-optics').getAttribute('aria-expanded') === 'true',
    null,
    { timeout: 5_000 }
  );
  await page.fill('#example-search', 'lighting'); // matches only the Lighting group
  await page.waitForFunction(
    () =>
      document.getElementById('exgrp-modeling').parentElement.hidden &&
      [...document.querySelectorAll('.ex-option')].some(
        (o) => !o.hidden && o.dataset.name === 'cornell-mood'
      ),
    null,
    { timeout: 5_000 }
  );
  assert.equal(await groupHidden('modeling'), true, 'a non-matching category hides during search');
  await page.fill('#example-search', '');
  await page.waitForFunction(
    () =>
      document.getElementById('exgrp-modeling').getAttribute('aria-expanded') === 'true' &&
      document.getElementById('exgrp-optics').getAttribute('aria-expanded') === 'true' &&
      document.getElementById('exgrp-lighting').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );

  // keyboard accordion nav: collapse the extra category so only Solid Modeling is
  // expanded, then walk the heads + rows by keyboard (focus stays on the search;
  // navigation is driven by aria-activedescendant).
  await page.click('#exgrp-optics'); // optics back to collapsed
  await page.waitForFunction(
    () => document.getElementById('exgrp-optics').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  await focusSearch();
  await page.keyboard.press('Home'); // first nav item: the first category head
  assert.equal(await activeDesc(), 'exgrp-modeling', 'Home lands on the first nav item (a head)');
  await page.keyboard.press('ArrowUp'); // clamp at the top, no wrap
  assert.equal(await activeDesc(), 'exgrp-modeling', 'ArrowUp clamps at the first nav item');
  await page.keyboard.press('ArrowDown'); // head -> its first row
  assert.equal(await activeName(), 'csg-die', 'ArrowDown from a head enters its first row');
  await page.keyboard.press('ArrowDown'); // row -> next row
  assert.equal(await activeName(), 'steinmetz', 'ArrowDown walks the rows');
  await page.keyboard.press('ArrowLeft'); // row -> its category head
  assert.equal(await activeDesc(), 'exgrp-modeling', 'ArrowLeft on a row jumps to its head');
  await page.keyboard.press('ArrowLeft'); // expanded head -> collapse
  assert.equal(await headExpanded('modeling'), 'false', 'ArrowLeft collapses an expanded head');
  assert.equal(await visibleCount(), 0, 'collapsing the only expanded category hides every row');
  await page.keyboard.press('ArrowRight'); // collapsed head -> expand
  assert.equal(await headExpanded('modeling'), 'true', 'ArrowRight expands a collapsed head');
  assert.equal(await visibleCount(), modelingCount, 'expanding restores the category rows');
  await page.keyboard.press('ArrowDown'); // head -> csg-die
  await page.keyboard.press('ArrowRight'); // ArrowRight on a row is a no-op
  assert.equal(await activeName(), 'csg-die', 'ArrowRight on a row does nothing');
  assert.equal(await headExpanded('modeling'), 'true', 'ArrowRight on a row toggles nothing');

  // Enter and Space on a head expand it (matching ArrowRight); collapse via
  // ArrowLeft first so the expand is observable.
  await page.keyboard.press('ArrowLeft'); // csg-die -> head
  await page.keyboard.press('ArrowLeft'); // collapse
  assert.equal(await headExpanded('modeling'), 'false', 'pre-Enter: modeling is collapsed');
  await page.keyboard.press('Enter'); // head Enter -> expand
  assert.equal(await headExpanded('modeling'), 'true', 'Enter on a collapsed head expands it');
  await page.keyboard.press('ArrowLeft'); // collapse again
  await page.keyboard.press('Space'); // head Space -> expand
  assert.equal(await headExpanded('modeling'), 'true', 'Space on a collapsed head expands it');

  // Home/End jump across the full visible nav list (heads + the expanded rows);
  // ArrowDown clamps at the last item (the last category head).
  await page.keyboard.press('End');
  assert.equal(await activeDesc(), 'exgrp-motion', 'End jumps to the last nav item (last head)');
  await page.keyboard.press('ArrowDown'); // clamp at the bottom, no wrap
  assert.equal(await activeDesc(), 'exgrp-motion', 'ArrowDown clamps at the last nav item');
  await page.keyboard.press('Home');
  assert.equal(await activeDesc(), 'exgrp-modeling', 'Home jumps back to the first nav item');

  // Select an animated scene via Enter on its active option: the panel closes,
  // focus returns to the trigger, and the clock autoset prefills frames/fps.
  // When quality is still automatic, the example's fast-render tier preselects
  // a concrete quality value.
  // (commitOption, selectExample pristine path, applyExampleClock animated arm,
  // closeBrowser(returnFocus=true), setTriggerLabel re-mark.)
  await selAdvanced('#quality', '');
  await page.fill('#example-search', 'orbit');
  await page.waitForFunction(
    () => {
      const v = [...document.querySelectorAll('.ex-option')].filter(
        (o) => !o.hidden && !o.closest('.ex-group').hidden
      );
      return v.length === 1 && v[0].dataset.name === 'orbit-moons';
    },
    null,
    { timeout: 5_000 }
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').dataset.name === 'orbit-moons',
    null,
    { timeout: 5_000 }
  );
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );
  assert.equal(await browserExpanded(), 'false', 'selecting an option closes the panel');
  assert.deepEqual(
    await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
      quality: document.getElementById('quality').value,
      focused: document.activeElement?.id,
      label: document.getElementById('example-trigger-text').textContent,
      draftPending: window.__liveDraftProbe().pending,
      draftInFlight: window.__liveDraftProbe().inFlight,
    })),
    {
      mode: 'still',
      frames: '24',
      fps: '24',
      quality: '7',
      focused: 'example-trigger',
      label: 'Orbit (two moons, clock-driven)',
      draftPending: false,
      draftInFlight: false,
    },
    'an animated example prepares animation settings without selecting animate or drafting'
  );
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value += '\n// animated examples stay explicit\n';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await page.evaluate(async () => (await import('/render-client.js')).isBusy()),
    false,
    'editing an animated example must cancel auto-preview instead of drafting'
  );
  await page.evaluate(async () => {
    const { getExample } = await import('/examples.js');
    document.getElementById('editor').value = getExample('orbit-moons');
  });

  await switchExample('julia-fractal');
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await page.evaluate(async () => ({
      trigger: document.getElementById('example-trigger').dataset.name,
      busy: (await import('/render-client.js')).isBusy(),
      pending: window.__liveDraftProbe().pending,
      inFlight: window.__liveDraftProbe().inFlight,
    })),
    {
      trigger: 'julia-fractal',
      busy: false,
      pending: false,
      inFlight: false,
    },
    'a pristine heavy still example must not auto-preview'
  );
  const HEAVY_EDIT_SCENE = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <2,4,-3> rgb 1 }',
    'sphere { 0, 1 pigment { rgb <1,0,0> } }',
    '',
  ].join('\n');
  await setSceneSource(HEAVY_EDIT_SCENE);
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        /^preview ready · /.test(document.getElementById('status').textContent) &&
        !d.inFlight
      );
    },
    null,
    { timeout: 60_000 }
  );
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().inFlight),
    false,
    'editing a heavy still example allows live preview again'
  );
  await page.evaluate(async () => {
    const { getExample } = await import('/examples.js');
    const ed = document.getElementById('editor');
    ed.value = getExample('julia-fractal');
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );

  // Loading a STILL example must leave dialed-in frames/fps untouched (the
  // applyExampleClock early-return), and a manually-set quality must not be
  // overwritten by the example tier. This exercises the click-select path.
  // The animate-only inputs are hidden in still mode, so seed them directly.
  await selAdvanced('#quality', '8');
  await page.evaluate(() => {
    document.getElementById('frames').value = '7';
    document.getElementById('fps').value = '9';
  });
  await switchExample('csg-die');
  assert.deepEqual(
    await page.evaluate(() => ({
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
      quality: document.getElementById('quality').value,
    })),
    { frames: '7', fps: '9', quality: '8' },
    'loading a still example must not touch frames/fps or an explicit quality'
  );

  // High-fidelity examples rely on ray features stripped by the old +Q5 tier:
  // glass loses refraction, and radiosity scenes lose their color bounce. When
  // quality is still automatic, selecting one should preselect the heavy tier.
  await selAdvanced('#quality', '');
  await switchExample('glass');
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('quality').value),
    '8',
    'loading the glass example from auto quality selects the heavy tier'
  );
  await selAdvanced('#quality', '');
  await switchExample('cornell-mood');
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('quality').value),
    '8',
    'loading the cornell radiosity example from auto quality selects the heavy tier'
  );
  await selAdvanced('#quality', '');
  await switchExample('csg-die');
  // Unlike the heavy examples above (which never auto-draft), this wait blocks
  // on a real draft render completing, so it gets the long render timeout.
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return !d.pending && !d.inFlight;
    },
    null,
    { timeout: 60_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('quality').value),
    '7',
    'loading a fast-tier example from auto quality selects q7'
  );

  // A second trigger click closes an open panel (the toggle's close arm).
  await openBrowser();
  await page.click('#example-trigger');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );

  // Open via ArrowDown on the focused trigger (the trigger keydown handler),
  // then Escape closes and returns focus to the trigger (closeBrowser focus arm
  // + the focusout already-closed guard fires on the focus handoff).
  await page.evaluate(() => document.getElementById('example-trigger').focus());
  await page.keyboard.press('ArrowDown');
  assert.equal(await browserExpanded(), 'true', 'ArrowDown on the trigger opens the panel');
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'example-trigger',
    'Escape returns focus to the trigger'
  );

  // Open via Enter on the focused trigger: its keydown handler sees a
  // non-ArrowDown key (the default arm) and the native button click opens.
  await page.evaluate(() => document.getElementById('example-trigger').focus());
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'true',
    null,
    { timeout: 5_000 }
  );

  // Click delegation: a head click toggles its category (covered above); a click
  // that lands on NEITHER a head nor an option (listbox padding / the empty note)
  // selects nothing and keeps the panel open (the opt-null return arm).
  const beforeStrayClick = await triggerName();
  await page.evaluate(() => {
    document
      .getElementById('example-listbox')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  assert.equal(await browserExpanded(), 'true', 'a stray listbox click keeps the panel open');
  assert.equal(await triggerName(), beforeStrayClick, 'a stray listbox click loads nothing');

  // A focusout that stays inside the panel keeps it open; one that leaves the
  // subtree closes it. (focusout contains(relatedTarget) both arms.)
  await page.evaluate(() => {
    const b = document.getElementById('example-browser');
    const s = document.getElementById('example-search');
    b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: s, bubbles: true }));
  });
  assert.equal(await browserExpanded(), 'true', 'a focus move within the panel keeps it open');
  await page.evaluate(() => {
    const b = document.getElementById('example-browser');
    const ed = document.getElementById('editor');
    b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: ed, bubbles: true }));
  });
  assert.equal(await browserExpanded(), 'false', 'a focus move out of the panel closes it');

  // Outside pointerdown closes WITHOUT stealing focus back to the trigger.
  await openBrowser();
  await page.evaluate(() =>
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  );
  assert.equal(await browserExpanded(), 'false', 'an outside pointerdown closes the panel');
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.id),
    'example-trigger',
    'an outside pointerdown must not force focus back to the trigger'
  );

  // Example gallery: a visual, modal way to browse the same examples. It opens
  // independently of the compact picker, reuses the same filter semantics, and
  // selects through the same example-loading path.
  await openBrowser();
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('.gallery-card').length),
    0,
    'gallery cards are built lazily on first open'
  );
  await page.click('#gallery-btn');
  await page.waitForFunction(
    () =>
      !document.getElementById('gallery').hidden &&
      document.getElementById('example-trigger').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  const galleryOpen = await page.evaluate(async () => {
    const { EXAMPLES } = await import('/examples.js');
    const first = document.querySelector('.gallery-card[data-name="csg-die"] img');
    return {
      count: [...document.querySelectorAll('.gallery-card')].length,
      loaded: document.querySelector('.gallery-card[data-loaded="true"]')?.dataset.name,
      focused: document.activeElement?.id,
      img: first.getAttribute('src'),
      imgW: first.getAttribute('width'),
      expected: EXAMPLES.length,
    };
  });
  assert.equal(galleryOpen.count, galleryOpen.expected, 'gallery renders one card per example');
  assert.deepEqual(
    galleryOpen,
    {
      count: galleryOpen.expected,
      loaded: 'csg-die',
      focused: 'gallery-search',
      img: 'example-thumbnails/csg-die.png',
      imgW: '160',
      expected: galleryOpen.expected,
    },
    'gallery opens with search focused and marks the loaded example'
  );
  await page.hover('.gallery-card[data-name="csg-die"]');
  assert.deepEqual(
    await page.evaluate(() => {
      const card = document.querySelector('.gallery-card[data-name="csg-die"]');
      const cs = getComputedStyle(card);
      return {
        background: cs.backgroundColor,
        border: cs.borderTopColor,
        color: cs.color,
      };
    }),
    {
      background: 'rgb(11, 13, 16)',
      border: 'rgb(96, 106, 122)',
      color: 'rgb(215, 219, 224)',
    },
    'gallery hover keeps the card dark and uses a neutral loaded border'
  );
  await page.keyboard.press('?');
  assert.equal((await galleryState()).shortcuts, true, '? is ignored while the gallery is open');
  await page.keyboard.press('Control+k');
  assert.equal(
    (await galleryState()).browser,
    'false',
    'Ctrl+K is ignored while the gallery owns the screen'
  );
  await page.fill('#gallery-search', 'sombrero');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.gallery-card')]
        .filter((card) => !card.hidden)
        .map((card) => card.dataset.name)
        .join(',') === 'sourced-sombrero',
    null,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await visibleGalleryNames(),
    ['sourced-sombrero'],
    'gallery search narrows cards'
  );
  await page.selectOption('#gallery-license', 'gpl');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.gallery-card')].filter((card) => !card.hidden).length === 0 &&
      !document.getElementById('gallery-empty').hidden,
    null,
    { timeout: 5_000 }
  );
  await page.evaluate(() =>
    document
      .getElementById('gallery-grid')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  );
  assert.equal((await galleryState()).hidden, false, 'a stray gallery-grid click loads nothing');
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await galleryState(),
    {
      hidden: true,
      focused: 'gallery-btn',
      search: 'sombrero',
      license: 'gpl',
      clearHidden: false,
      empty: false,
      browser: 'false',
      shortcuts: true,
    },
    'Esc closes the gallery, preserves filters, and returns focus'
  );
  await page.click('#gallery-btn');
  assert.deepEqual(
    await galleryState(),
    {
      hidden: false,
      focused: 'gallery-search',
      search: 'sombrero',
      license: 'gpl',
      clearHidden: false,
      empty: false,
      browser: 'false',
      shortcuts: true,
    },
    'reopening keeps the gallery filters from the current session'
  );
  await page.click('#gallery-clear');
  await page.waitForFunction(
    () =>
      document.getElementById('gallery-search').value === '' &&
      document.getElementById('gallery-license').value === 'all' &&
      document.getElementById('gallery-clear').hidden &&
      document.getElementById('gallery-empty').hidden,
    null,
    { timeout: 5_000 }
  );
  await page.fill('#gallery-search', 'wine glass');
  await page.click('.gallery-card[data-name="sourced-wineglass"]');
  await page.waitForFunction(
    () =>
      document.getElementById('gallery').hidden &&
      document.getElementById('example-trigger').dataset.name === 'sourced-wineglass',
    null,
    { timeout: 5_000 }
  );
  assert.equal(await triggerName(), 'sourced-wineglass', 'clicking a gallery card loads it');

  await page.click('#gallery-btn');
  await page.fill('#gallery-search', 'crystal cluster');
  await page.click('.gallery-card[data-name="sourced-crystal"]');
  await page.waitForFunction(
    () =>
      document.getElementById('gallery').hidden &&
      document.getElementById('example-trigger').dataset.name === 'sourced-crystal',
    null,
    { timeout: 5_000 }
  );
  await openBrowser();
  assert.deepEqual(
    await page.evaluate(() => ({
      active: document.querySelector('.ex-option.is-active')?.dataset.name ?? null,
      loaded: document.querySelector('.ex-option[data-loaded="true"]')?.dataset.name ?? null,
      attr: document.querySelector('#example-attribution .ex-attr-text').textContent,
      source: document.querySelector('#example-attribution .ex-attr-src').href,
    })),
    {
      active: null,
      loaded: null,
      attr: 'by Dan Farmer · CC-BY-3.0',
      source:
        'https://github.com/POV-Ray/povray/blob/master/distribution/scenes/interior/crystal.pov',
    },
    'a gallery-only selection can reopen the compact picker without a featured row'
  );
  await page.keyboard.press('Escape');

  // Pristine editor (=== the loaded scene) switches with no confirm.
  await switchExample('blobs');
  assert.ok((await editorValue()).length > 0, 'switching example should load its source');
  assert.deepEqual(
    await page.evaluate(() => ({
      state: document.getElementById('scene-dirty').textContent,
      dirty: document.getElementById('scene-dirty').dataset.dirty,
      resetDisabled: document.getElementById('reset-scene-btn').disabled,
    })),
    { state: 'current', dirty: 'false', resetDisabled: true },
    'a freshly loaded example is marked current and cannot be reset'
  );

  // Editor affordances: a typed edit flips the dirty state, Copy Scene copies
  // the raw source, Reset restores the loaded example through the same undoable
  // replacement path as a drop/history load, and Restore brings the edit back.
  await page.fill('#editor', 'EDITED scene one');
  assert.deepEqual(
    await page.evaluate(() => ({
      state: document.getElementById('scene-dirty').textContent,
      dirty: document.getElementById('scene-dirty').dataset.dirty,
      resetDisabled: document.getElementById('reset-scene-btn').disabled,
    })),
    { state: 'modified', dirty: 'true', resetDisabled: false },
    'editing marks the scene modified and enables reset'
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#copy-scene-btn');
  await page.waitForFunction(
    () => document.getElementById('copy-scene-btn').textContent === 'Copied'
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    'EDITED scene one',
    'Copy Scene copies the editor source'
  );
  await page.click('#reset-scene-btn');
  assert.notEqual(
    await editorValue(),
    'EDITED scene one',
    'Reset restores the loaded example source'
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      state: document.getElementById('scene-dirty').textContent,
      dirty: document.getElementById('scene-dirty').dataset.dirty,
      resetDisabled: document.getElementById('reset-scene-btn').disabled,
      restoreHidden: document.getElementById('restore-note').hidden,
    })),
    { state: 'current', dirty: 'false', resetDisabled: true, restoreHidden: false },
    'reset returns to current and offers restore'
  );
  await page.click('#restore-btn');
  assert.equal(await editorValue(), 'EDITED scene one', 'restore after reset brings the edit back');
  assert.equal(
    await page.evaluate(() => document.getElementById('scene-dirty').textContent),
    'modified',
    'restoring the edit marks the scene modified again'
  );

  // Edited editor + confirm() rejected -> keep the edit, the panel still closes,
  // and the loaded scene is unchanged. (selectExample dirty-guard reject arm.)
  await page.evaluate(() => {
    window.confirm = () => false;
  });
  await openBrowser();
  await clickOption('glass'); // glass is in a (collapsed) other category; expand then click
  await page.waitForFunction(
    () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await editorValue(),
    'EDITED scene one',
    'a rejected example switch must keep the edited editor'
  );
  assert.equal(await triggerName(), 'blobs', 'a rejected switch must not change the loaded scene');

  // Edited editor + confirm() accepted -> stash the edit (in memory), offer to
  // restore it, and load the new example.
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await switchExample('glass');
  assert.notEqual(
    await editorValue(),
    'EDITED scene one',
    'an accepted example switch must replace the editor with the new example'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('restore-note').hidden),
    false,
    'an accepted switch offers to restore the replaced edit'
  );

  // Clicking restore brings the replaced edit back and dismisses the offer.
  await page.click('#restore-btn');
  assert.equal(await editorValue(), 'EDITED scene one', 'restore puts the replaced edit back');
  assert.equal(
    await page.evaluate(() => document.getElementById('restore-note').hidden),
    true,
    'restoring dismisses the offer'
  );

  // A fresh edit (not a restore) also dismisses a pending restore offer.
  await page.fill('#editor', 'EDITED scene two');
  await switchExample('blobs'); // accepted -> stashes again, re-shows the offer
  assert.equal(
    await page.evaluate(() => document.getElementById('restore-note').hidden),
    false,
    'a second accepted switch re-offers restore'
  );
  await page.fill('#editor', 'typing past the offer');
  assert.equal(
    await page.evaluate(() => document.getElementById('restore-note').hidden),
    true,
    'a fresh edit dismisses the restore offer'
  );

  // --- editor mechanics: Tab indent/outdent, Escape trap, scroll, blur -------
  const setEditor = (value, a, b) =>
    page.evaluate(
      (args) => {
        const ed = document.getElementById('editor');
        ed.value = args.value;
        ed.focus();
        ed.setSelectionRange(args.a, args.b);
      },
      { value, a, b }
    );

  // Caret (no selection): Tab inserts two spaces.
  await setEditor('aaa\nbbb\nccc', 3, 3);
  await page.keyboard.press('Tab');
  assert.ok(
    (await editorValue()).startsWith('aaa  '),
    'Tab with no selection should insert two spaces'
  );

  // Single-line selection (no newline): Tab replaces it with two spaces.
  await setEditor('hello world', 2, 5);
  await page.keyboard.press('Tab');
  assert.ok(
    (await editorValue()).startsWith('he  '),
    'Tab over a single-line selection indents inline'
  );

  // Multi-line selection: Tab indents every selected line.
  await setEditor('aaa\nbbb\nccc', 0, 7);
  await page.keyboard.press('Tab');
  assert.ok(
    (await editorValue()).startsWith('  aaa\n  bbb'),
    'Tab over a multi-line selection should indent each line'
  );

  // Multi-line selection with leading spaces: Shift+Tab outdents each line.
  await setEditor('  aaa\n  bbb\nccc', 0, 11);
  await page.keyboard.press('Shift+Tab');
  assert.ok(
    (await editorValue()).startsWith('aaa\nbbb'),
    'Shift+Tab over a multi-line selection should outdent each line'
  );

  // Single indented line, caret only: Shift+Tab outdents that line (preserve).
  await setEditor('  aaa\nbbb', 3, 3);
  await page.keyboard.press('Shift+Tab');
  assert.ok((await editorValue()).startsWith('aaa\n'), 'Shift+Tab should outdent the caret line');

  // Line with no leading space: Shift+Tab is a no-op (out === block early return).
  await setEditor('ccc\nddd', 1, 1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await editorValue(), 'ccc\nddd', 'Shift+Tab on an unindented line is a no-op');

  // The Esc-then-Tab escape hatch is discoverable in the a11y tree: the editor
  // is described by a visually-hidden (sr-only, but present) help span that
  // names it, so a screen-reader user isn't silently trapped by Tab-indents.
  assert.deepEqual(
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      const help = document.getElementById('editor-tabhelp');
      const cs = getComputedStyle(help);
      return {
        describedBy: ed.getAttribute('aria-describedby'),
        // Collapse the source-wrap whitespace the way a screen reader announces it.
        helpText: help.textContent.replace(/\s+/g, ' ').trim(),
        // sr-only: off-screen but NOT display:none (still in the a11y tree).
        clipped: cs.position === 'absolute' && cs.width === '1px',
        visible: cs.display !== 'none',
      };
    }),
    {
      describedBy: 'editor-tabhelp',
      helpText:
        'Tab indents the line. Press Escape, then Tab (or Shift+Tab) to move focus out of the editor. Ctrl+Space lists completions. Alt+drag a number to scrub its value.',
      clipped: true,
      visible: true,
    },
    'the editor must reference an sr-only Esc-then-Tab help span via aria-describedby'
  );

  // Escape primes the focus escape; the next Tab moves focus instead of indenting.
  await setEditor('keep\nme', 2, 2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await editorValue(), 'keep\nme', 'Escape-then-Tab should move focus, not indent');

  // A non-Shift key clears the escape prime; Shift alone leaves it untouched.
  await page.evaluate(() => document.getElementById('editor').focus());
  await page.keyboard.press('Escape');
  await page.keyboard.press('x'); // key !== Shift -> clears prime
  await page.keyboard.press('Shift'); // key === Shift -> prime untouched

  // scroll handler syncs the gutter; blur clears the escape prime.
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = Array.from({ length: 60 }, (_, i) => 'line ' + i).join('\n');
    ed.dispatchEvent(new Event('input'));
    ed.scrollTop = 40;
    ed.dispatchEvent(new Event('scroll'));
    ed.blur();
  });

  // --- non-isolated bail inside startRender ----------------------------------
  await page.evaluate(() => {
    document.getElementById('iso-warning').hidden = true;
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => false });
  });
  await page.click('#render-btn'); // startRender bails before any render begins
  assert.equal(
    await page.evaluate(() => document.getElementById('iso-warning').hidden),
    false,
    'a non-isolated render attempt must surface the iso warning'
  );
  await page.evaluate(() => {
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => true });
    document.getElementById('iso-warning').hidden = true;
  });

  // --- success with full opts: mobile viewport, quality+aa+threads, shortcut --
  await page.setViewportSize({ width: 480, height: 900 });
  await page.fill('#editor', VALID_SCENE);
  await page.fill('#width', '64');
  await page.fill('#height', '48');
  await selAdvanced('#quality', '8'); // 8 is the highest explicit quality option
  await selAdvanced('#antialias', '0.3');
  await fillAdvanced('#threads', '4');
  await page.evaluate(() => document.getElementById('threads').focus());
  await page.keyboard.press('Control+Enter'); // startRender via the document shortcut
  await page.keyboard.press('Meta+Enter'); // busy re-entry guard returns immediately
  // The render spinner shows for the whole busy phase (sibling of #status, which
  // owns textContent, so it can't be a child).
  await page.waitForFunction(
    () =>
      document.getElementById('status').dataset.state === 'busy' &&
      !document.getElementById('status-spinner').hidden,
    null,
    { timeout: 120_000 }
  );
  await waitState('done');
  await page.waitForTimeout(300); // let the decode().then(scrollIntoView) chain settle
  assert.equal(
    await page.evaluate(() => document.getElementById('status-spinner').hidden),
    true,
    'spinner should hide once the render settles to done'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('download-btn').getAttribute('download')),
    /^render-64x48-q8-a03\.png$/,
    'download name should encode quality + antialias'
  );
  await page.setViewportSize({ width: 1280, height: 720 });

  // --- failing render: error box, exit summary, editor line jump -------------
  // Triggered from a number input's Enter; blank dims exercise the NaN clamps.
  await page.fill('#editor', BROKEN_SCENE);
  await page.fill('#width', '');
  await page.fill('#height', '');
  await selAdvanced('#antialias', 'off');
  await page.evaluate(() => document.getElementById('width').focus());
  await page.keyboard.press('Enter'); // number-input Enter -> startRender
  await waitState('error');
  assert.match(
    await page.evaluate(() => document.getElementById('error').textContent),
    /line 3/,
    'a parse error should surface a line reference'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('log-summary').textContent),
    /exit \d+/,
    'a PovrayError should label the log summary with its exit code'
  );
  // An explicit Render failure is the loud, assertive case: the error box must
  // be a role=alert (not the quiet draft 'status'), with no draft styling.
  assert.deepEqual(
    await page.evaluate(() => {
      const e = document.getElementById('error');
      return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
    }),
    { role: 'alert', draft: false },
    'an explicit render error must read as a role=alert, non-draft box'
  );
  // The blamed line gets a persistent marker (the auto-jump's textarea selection
  // is invisible), and the error box becomes a click-to-jump affordance.
  assert.deepEqual(
    await page.evaluate(() => ({
      marker: !document.getElementById('error-line').hidden,
      hasLine: document.getElementById('error').classList.contains('has-line'),
    })),
    { marker: true, hasLine: true },
    'a parse error marks the blamed line and flags the box as jump-to-line'
  );
  // Move the caret away, then a click on the error box re-jumps to the line.
  await page.evaluate(() => document.getElementById('editor').setSelectionRange(0, 0));
  await page.click('#error');
  assert.equal(
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      return ed.value.slice(0, ed.selectionStart).split('\n').length;
    }),
    3,
    'clicking the error box re-jumps the caret to the blamed line (line 3)'
  );

  // --- status throttle: immediate path (stepped clock forces now - last >= 1s)
  await page.fill('#editor', VALID_SCENE);
  await page.fill('#width', '64');
  await page.fill('#height', '48');
  await selAdvanced('#antialias', 'off');
  await selAdvanced('#quality', '');
  await fillAdvanced('#threads', '');
  await page.evaluate(() => {
    window.__origNow = performance.now.bind(performance);
    let t = 0;
    performance.now = () => (t += 5000);
  });
  await page.click('#render-btn');
  await waitState('done');
  await page.evaluate(() => {
    performance.now = window.__origNow;
  });

  // --- status throttle: timer-callback path (frozen clock + slow render) -----
  // A frozen clock makes every setBusyStatus throttle (now - last === 0), so the
  // first one schedules the 1s timer; cornell-mood at 700x700 renders ~2s, well
  // past the timer, so it fires mid-render with a pending text.
  await page.evaluate(async () => {
    const { getExample } = await import('/examples.js');
    const ed = document.getElementById('editor');
    ed.value = getExample('cornell-mood');
    ed.dispatchEvent(new Event('input'));
  });
  await page.fill('#width', '700');
  await page.fill('#height', '700');
  await selAdvanced('#antialias', '0.1');
  await page.evaluate(() => {
    window.__origNow = performance.now.bind(performance);
    const frozen = window.__origNow();
    performance.now = () => frozen;
  });
  await page.click('#render-btn');
  await waitState('done');
  await page.evaluate(() => {
    performance.now = window.__origNow;
  });

  // --- Escape aborts an in-flight render (document-level shortcut) ------------
  await page.fill('#editor', VALID_SCENE);
  await page.fill('#width', '900');
  await page.fill('#height', '700');
  await selAdvanced('#antialias', '0.05');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('rendering'),
    null,
    { timeout: 15_000 }
  );
  await page.keyboard.press('Escape');
  await waitState('cancelled', 30_000);

  // --- persistence: restore a full saved blob, then reload variants ----------
  // Seed via an init script (runs on the NEXT document, after the unloading
  // page's pagehide->saveState fires) so the app's own save can't clobber the
  // blob we're trying to restore. addInitScript stacks across loads; the most
  // recently added runs last and wins.
  let seedNav = 0;
  const seedReload = async (blob) => {
    await page.addInitScript((b) => {
      localStorage.setItem('povrayer.ui.v1', b);
    }, blob);
    // Load a fresh, HASHLESS URL rather than page.reload(): the live permalink
    // sync may have left a #payload in the bar, and on reload that stale hash
    // would hydrate OVER the seeded localStorage we're restoring (hash > saved).
    // The unique ?seed forces a full document load with no fragment.
    await page.goto(`${server.url}?seed=${seedNav++}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      {
        timeout: 30_000,
      }
    );
  };

  await seedReload(
    JSON.stringify({
      source: 'SAVED restore source',
      width: '200',
      height: '150',
      quality: '5',
      antialias: '0.1',
      threads: '6',
      flags: '+R3',
      example: 'glass',
      advancedOpen: true,
    })
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      source: document.getElementById('editor').value,
      width: document.getElementById('width').value,
      height: document.getElementById('height').value,
      quality: document.getElementById('quality').value,
      antialias: document.getElementById('antialias').value,
      threads: document.getElementById('threads').value,
      flags: document.getElementById('flags').value,
      example: document.getElementById('example-trigger').dataset.name,
      advancedOpen: document.getElementById('advanced').open,
    })),
    {
      source: 'SAVED restore source',
      width: '200',
      height: '150',
      quality: '5',
      antialias: '0.1',
      threads: '6',
      flags: '+R3',
      example: 'glass',
      advancedOpen: true,
    },
    'a full saved blob should restore every control'
  );

  // Partial / wrong-typed fields each fall back to their default.
  await seedReload(
    JSON.stringify({
      source: 123,
      width: '',
      height: 7,
      quality: '99',
      antialias: 'weird',
      threads: 5,
      example: 'no-such-example',
    })
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      example: document.getElementById('example-trigger').dataset.name,
      width: document.getElementById('width').value,
      quality: document.getElementById('quality').value,
      antialias: document.getElementById('antialias').value,
    })),
    { example: 'csg-die', width: '512', quality: '', antialias: '0.1' },
    'invalid saved fields should fall back to defaults'
  );

  // Non-object JSON: readSavedState returns null via the typeof guard.
  await seedReload('5');
  // Malformed JSON: readSavedState swallows the parse error.
  await seedReload('{ not valid json');
  // Fresh load with output hidden: resize + image-click are both no-ops.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize')); // updateZoomLabel early return
    document.getElementById('output').dispatchEvent(new Event('click')); // hidden -> no toggle
  });

  // saveState catch + pagehide handler: setItem throws, pagehide still no-ops.
  await page.evaluate(() => {
    localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
    window.dispatchEvent(new Event('pagehide'));
  });

  // ===========================================================================
  // animate mode: the inline frame player, WebM/PNG export, runAnimateRender
  // (success / cancel / PovrayError / generic failure), the mode toggle + plate
  // routing, and mode/frames/fps persistence. Restored straight into animate
  // mode so the first render below is the session's first (the engine-not-seen
  // 'parsing' status arm in runAnimateRender).
  // ===========================================================================
  const CLOCK_SCENE = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-6> look_at 0 }',
    'light_source { <4,6,-5> color rgb 1 }',
    'sphere { <clock,0,0>, 1 pigment { rgb <1,0,0> } }',
  ].join('\n');
  const waitDone = (t = 120_000) =>
    page.waitForFunction(() => document.getElementById('status').dataset.state === 'done', null, {
      timeout: t,
    });
  const playLabel = () => page.evaluate(() => document.getElementById('play-btn').textContent);
  const waitPaused = () =>
    page.waitForFunction(() => document.getElementById('play-btn').textContent === 'Play', null, {
      timeout: 5_000,
    });

  await seedReload(
    JSON.stringify({
      source: CLOCK_SCENE,
      mode: 'animate',
      frames: '30',
      fps: '24',
      width: '48',
      height: '36',
    })
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
    })),
    { mode: 'animate', frames: '30', fps: '24' },
    'a saved animate blob should restore mode + frames + fps'
  );
  // Animate-only controls visible, still-only ones hidden, in animate mode.
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.getElementById('frames').closest('label')).display !== 'none'
    ),
    true,
    'frames input should be visible in animate mode'
  );
  // Clicking the already-active mode is a no-op (setMode next===mode guard).
  await page.click('#mode-animate');

  // Player guards before any frames exist: play / seek / export all early-return.
  await page.evaluate(() => {
    document.getElementById('play-btn').click(); // toggle -> play -> !bitmaps.length
    document.getElementById('scrubber').dispatchEvent(new Event('input')); // seek -> !bitmaps.length
    document.getElementById('export-btn').click(); // exportAs -> !bitmaps.length
  });
  assert.equal(
    await page.evaluate(async () => {
      const { createPlayer } = await import('./player.js');
      try {
        createPlayer({
          canvas: { getContext: () => null },
          controls: {},
          playButton: {},
          scrubber: {},
          frameReadout: {},
          loopButton: {},
          exportButton: {},
          exportFormat: {},
        });
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      return null;
    }),
    '2D canvas context unavailable',
    'createPlayer should fail early when a 2D canvas context is unavailable'
  );
  await page.evaluate(async () => {
    const { createPlayer } = await import('./player.js');
    const originalMatchMedia = window.matchMedia;
    const stubEl = () => {
      const attrs = {};
      return {
        hidden: false,
        textContent: '',
        value: '0',
        max: '0',
        disabled: false,
        addEventListener() {},
        setAttribute(k, v) {
          attrs[k] = v;
        },
        getAttribute(k) {
          return attrs[k] ?? null;
        },
        querySelector() {
          return null;
        },
      };
    };
    window.matchMedia = () => ({
      matches: false,
      media: '(prefers-reduced-motion: no-preference)',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
    try {
      const raw = new Uint8Array(1024 * 1024);
      window.__playerRawFrameRef = new WeakRef(raw);
      const player = createPlayer({
        canvas: {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          setAttribute() {},
        },
        controls: stubEl(),
        playButton: stubEl(),
        scrubber: stubEl(),
        frameReadout: stubEl(),
        loopButton: stubEl(),
        exportButton: stubEl(),
        exportFormat: stubEl(),
      });
      window.__playerGcProbe = player;
      player.load(
        {
          bitmaps: [{ width: 2, height: 2, close() {} }],
          blobUrls: ['blob:povrayer-player-gc-probe'],
          frames: [raw],
        },
        12
      );
      player.destroy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
  const gcSession = await page.context().newCDPSession(page);
  await gcSession.send('HeapProfiler.collectGarbage');
  await gcSession.send('HeapProfiler.collectGarbage');
  await gcSession.detach();
  assert.equal(
    await page.evaluate(() => window.__playerRawFrameRef.deref() === undefined),
    true,
    'player.destroy should release its raw PNG frame references'
  );
  await page.evaluate(() => {
    delete window.__playerRawFrameRef;
    delete window.__playerGcProbe;
  });

  // First animate render (3 frames, fresh page so engineSeen is false).
  await page.fill('#frames', '3');
  await page.fill('#fps', '12');
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await selAdvanced('#antialias', 'off');
  await page.click('#render-btn');
  await waitDone();
  assert.equal(
    await page.evaluate(() => document.getElementById('player-canvas').hidden),
    false,
    'the player canvas should be the hero after an animate render'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('scrubber').max),
    '2',
    'scrubber max should be frames-1'
  );
  // The scrubber carries the shared .scrubber class (square grey thumb / 2px
  // track) instead of the OS-blue default range, and an appearance-stripped
  // computed style.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('scrubber');
      return {
        hasClass: s.classList.contains('scrubber'),
        appearance: getComputedStyle(s).appearance,
      };
    }),
    { hasClass: true, appearance: 'none' },
    'the scrubber must use the de-accented .scrubber styling'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('status').textContent),
    /· 3 frames$/,
    'the animate done line should report the frame count'
  );

  // Let the looping autoplay run a couple cycles so tick wraps off the end
  // (next = 0) before we change anything.
  await page.waitForTimeout(500);
  // Transport: uncheck loop, let the autoplay run off the end (tick no-loop
  // pause), then play from the parked last frame (the play() redraw branch).
  await page.click('#loop-btn'); // setLoop(false)
  await waitPaused();
  await page.click('#play-btn'); // toggle -> play, restart from frame 0
  await waitPaused();
  // Re-enable loop, play, then pause via a second click (toggle's playing arm).
  await page.click('#loop-btn'); // setLoop(true)
  await page.click('#play-btn'); // toggle -> play
  await page.click('#play-btn'); // toggle -> pause
  await waitPaused();
  // Scrubber seek (pauses an already-paused player) + fps retune (valid then
  // out-of-range, the latter leaving the fps untouched).
  await page.evaluate(() => {
    const s = document.getElementById('scrubber');
    s.value = '1';
    s.dispatchEvent(new Event('input'));
  });
  // The scrubber announces a 1-based "frame i+1 of N" (matching the readout),
  // not the raw 0-indexed slider value, on every draw.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('scrubber');
      return { aria: s.getAttribute('aria-valuetext'), readout: frameReadoutText() };
      function frameReadoutText() {
        return document.getElementById('frame-readout').textContent;
      }
    }),
    { aria: 'frame 2 of 3', readout: '2 / 3 · 12 fps' },
    'the scrubber aria-valuetext must read "frame 2 of 3" on a seek to index 1'
  );
  await page.fill('#fps', '20'); // valid -> player.setFps(20)
  await page.fill('#fps', '99'); // out of range -> handler no-ops
  await page.fill('#fps', '12');

  // Deterministic tick stall-resync (ui.js): steady-state autoplay only ever
  // takes the accumulate arm (last += interval). To exercise the resync arm
  // (`if (now - lastAdvance >= interval) lastAdvance = now`) we stub rAF so we
  // own the `now` passed to tick, then drive a single tick a huge gap past two
  // fps intervals (a backgrounded-tab style stall) so the resync fires once and
  // advances exactly one frame instead of replaying the whole backlog.
  const resync = await page.evaluate(async () => {
    const play = document.getElementById('play-btn');
    const scrub = document.getElementById('scrubber');
    const readout = document.getElementById('frame-readout');
    const origRAF = window.requestAnimationFrame;
    const origCAF = window.cancelAnimationFrame;
    let captured = null;
    try {
      // Park paused on frame 0 first (seek pauses + draws 0).
      scrub.value = '0';
      scrub.dispatchEvent(new Event('input'));
      const before = readout.textContent;
      window.requestAnimationFrame = (cb) => {
        captured = cb;
        return 1;
      };
      window.cancelAnimationFrame = () => {};
      if (play.textContent === 'Play') play.click(); // play() schedules tick via the stub
      const scheduled = typeof captured === 'function';
      captured?.(performance.now() + 100_000); // one tick, far past 2 intervals
      const after = readout.textContent;
      const aria = scrub.getAttribute('aria-valuetext');
      if (play.textContent === 'Pause') play.click(); // pause via toggle
      return { before, after, aria, scheduled };
    } finally {
      window.requestAnimationFrame = origRAF;
      window.cancelAnimationFrame = origCAF;
    }
  });
  assert.equal(resync.scheduled, true, 'play() must schedule a tick through the stubbed rAF');
  assert.equal(
    resync.before,
    '1 / 3 · 12 fps',
    'the player must start parked on frame 0 (reads "1 / 3 · 12 fps")'
  );
  assert.equal(
    resync.after,
    '2 / 3 · 12 fps',
    'a stalled tick must resync and advance exactly one frame (not burst the backlog)'
  );
  assert.equal(resync.aria, 'frame 2 of 3', 'the resync-advanced frame announces "frame 2 of 3"');

  // Export pipeline. Capture both the download filenames (stubbed anchor click)
  // and the produced Blobs (stubbed createObjectURL) so each encoder's real
  // output bytes can be asserted. Both stubs delegate to the originals so the
  // player's blob-URL revokes still work.
  await page.evaluate(() => {
    window.__dl = [];
    window.__origAClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push(this.download);
    };
    window.__blobs = [];
    window.__origCOU = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob) window.__blobs.push(b);
      return window.__origCOU(b);
    };
  });
  // First `n` bytes of the most recent captured Blob of a given MIME type.
  const lastBlobHead = (type, n) =>
    page.evaluate(
      async ([t, count]) => {
        const b = [...window.__blobs].reverse().find((x) => x.type === t);
        return b ? [...new Uint8Array(await b.slice(0, count).arrayBuffer())] : null;
      },
      [type, n]
    );

  // GIF, and the shared re-entrancy + feedback check (a heavy encode path): the
  // first click flips the label to 'exporting…' synchronously and disables the
  // button; a second click while exporting hits the guard and no-ops, so only
  // one GIF comes out.
  await page.evaluate(() => (document.getElementById('export-format').value = 'gif'));
  const exportFeedback = await page.evaluate(() => {
    const btn = document.getElementById('export-btn');
    const prevLabel = btn.textContent;
    btn.click(); // export #1 begins
    const midLabel = btn.textContent;
    const midDisabled = btn.disabled;
    btn.click(); // export #2: re-entrant -> guard returns immediately
    return { prevLabel, midLabel, midDisabled };
  });
  assert.equal(exportFeedback.midLabel, 'exporting…', 'the export button relabels while exporting');
  assert.equal(exportFeedback.midDisabled, true, 'the export button disables while exporting');
  await page.waitForFunction(
    (label) => {
      const btn = document.getElementById('export-btn');
      return !btn.disabled && btn.textContent === label;
    },
    exportFeedback.prevLabel,
    { timeout: 15_000 }
  );
  assert.deepEqual(
    await lastBlobHead('image/gif', 6),
    [...'GIF89a'].map((c) => c.charCodeAt(0)),
    'the GIF export must start with the GIF89a signature'
  );
  assert.equal(
    await page.evaluate(() => window.__dl.filter((n) => /animation\.gif$/.test(n)).length),
    1,
    'a re-entrant export click must not produce a second GIF'
  );

  // APNG: lossless animated PNG, so a PNG signature on the output bytes.
  await page.evaluate(() => (document.getElementById('export-format').value = 'apng'));
  await page.click('#export-btn'); // page.click auto-waits for the button to re-enable
  await page.waitForFunction(() => window.__dl.some((n) => /^animation\.png$/.test(n)), null, {
    timeout: 15_000,
  });
  assert.deepEqual(
    await lastBlobHead('image/apng', 8),
    [137, 80, 78, 71, 13, 10, 26, 10],
    'the APNG export must start with the PNG signature'
  );

  // WebM via a stubbed MediaRecorder -> 'animation.webm'.
  await page.evaluate(() => {
    class FakeRecorder {
      start() {
        this.ondataavailable?.({ data: new Blob(['x'], { type: 'video/webm' }) });
      }
      stop() {
        this.onstop?.();
      }
      static isTypeSupported() {
        return true;
      }
    }
    window.__origMR = window.MediaRecorder;
    window.MediaRecorder = FakeRecorder;
    document.getElementById('export-format').value = 'webm';
  });
  await page.click('#export-btn');
  await page.waitForFunction(() => window.__dl.some((n) => /\.webm$/.test(n)), null, {
    timeout: 15_000,
  });

  // PNG frames (the explicit format) -> sequential frameNNN.png downloads.
  await page.evaluate(() => {
    window.__dl.length = 0;
    document.getElementById('export-format').value = 'png';
  });
  await page.click('#export-btn');
  await page.waitForFunction(
    () => window.__dl.filter((n) => /frame\d+\.png/.test(n)).length >= 3,
    null,
    { timeout: 5_000 }
  );

  // WebM with no codec available degrades to the same PNG-frames fallback.
  await page.evaluate(() => {
    delete window.MediaRecorder;
    window.__dl.length = 0;
    document.getElementById('export-format').value = 'webm';
  });
  await page.click('#export-btn');
  await page.waitForFunction(
    () => window.__dl.filter((n) => /frame\d+\.png/.test(n)).length >= 3,
    null,
    { timeout: 5_000 }
  );

  // Restore the stubbed globals.
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__origAClick;
    URL.createObjectURL = window.__origCOU;
    if (window.__origMR) window.MediaRecorder = window.__origMR;
  });

  // A second animate render at a mobile viewport: load() frees the prior
  // render's assets (player destroy revokes the old blob URLs, closes the old
  // bitmaps), and the narrow viewport scrolls the player into view.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.fill('#frames', '2');
  await page.click('#render-btn');
  await waitDone();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Reduced motion: no autoplay on load (the else branch sets the label only).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.fill('#frames', '2');
  await page.click('#render-btn');
  await waitDone();
  assert.equal(await playLabel(), 'Play', 'reduced motion must not autoplay the player');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Blank frames/fps -> collectAnimOptions falls back to 24/12; a big slow
  // render gives a wide window to cancel, and a mid-render mode click is a
  // no-op (the busy guard in setMode).
  await page.fill('#frames', '');
  await page.fill('#fps', '');
  await page.fill('#width', '400');
  await page.fill('#height', '300');
  await selAdvanced('#antialias', '0.1');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('rendering'),
    null,
    { timeout: 15_000 }
  );
  await page.click('#mode-still'); // busy -> setMode returns, mode stays animate
  await page.click('#cancel-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent === 'render cancelled',
    null,
    { timeout: 60_000 }
  );

  // A broken scene in animate mode -> PovrayError error path (line jump + exit).
  await page.fill('#editor', BROKEN_SCENE);
  await page.fill('#frames', '2');
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await selAdvanced('#antialias', 'off');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').dataset.state === 'error',
    null,
    { timeout: 60_000 }
  );
  assert.match(
    await page.evaluate(() => document.getElementById('error').textContent),
    /line 3/,
    'a broken animate scene should surface a line reference'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('log-summary').textContent),
    /exit \d+/,
    'a PovrayError animate failure should label the log summary with its exit code'
  );
  // The animate error path is loud too: role=alert, draft styling cleared.
  assert.deepEqual(
    await page.evaluate(() => {
      const e = document.getElementById('error');
      return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
    }),
    { role: 'alert', draft: false },
    'an animate render error must read as a role=alert, non-draft box'
  );

  // A generic (non-PovrayError, non-abort) failure: the wasm frames render, but
  // createImageBitmap throws, so render-client rejects with a plain Error. The
  // log summary stays exit-less and no editor line is selected.
  await page.fill('#editor', CLOCK_SCENE);
  await page.fill('#frames', '2');
  await page.evaluate(() => {
    window.__origCIB = window.createImageBitmap;
    window.__origCreateObjectURL = URL.createObjectURL;
    window.__origRevokeObjectURL = URL.revokeObjectURL;
    window.__bitmapFailureCleanup = { created: [], revoked: [], closed: 0, calls: 0 };
    URL.createObjectURL = (blob) => {
      const url = window.__origCreateObjectURL.call(URL, blob);
      window.__bitmapFailureCleanup.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__bitmapFailureCleanup.revoked.push(url);
      return window.__origRevokeObjectURL.call(URL, url);
    };
    window.createImageBitmap = () => {
      window.__bitmapFailureCleanup.calls += 1;
      if (window.__bitmapFailureCleanup.calls === 1) {
        return Promise.resolve({
          close() {
            window.__bitmapFailureCleanup.closed += 1;
          },
        });
      }
      return Promise.reject(new Error('bitmap boom'));
    };
  });
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').dataset.state === 'error',
    null,
    { timeout: 60_000 }
  );
  assert.doesNotMatch(
    await page.evaluate(() => document.getElementById('log-summary').textContent),
    /exit \d+/,
    'a generic animate failure must not carry an exit code'
  );
  const bitmapFailureCleanup = await page.evaluate(() => ({
    created: window.__bitmapFailureCleanup.created,
    revoked: window.__bitmapFailureCleanup.revoked,
    closed: window.__bitmapFailureCleanup.closed,
    calls: window.__bitmapFailureCleanup.calls,
  }));
  await page.evaluate(() => {
    window.createImageBitmap = window.__origCIB;
    URL.createObjectURL = window.__origCreateObjectURL;
    URL.revokeObjectURL = window.__origRevokeObjectURL;
    delete window.__origCIB;
    delete window.__origCreateObjectURL;
    delete window.__origRevokeObjectURL;
    delete window.__bitmapFailureCleanup;
  });
  assert.equal(bitmapFailureCleanup.created.length, 2, 'bitmap failure should create frame URLs');
  assert.deepEqual(
    [...bitmapFailureCleanup.revoked].sort(),
    [...bitmapFailureCleanup.created].sort(),
    'bitmap failure should revoke every frame URL it created'
  );
  assert.equal(
    bitmapFailureCleanup.closed,
    1,
    'bitmap failure should close ImageBitmaps created before the rejection'
  );
  assert.equal(bitmapFailureCleanup.calls, 2, 'bitmap creation should be attempted for each frame');

  // Mode toggle + plate routing: switch to still (player pauses, image plate),
  // run a still render, then bounce animate<->still so refreshPlate routes both
  // a live player (animate, hasFrames) and a kept still image (still).
  await page.click('#mode-still');
  assert.equal(
    await page.evaluate(() => document.body.dataset.mode),
    'still',
    'the mode toggle should switch to still'
  );
  await page.click('#mode-still'); // already still -> setMode returns
  await page.fill('#editor', VALID_SCENE);
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await selAdvanced('#antialias', 'off');
  await page.click('#render-btn');
  await waitDone();
  assert.equal(
    await page.evaluate(() => document.getElementById('output').hidden),
    false,
    'a still render after animate mode should show the image again'
  );
  await page.click('#mode-animate'); // refreshPlate animate branch (hasFrames true)
  assert.equal(
    await page.evaluate(() => document.getElementById('player-canvas').hidden),
    false,
    'switching back to animate should re-show the player'
  );
  // syncStatusToPlate re-derives a neutral footer that agrees with the new
  // plate: animate (frames present) reads 'animation ready', not the prior
  // still 'done …' line.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'animation ready', state: 'idle' },
    'switching into animate with frames must read "animation ready"'
  );
  await page.click('#mode-still'); // refreshPlate still branch (hasStillImage true)
  assert.equal(
    await page.evaluate(() => document.getElementById('output').hidden),
    false,
    'switching back to still should re-show the kept image'
  );
  // ...and switching back to still (image present) names the kept artifact +
  // its dims, never a lingering 'animation ready' / 'live draft' line (and
  // never a bare 'render ready', which reads as engine readiness).
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'still ready · 48×36', state: 'idle' },
    'switching back into still with a kept image must read "still ready · 48×36"'
  );

  // updateZoomLabel with a zero-width (but shown) image: clientWidth/naturalWidth
  // rounds to 0, so the percentage falls back to '|| 100', and at 100% the
  // fit/1:1 toggle is a no-op so the chip hides.
  await page.evaluate(() => {
    const o = document.getElementById('output');
    o.style.width = '0px';
    window.dispatchEvent(new Event('resize'));
    o.style.width = '';
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').hidden),
    true,
    'a zero-width image falls back to 100% fit, where the zoom chip hides'
  );

  // Persistence: invalid mode/frames/fps fall back to still/24/12 across the
  // validator's range and type arms.
  await seedReload(JSON.stringify({ mode: 'weird', frames: '999', fps: '99' }));
  assert.deepEqual(
    await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
    })),
    { mode: 'still', frames: '24', fps: '12' },
    'out-of-range persisted mode/frames/fps should fall back to defaults'
  );
  await seedReload(JSON.stringify({ frames: '0', fps: '0' })); // below the floor
  await seedReload(JSON.stringify({ frames: 'x', fps: 'y' })); // non-numeric (NaN)
  assert.deepEqual(
    await page.evaluate(() => ({
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
    })),
    { frames: '24', fps: '12' },
    'non-numeric persisted frames/fps should fall back to defaults'
  );

  // ===========================================================================
  // live-draft auto-render (still mode only): the syntax overlay (paint +
  // escaping + scroll sync), the persisted toggle, the validity gate, the draft
  // state machine (success swap / non-destructive error / in-flight coalescing /
  // explicit-render priority), the isolation + busy guards, and animate
  // suppression. Drives the deliverable A/B/C code in ui.js that the still/
  // animate paths above never reach (no draft ever fired up to here).
  // ===========================================================================
  const LIVE_SCENE = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <2,4,-3> rgb 1 }',
    'sphere { 0, 1 pigment { rgb <1,0,0> } }',
    '',
  ].join('\n');
  const LIVE_SCENE2 = LIVE_SCENE + '// variant two\n';
  // Balanced + #version-present (so the validity gate passes) but POV-Ray
  // rejects the bogus pigment keyword: exercises the non-destructive draft error.
  const DRAFT_BROKEN = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <2,4,-3> rgb 1 }',
    'sphere { 0, 1 pigment { BROKEN_NOPE } }',
    '',
  ].join('\n');

  // Replace the editor contents and fire the input event the controller hooks.
  const typeScene = (value) =>
    page.evaluate((v) => {
      const ed = document.getElementById('editor');
      ed.value = v;
      ed.dispatchEvent(new Event('input'));
    }, value);
  const outSrc = () => page.evaluate(() => document.getElementById('output').src);
  const ariaPressed = (id) =>
    page.evaluate((i) => document.getElementById(i).getAttribute('aria-pressed'), id);
  // render-client is a URL-keyed module singleton, so this import returns the
  // very instance ui.js drives: isBusy() reflects an in-flight draft.
  const waitBusy = (t = 60_000) =>
    page.waitForFunction(async () => (await import('/render-client.js')).isBusy(), null, {
      timeout: t,
    });
  const waitIdle = (t = 60_000) =>
    page.waitForFunction(async () => !(await import('/render-client.js')).isBusy(), null, {
      timeout: t,
    });

  // Floor the adaptive debounce by rendering one fast (sphere) draft and letting
  // it settle, so lastDraftMs (which the debounce scales off) is small. A slow
  // prior draft (e.g. the radiosity cornell below) otherwise inflates the debounce
  // toward its 2s cap; a draft scheduled then fires a full ~2s later and can
  // linger into the next section, leaving a stray render in flight under an
  // assertion that expects idle. Flooring it keeps every fireDraft prompt.
  let floorDraftSeq = 0;
  const floorDebounce = async () => {
    // Wait for a genuinely NEW draft image (the blob src changes), not just any
    // 320×240 'draft' state: a prior cornell draft already leaves status='draft'
    // at 320×240, so matching on those alone resolves instantly on the stale
    // frame and never actually re-floors lastDraftMs (which left the debounce
    // inflated, so a later busy-guard draft fired late and lingered in flight
    // under the isolation guard's idle assertion).
    const before = await page.evaluate(() => document.getElementById('output').src);
    floorDraftSeq += 1;
    await typeScene(`${LIVE_SCENE}// floor debounce ${floorDraftSeq}\n`);
    await page.waitForFunction(
      (prev) => {
        const o = document.getElementById('output');
        return (
          document.getElementById('status').dataset.state === 'draft' &&
          o.src.startsWith('blob:') &&
          o.src !== prev
        );
      },
      before,
      { timeout: 60_000 }
    );
    await waitIdle();
  };

  // Fresh page: a known scene, full 512x384, and the toggle restored OFF (the
  // `typeof saved.liveDraft === 'boolean'` restore arm). Start with drafts off
  // so the overlay/scroll assertions run without a render firing underneath.
  await seedReload(
    JSON.stringify({
      source: LIVE_SCENE,
      width: '512',
      height: '384',
      antialias: '0.3',
      liveDraft: false,
    })
  );
  assert.equal(await ariaPressed('live-toggle'), 'false', 'a saved liveDraft:false restores OFF');
  assert.equal(
    await page.evaluate(() => document.body.dataset.mode),
    'still',
    'the live-draft suite runs in still mode'
  );

  // Overlay paint: the colored layer carries token spans for the scene and
  // escapes the vector angle brackets (never raw markup).
  const paint = await page.evaluate(() => document.getElementById('editor-code').innerHTML);
  assert.ok(paint.includes('tok-keyword'), 'overlay should color SDL keywords');
  assert.ok(paint.includes('tok-directive'), 'overlay should color the #version directive');
  assert.ok(
    paint.includes('&lt;') && paint.includes('&gt;'),
    'overlay must escape vector brackets'
  );

  // Typing a raw '<' stays escaped: the overlay <code> text must equal the
  // editor value byte-for-byte (proves no markup injection / no drift).
  await typeScene('box { <');
  assert.ok(
    await page.evaluate(
      () =>
        document.getElementById('editor-code').textContent ===
        document.getElementById('editor').value
    ),
    'overlay text must equal the editor value (escaped, no injection)'
  );

  // Scroll sync: the overlay tracks BOTH axes by translating #editor-code with a
  // GPU transform (the gutter still mirrors only the top via scrollTop).
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = Array.from({ length: 80 }, (_, i) => `line ${i} ${'x'.repeat(140)}`).join('\n');
    ed.dispatchEvent(new Event('input'));
    ed.scrollTop = 60;
    ed.scrollLeft = 40;
    ed.dispatchEvent(new Event('scroll'));
  });
  const sync = await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const code = document.getElementById('editor-code');
    const g = document.getElementById('gutter');
    return {
      transform: code.style.transform,
      edTop: ed.scrollTop,
      edLeft: ed.scrollLeft,
      gTop: g.scrollTop,
    };
  });
  assert.equal(
    sync.transform,
    `translate(${-sync.edLeft}px, ${-sync.edTop}px)`,
    'overlay must track both axes via the #editor-code transform'
  );
  assert.equal(sync.gTop, sync.edTop, 'gutter mirrors the editor scrollTop');

  // Toggle live ON: the current scene auto-renders a downscaled (320-edge,
  // AA-off) draft, clearly distinct from the full 512x384 Render output.
  await typeScene(LIVE_SCENE);
  await page.click('#live-toggle');
  assert.equal(await ariaPressed('live-toggle'), 'true', 'toggling shows the pressed state');
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        o.src.startsWith('blob:') &&
        !o.hidden &&
        o.naturalWidth === 320 &&
        o.naturalHeight === 240
      );
    },
    null,
    { timeout: 60_000 }
  );
  assert.match(
    await page.evaluate(() => document.getElementById('status').textContent),
    /preview ready · 320×240/,
    'the preview status reads the downscaled dims in a muted state'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('download-btn').hidden),
    true,
    'a low-res draft preview is not offered for download'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('output').classList.contains('stale')),
    false,
    'a fresh draft image is not stale'
  );

  // Validity gate: an obviously mid-edit (unbalanced) scene must NOT auto-render.
  const goodDraftSrc = await outSrc();
  await typeScene(LIVE_SCENE + '\nsphere { 0, 1'); // dangling '{'
  await page.waitForTimeout(1200); // well past the (250ms) debounce
  assert.equal(await outSrc(), goodDraftSrc, 'an unbalanced scene must not fire a draft');
  assert.equal(
    await page.evaluate(() => document.getElementById('error').hidden),
    true,
    'the gate suppresses before any render, so no error surfaces'
  );

  // Non-destructive draft error: a balanced + versioned but parse-broken scene
  // renders, POV-Ray rejects it, the last good image is KEPT, the error shows
  // quietly (the .draft modifier), and the caret is NOT jumped to a line.
  const keptW = await page.evaluate(() => document.getElementById('output').naturalWidth);
  const keptSrc = await outSrc();
  await typeScene(DRAFT_BROKEN);
  await page.waitForFunction(
    () => {
      const e = document.getElementById('error');
      return !e.hidden && e.classList.contains('draft');
    },
    null,
    { timeout: 60_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('output').naturalWidth),
    keptW,
    'a draft parse error must keep the last good image'
  );
  assert.equal(await outSrc(), keptSrc, 'the kept image src must not change on a draft error');
  assert.equal(
    await page.evaluate(() => document.getElementById('output').classList.contains('stale')),
    false,
    'the kept image must not be marked stale by a draft error'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('status').textContent),
    /preview error/,
    'a draft error sets a muted preview-error status'
  );
  // A draft error is a POLITE live region (role swapped to status), so a screen
  // reader isn't interrupted on every keystroke; the box also carries .draft.
  assert.deepEqual(
    await page.evaluate(() => {
      const e = document.getElementById('error');
      return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
    }),
    { role: 'status', draft: true },
    'a draft error must read as a quiet role=status, draft-styled box'
  );
  assert.ok(
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      return ed.selectionStart === ed.selectionEnd;
    }),
    'a draft error must not select/jump the editor caret'
  );

  // P1 loop fix: the parse failure recorded lastDraftSource, so the backstop's
  // re-read of the SAME (unchanged) broken text must short-circuit instead of
  // re-rendering the erroring scene forever. Re-fire the input with no edit and
  // confirm the scheduled backstop draft bails (pending clears) without ever
  // going in flight or touching the engine.
  await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('input')));
  await page.waitForFunction(() => window.__liveDraftProbe().pending, null, { timeout: 5_000 });
  await page.waitForFunction(() => !window.__liveDraftProbe().pending, null, { timeout: 5_000 });
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().inFlight),
    false,
    'the backstop must not start a draft for the unchanged erroring source (no re-render loop)'
  );
  assert.equal(
    await page.evaluate(async () => (await import('/render-client.js')).isBusy()),
    false,
    'the erroring draft must not re-render itself forever on the backstop'
  );

  // Restore the assertive voice on an explicit Render: with DRAFT_BROKEN still in
  // the editor (and the error box parked in the quiet draft state), clicking
  // Render must fail loudly, flipping the box back to role=alert and clearing
  // .draft. This is the role-restore the still-render error path owns.
  await page.click('#render-btn');
  await waitState('error');
  assert.deepEqual(
    await page.evaluate(() => {
      const e = document.getElementById('error');
      return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
    }),
    { role: 'alert', draft: false },
    'an explicit Render error must restore the assertive role=alert, non-draft box'
  );

  // Recover: a fresh valid edit succeeds, swaps the image, and clears the draft
  // error (also stops the broken-scene backstop retry loop).
  await typeScene(LIVE_SCENE2);
  await page.waitForFunction(
    (prev) => {
      const o = document.getElementById('output');
      const e = document.getElementById('error');
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        e.hidden &&
        o.src.startsWith('blob:') &&
        o.src !== prev &&
        o.naturalWidth === 320
      );
    },
    keptSrc,
    { timeout: 60_000 }
  );
  await waitIdle();
  await page.waitForTimeout(400); // let the success backstop fireDraft no-op (src === last)

  // From here the in-flight scenarios use the radiosity Cornell scene on a
  // single thread so a DRAFT stays in flight long enough to catch deterministically.
  const cornell = await page.evaluate(async () =>
    (await import('/examples.js')).getExample('cornell-mood')
  );
  const cornellA = cornell + '\n// inflight-a\n';
  const cornellB = cornell + '\n// inflight-b\n';
  await fillAdvanced('#threads', '1');

  // Explicit-render priority: a draft in flight is aborted by clicking Render
  // (the pendingFull hand-off), and the result is a FULL-dimension image, not
  // the 320 draft cap.
  await page.fill('#width', '400');
  await page.fill('#height', '300');
  await selAdvanced('#antialias', 'off');
  await typeScene(cornell);
  // Click Render from page context the instant the draft is in flight: two
  // synchronous statements with no round-trip, so draftCtl is guaranteed still
  // set when startRender runs (it aborts the draft, sets pendingFull, and the
  // draft's finally restarts it as a full render).
  await page.evaluate(async () => {
    const mod = await import('/render-client.js');
    await new Promise((resolve) => {
      const check = () => {
        if (mod.isBusy()) {
          document.getElementById('render-btn').click();
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  });
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return (
        document.getElementById('status').dataset.state === 'done' &&
        o.naturalWidth === 400 &&
        o.naturalHeight === 300
      );
    },
    null,
    { timeout: 120_000 }
  );

  // In-flight coalescing: while a draft renders, a same-text re-input is a no-op
  // (already rendering this exact source, ui.js 702), and a newer valid edit
  // supersedes it (abort-the-stale + reschedule, ui.js 703). Driven off the
  // window.__liveDraftProbe state so each fireDraft transition is awaited
  // deterministically instead of raced against the adaptive debounce with fixed
  // sleeps (the cold flake: a stale slow prior draft inflated the debounce past
  // the in-flight draft's lifetime, so the supersede never landed mid-flight).
  //
  // First pin that debounce near its 250ms floor (the engine is thoroughly warm
  // by now, so the sphere draft is quick) and reset the stale lastDraftMs it
  // scales off.
  await floorDebounce();

  // The radiosity cornell at the default quality (9, the empty option) on one
  // thread stays in flight for seconds, so every fireDraft below (now firing at
  // the floored debounce) lands while it is still live. Quality 9 already
  // computes radiosity (the slow part); 10/11 only add antialiasing/jitter,
  // which an AA-off draft skips, so the default is as slow as the old +Q11.
  await selAdvanced('#quality', '');
  await typeScene(cornellA);
  await page.waitForFunction(
    (s) => {
      const d = window.__liveDraftProbe();
      return d.inFlight && d.source === s;
    },
    cornellA,
    { timeout: 60_000 }
  );
  // While a live draft is genuinely in flight the spinner shows, even though the
  // state is 'draft' (not 'busy'): syncSpinner keys the draft case on the
  // in-flight controller, since 'draft' also describes a settled preview.
  assert.equal(
    await page.evaluate(() => document.getElementById('status-spinner').hidden),
    false,
    'spinner should show while a live draft is in flight'
  );
  // Same text: fireDraft sees src === draftingSource and bails (702). The
  // scheduled fire clears the pending timer with the SAME draft still in flight
  // and no new draft started, which is exactly the no-op branch having run.
  await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('input')));
  await page.waitForFunction(
    (s) => {
      const d = window.__liveDraftProbe();
      return !d.pending && d.inFlight && d.source === s;
    },
    cornellA,
    { timeout: 60_000 }
  );
  // Newer text supersedes the in-flight draft (703): abort + reschedule, so the
  // drafting source flips to cornellB once the abort's finally restarts it.
  await typeScene(cornellB);
  await page.waitForFunction((s) => window.__liveDraftProbe().source === s, cornellB, {
    timeout: 60_000,
  });
  await waitIdle();

  // The radiosity cornell draft just inflated the debounce back toward its cap;
  // floor it again so the busy-guard / isolation drafts below fire promptly and
  // never linger into a later section's idle assertion.
  await floorDebounce();

  // Busy guard: a direct render-client call holds the engine while a draft is
  // scheduled, so fireDraft bails at the defensive isBusy() check (no pile-up).
  await page.waitForTimeout(400);
  await page.evaluate((scene) => {
    window.__directDone = false;
    import('/render-client.js').then((mod) => {
      mod
        .renderScene(scene, { width: 600, height: 600, antialias: false, threads: 1 })
        .then((r) => {
          URL.revokeObjectURL(r.blobUrl);
          window.__directDone = true;
        })
        .catch(() => {
          window.__directDone = true;
        });
    });
    const ed = document.getElementById('editor');
    ed.value = scene + '\n// busy-guard\n';
    ed.dispatchEvent(new Event('input')); // schedules a draft that will hit isBusy()
  }, cornell);
  await page.waitForTimeout(700); // the draft fires while the direct render is busy -> bail
  await page.waitForFunction(() => window.__directDone === true, null, { timeout: 120_000 });
  await waitIdle();

  // Isolation guard: a scheduled draft that fires after cross-origin isolation
  // drops must bail before any render (the live preview can't run un-isolated).
  await waitIdle(); // clean idle baseline before asserting nothing starts
  const isoSrc = await outSrc();
  await typeScene(LIVE_SCENE + '\n// iso-marker\n'); // schedules a draft (pending=true)
  await page.evaluate(() => {
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => false });
  });
  // Await the scheduled fireDraft actually running (pending clears) rather than
  // sleeping: non-isolated, it bails before starting a render, so inFlight stays
  // false and the engine stays idle.
  await page.waitForFunction(() => !window.__liveDraftProbe().pending, null, { timeout: 30_000 });
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().inFlight),
    false,
    'a non-isolated draft must never start a render'
  );
  assert.equal(
    await page.evaluate(async () => (await import('/render-client.js')).isBusy()),
    false,
    'a non-isolated draft must leave the engine idle'
  );
  assert.equal(await outSrc(), isoSrc, 'a non-isolated draft must not change the image');
  await page.evaluate(() => {
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => true });
  });

  // Animate suppression: switching to animate aborts an in-flight draft and
  // hides the still-only toggle; editing while animating fires no still draft.
  await typeScene(cornellA);
  await waitBusy();
  await page.click('#mode-animate'); // setMode aborts the draft, suppresses drafts
  assert.equal(
    await page.evaluate(() => document.body.dataset.mode),
    'animate',
    'the mode toggle switches to animate'
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.getElementById('live-toggle')).display),
    'none',
    'the live toggle is still-only (hidden in animate mode)'
  );
  await waitIdle();
  const animSrc = await outSrc();
  await typeScene(cornellB);
  await page.waitForTimeout(700);
  assert.equal(await outSrc(), animSrc, 'no still draft fires while animating');

  // Back to still re-schedules a preview; let it settle.
  await page.click('#mode-still');
  assert.equal(
    await page.evaluate(() => document.body.dataset.mode),
    'still',
    'the mode toggle switches back to still'
  );
  await waitIdle();
  await page.waitForTimeout(400);

  // Persisted toggle OFF: with no draft in flight (the optional-chain abort is a
  // no-op), then ON again, then OFF mid-flight (the abort actually fires).
  await page.click('#live-toggle'); // OFF, draftCtl is null -> abort skipped
  assert.equal(await ariaPressed('live-toggle'), 'false', 'live toggles back OFF');
  // saveState is debounced (~300ms), so poll the persisted blob rather than read
  // it the instant after the click.
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('povrayer.ui.v1');
      return !!raw && JSON.parse(raw).liveDraft === false;
    },
    null,
    { timeout: 5_000 }
  );
  await typeScene(cornellA + '\n// reactivate\n'); // distinct + slow; nothing fires while OFF
  await page.click('#live-toggle'); // ON -> schedules a draft for the fresh scene
  // Await the draft actually being in flight (draftCtl set) before flipping OFF,
  // so the toggle's draftCtl?.abort() takes its truthy (mid-flight) branch.
  await page.waitForFunction(() => window.__liveDraftProbe().inFlight, null, { timeout: 60_000 });
  await page.click('#live-toggle'); // OFF mid-flight -> draftCtl?.abort() actually aborts
  assert.equal(await ariaPressed('live-toggle'), 'false', 'live toggles OFF again, mid-draft');
  // The footer was sitting in the 'draft' state, so toggling off neutralizes it
  // to an idle preview-paused label rather than leaving the now-frozen preview
  // announced as active.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'preview paused', state: 'idle' },
    'toggling auto preview off from a draft footer reads as preview paused'
  );
  await waitIdle();

  // Stop control during a live DRAFT (the deliverable's draft case). Live is OFF
  // here; re-enable it so a slow radiosity draft goes in flight, then click Stop.
  // Unlike the toolbar Cancel (explicit renders only), Stop also turns live-draft
  // OFF so the aborted draft can't immediately reschedule itself, and persists.
  await typeScene(cornellA + '\n// stop-draft\n'); // distinct + slow; nothing fires while live is OFF
  await page.click('#live-toggle'); // live ON -> schedules a draft for the fresh scene
  await page.waitForFunction(() => window.__liveDraftProbe().inFlight, null, { timeout: 60_000 });
  // Stop shows even though the state is 'draft' (not 'busy'): it rides draftCtl,
  // the same in-flight signal the spinner uses.
  assert.equal(
    await page.evaluate(() => document.getElementById('stop-btn').hidden),
    false,
    'stop button should show while a live draft is in flight'
  );
  // Stop is display:none at the two-column breakpoint (Cancel owns desktop), so
  // take the mobile viewport to click it for real.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.click('#stop-btn'); // aborts the draft AND turns live-draft off
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(
    await ariaPressed('live-toggle'),
    'false',
    'stopping a live draft flips the live-draft toggle off (aria-pressed false)'
  );
  // The footer neutralizes from the draft line to preview-paused (idle).
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'preview paused', state: 'idle' },
    'stopping a live draft reads as preview paused'
  );
  // No re-fire: live is off, so the draft's backstop scheduleDraft early-returns.
  // Wait for idle, then prove nothing is pending/in flight and Stop hid.
  await waitIdle();
  await page.waitForFunction(
    () => !window.__liveDraftProbe().pending && !window.__liveDraftProbe().inFlight,
    null,
    { timeout: 30_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('stop-btn').hidden),
    true,
    'stop button hides once the live draft is stopped'
  );
  // The off state persists (debounced save).
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('povrayer.ui.v1');
      return !!raw && JSON.parse(raw).liveDraft === false;
    },
    null,
    { timeout: 5_000 }
  );

  await fillAdvanced('#threads', '');

  // ===========================================================================
  // Gist deep-link (?gist=<id>): load a scene from a GitHub gist on page init,
  // OVERRIDING the restored scene. The gist JSON API is page.route-mocked so the
  // test is fully deterministic and never touches the real network. Covers a
  // successful .pov load + render, the user/id + full-URL leniency, a no-.pov
  // first-file fallback, and the graceful failure modes (no usable text file,
  // HTTP error, network failure, malformed id) that each fall back to the saved
  // scene with a quiet inline message and strip the param from the URL.
  // ===========================================================================
  const GIST_POV = [
    '#version 3.8;',
    'global_settings { assumed_gamma 1.0 }',
    'camera { location <0,0,-4> look_at 0 }',
    'light_source { <2,4,-3> rgb 1 }',
    'sphere { 0, 1 pigment { rgb <0,1,0> } } // from a gist .pov file',
    '',
  ].join('\n');
  const GIST_TXT = GIST_POV.replace('.pov file', '.txt file (no .pov present)');
  const FALLBACK_SCENE = '// saved fallback scene\nsphere { 0, 1 }\n';

  // Mock the gist JSON API, keyed on the hex id in the request URL. Every
  // fulfilled response carries Access-Control-Allow-Origin so the cross-origin
  // CORS fetch is readable under COEP (faithful to the real api.github.com,
  // which sends `*`); an unknown id 404s the same readable way.
  await page.route('https://api.github.com/gists/*', async (route) => {
    const id = route.request().url().split('/').pop();
    if (id === 'face') return route.abort(); // simulate a network failure
    const json = (obj) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(obj),
      });
    if (id === 'abc1')
      return json({ files: { 'scene.pov': { filename: 'scene.pov', content: GIST_POV } } });
    if (id === 'beef')
      return json({ files: { 'scene.txt': { filename: 'scene.txt', content: GIST_TXT } } });
    if (id === 'cafe')
      // a single file with no inline content (truncated) -> nothing usable
      return json({ files: { 'big.pov': { filename: 'big.pov', truncated: true } } });
    return route.fulfill({
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Not Found' }),
    });
  });

  // Seed a clean, known state for every gist navigation: live-draft ON (so a
  // successful load actually previews) and a distinct saved source that doubles
  // as the failure fallback. addInitScript stacks and runs last, so it wins over
  // any blob a prior section seeded, on each goto below.
  await page.addInitScript((fallback) => {
    localStorage.clear();
    localStorage.setItem('povrayer.ui.v1', JSON.stringify({ source: fallback, liveDraft: true }));
  }, FALLBACK_SCENE);

  const gistGoto = async (query) => {
    await page.goto(server.url + query, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
  };
  const editorIs = (text, t = 10_000) =>
    page.waitForFunction((v) => document.getElementById('editor').value === v, text, {
      timeout: t,
    });
  const searchHasGist = () => page.evaluate(() => /gist/.test(location.search));

  // Success (bare id): the gist .pov overrides the restored scene, the ?gist
  // param STAYS as the shareable permalink (not stripped), no error shows, and it
  // renders in FULL (not a draft): the output settles at the full 512px width,
  // not the draft's 320px downscale.
  await gistGoto('?gist=abc1');
  await editorIs(GIST_POV);
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return o.src.startsWith('blob:') && o.naturalWidth === 512;
    },
    null,
    { timeout: 120_000 }
  );
  assert.equal(
    await searchHasGist(),
    true,
    'a successful gist load keeps ?gist as the shareable permalink'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('error').hidden),
    true,
    'a successful gist load surfaces no error'
  );

  // Pinned permalink: while the gist scene is unmodified, Copy Link copies the
  // short ?gist URL (not a compressed #hash), and the bar keeps ?gist with no hash.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 5_000,
  });
  const pinnedCopied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(
    pinnedCopied,
    /[?&]gist=abc1\b/,
    'Copy Link copies the short ?gist URL while pinned'
  );
  assert.equal(pinnedCopied.includes('#'), false, 'the pinned copy carries no #hash');
  const pinnedBar = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
  assert.match(pinnedBar.search, /(^|[?&])gist=abc1\b/, 'an unmodified gist stays pinned to ?gist');
  assert.equal(pinnedBar.hash, '', 'a pinned gist carries no #hash');

  // Editing the gist scene unpins: the URL drops ?gist but does not ambiently
  // mint a self-contained #hash. Copy Link is the explicit hash action.
  await page.fill('#editor', GIST_POV + '\n// edited away from the gist\n');
  await page.waitForFunction(() => !/gist=/.test(location.search), null, { timeout: 5_000 });
  const unpinned = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
  assert.equal(/gist=/.test(unpinned.search), false, 'editing a pinned gist drops ?gist');
  assert.equal(unpinned.hash, '', 'editing a pinned gist leaves the hash clean');

  // Leniency: a `user/id` and a full gist URL both resolve to the same id, so
  // they hit the same success path (the gist .pov lands in the editor).
  await gistGoto('?gist=octocat%2Fabc1');
  await editorIs(GIST_POV);
  await gistGoto('?gist=' + encodeURIComponent('https://gist.github.com/octocat/abc1'));
  await editorIs(GIST_POV);

  // No-.pov fallback: a gist whose only file isn't a .pov still loads (the first
  // text file), so the editor gets that file's content.
  await gistGoto('?gist=beef');
  await editorIs(GIST_TXT);

  // Graceful failures: each shows a quiet inline message, keeps the saved
  // fallback scene in the editor, and strips the param. Shared assertions, with
  // a per-case message match.
  const gistFailure = async (query, pattern) => {
    await gistGoto(query);
    await page.waitForFunction(() => !document.getElementById('error').hidden, null, {
      timeout: 15_000,
    });
    assert.match(
      await page.evaluate(() => document.getElementById('error').textContent),
      pattern,
      `gist failure message for ${query}`
    );
    assert.equal(
      await page.evaluate(() => document.getElementById('editor').value),
      FALLBACK_SCENE,
      `${query} falls back to the saved scene`
    );
    // Quiet, non-modal: a polite role=status, draft-styled box (never the loud
    // role=alert a user-triggered Render uses).
    assert.deepEqual(
      await page.evaluate(() => {
        const e = document.getElementById('error');
        return { role: e.getAttribute('role'), draft: e.classList.contains('draft') };
      }),
      { role: 'status', draft: true },
      `${query} reads as a quiet role=status, draft-styled box`
    );
    assert.equal(await searchHasGist(), false, `${query} strips ?gist from the URL`);
  };
  await gistFailure('?gist=cafe', /no scene file/); // a gist with no usable text file
  await gistFailure('?gist=dead404', /HTTP 404/); // a 404 from the API
  await gistFailure('?gist=face', /reach the gist API/); // a network failure (route.abort)
  await gistFailure('?gist=nothex', /read a gist id/); // a malformed id (parsed, never fetched)

  await page.unroute('https://api.github.com/gists/*');

  // ===========================================================================
  // Shareable permalink (#<payload>): the Copy Link button compresses the scene
  // + settings into a base64url hash, copies a shareable URL to the clipboard,
  // and reflects the hash in the address bar. A page opened with such a hash
  // hydrates the editor + controls (overriding the restored scene), tolerates a
  // garbage hash (falling through to ?gist then cold-load), and ignores select
  // values the markup doesn't offer. The gist API is page.route-mocked so the
  // junk-hash-falls-through-to-gist case stays deterministic.
  // ===========================================================================
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  // A known per-load fallback so a hash/gist override is unambiguous against it.
  const PL_FALLBACK = '// permalink fallback scene\nsphere { 0, 1 }\n';
  await page.addInitScript((fallback) => {
    localStorage.clear();
    localStorage.setItem('povrayer.ui.v1', JSON.stringify({ source: fallback, liveDraft: true }));
  }, PL_FALLBACK);

  const PL_GIST = '#version 3.8;\n// FROM GIST permalink test\nbox {}\n';
  await page.route('https://api.github.com/gists/*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ files: { 's.pov': { filename: 's.pov', content: PL_GIST } } }),
    })
  );

  // page.goto to a URL that differs from the current one ONLY in its hash is an
  // in-page fragment change, not a reload, so the permalink init never re-runs.
  // A unique throwaway ?pl=<n> search (the init code ignores any param but
  // ?gist) forces a full document load every time without bouncing through
  // about:blank, which would drop the page's accumulated V8 coverage.
  let plNav = 0;
  const plBootGoto = async (search, hash = '') => {
    const sep = search ? '&' : '?';
    await page.goto(`${server.url}${search}${sep}pl=${plNav++}${hash}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
  };
  const ctlValue = (id) => page.evaluate((i) => document.getElementById(i).value, id);
  const bodyMode = () => page.evaluate(() => document.body.dataset.mode);
  const aria = (id) =>
    page.evaluate((i) => document.getElementById(i).getAttribute('aria-pressed'), id);

  // --- Case 1: Copy Link writes a decodable permalink, sets the hash, flips the
  // label, then reverts it. ---------------------------------------------------
  await plBootGoto('');
  await page.fill('#width', '321');
  await page.fill('#height', '258');
  await selAdvanced('#quality', '4');
  await selAdvanced('#antialias', '0.3');
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = '#version 3.8;\n// permalink copy test\nsphere { 0, 1 }';
    ed.dispatchEvent(new Event('input'));
  });
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => window.__permalinkProbe().hash.length > 1, null, {
    timeout: 10_000,
  });
  const copiedUrl = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(
    copiedUrl.startsWith((await page.evaluate(() => location.origin + location.pathname)) + '#'),
    'the copied URL is origin + pathname + #<payload>'
  );
  const decoded = await page.evaluate(async (u) => {
    const { decodeState } = await import('./permalink.js');
    return decodeState(new URL(u).hash.slice(1));
  }, copiedUrl);
  assert.equal(decoded.width, '321', 'permalink round-trips width');
  assert.equal(decoded.height, '258', 'permalink round-trips height');
  assert.equal(decoded.quality, '4', 'permalink round-trips quality');
  assert.equal(decoded.antialias, '0.3', 'permalink round-trips antialias');
  assert.equal(decoded.mode, 'still', 'permalink round-trips the still mode');
  assert.match(decoded.source, /permalink copy test/, 'permalink round-trips the scene source');
  // The label reverts to "Copy Link" once the setTimeout fires.
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copy Link', null, {
    timeout: 4_000,
  });

  // --- Case 2: a still-mode permalink hash hydrates editor + controls. --------
  const stillPayload = await encodeState({
    source: '#version 3.8;\n// HYDRATED still\nbox {}',
    width: '200',
    height: '160',
    quality: '2',
    antialias: 'off',
    threads: '3',
    flags: '+A0.05 +AM2',
    mode: 'still',
    frames: '10',
    fps: '8',
  });
  await plBootGoto('', '#' + stillPayload);
  assert.match(await editorValue(), /HYDRATED still/, 'a permalink hash hydrates the editor');
  assert.equal(await ctlValue('width'), '200', 'permalink hydrates width');
  assert.equal(await ctlValue('height'), '160', 'permalink hydrates height');
  assert.equal(await ctlValue('quality'), '2', 'permalink hydrates quality');
  assert.equal(await ctlValue('antialias'), 'off', 'permalink hydrates antialias');
  assert.equal(await ctlValue('threads'), '3', 'permalink hydrates threads');
  assert.equal(await ctlValue('flags'), '+A0.05 +AM2', 'permalink hydrates raw flags');
  assert.equal(await ctlValue('frames'), '10', 'permalink hydrates frames');
  assert.equal(await ctlValue('fps'), '8', 'permalink hydrates fps');
  assert.equal(await bodyMode(), 'still', 'permalink hydrates still mode');
  assert.equal(await aria('mode-still'), 'true', 'still toggle reflects pressed');

  // --- Case 3: pristine catalog examples use short ?example links. ------------
  await plBootGoto('?example=sourced-wineglass&width=333&height=222&q=5&mode=still');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').dataset.name === 'sourced-wineglass',
    null,
    { timeout: 10_000 }
  );
  assert.match(
    await editorValue(),
    /wineglass\.pov/i,
    'the ?example route hydrates the catalog source'
  );
  assert.equal(await ctlValue('width'), '333', 'the ?example route carries render params');
  assert.equal(await ctlValue('height'), '222', 'the ?example route carries height');
  await page.click('#copy-link-btn');
  await page.waitForFunction(() => window.__permalinkProbe().label === 'Copied', null, {
    timeout: 10_000,
  });
  const exampleCopied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(
    exampleCopied,
    /[?&]example=sourced-wineglass\b/,
    'pristine examples copy as ?example'
  );
  assert.equal(new URL(exampleCopied).hash, '', 'a pristine example copy carries no scene hash');

  await plBootGoto('?example=orbit-moons');
  await page.waitForFunction(
    () => document.getElementById('example-trigger').dataset.name === 'orbit-moons',
    null,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(600);
  assert.deepEqual(
    await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
      pending: window.__liveDraftProbe().pending,
      inFlight: window.__liveDraftProbe().inFlight,
    })),
    { mode: 'still', frames: '24', fps: '24', pending: false, inFlight: false },
    'animated ?example links prepare frames/fps but wait for explicit Render'
  );

  // --- Case 4: an animate-mode permalink hydrates mode + player fps. ----------
  const animPayload = await encodeState({
    source: '#version 3.8;\n// HYDRATED animate\nbox {}',
    width: '256',
    height: '256',
    quality: '',
    antialias: '0.1',
    threads: '',
    mode: 'animate',
    frames: '48',
    fps: '30',
  });
  await plBootGoto('', '#' + animPayload);
  assert.match(await editorValue(), /HYDRATED animate/, 'an animate permalink hydrates the editor');
  assert.equal(await bodyMode(), 'animate', 'permalink hydrates animate mode');
  assert.equal(await aria('mode-animate'), 'true', 'animate toggle reflects pressed');
  assert.equal(await ctlValue('fps'), '30', 'permalink hydrates fps in animate');
  assert.match(
    await page.evaluate(() => document.getElementById('frame-readout').textContent),
    /30 fps/,
    'player.setFps reflects the hydrated fps in the merged readout'
  );
  // A live draft never fires in animate (scheduleDraft self-guards to still).
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().pending),
    false,
    'no live draft schedules in an animate permalink'
  );

  // --- Case 5: a garbage hash WITH ?gist falls through to the gist load. ------
  await plBootGoto('?gist=abc123', '#%%%not-base64%%%');
  await page.waitForFunction((v) => document.getElementById('editor').value === v, PL_GIST, {
    timeout: 10_000,
  });
  assert.match(await editorValue(), /FROM GIST/, 'a junk hash falls through to the gist load');

  // --- Case 6: out-of-range select values in the payload are ignored. ---------
  const bogusSelects = await encodeState({
    source: '#version 3.8;\n// bogus selects\nbox {}',
    width: '512',
    height: '384',
    quality: '42', // not a real option
    antialias: '9.9', // not a real option
    threads: '',
    mode: 'still',
    frames: '24',
    fps: '12',
  });
  await plBootGoto('', '#' + bogusSelects);
  assert.match(
    await editorValue(),
    /bogus selects/,
    'the bogus-select payload still hydrates source'
  );
  assert.equal(
    await ctlValue('quality'),
    '',
    'an out-of-range quality keeps the default option (guard false arm)'
  );
  assert.equal(
    await ctlValue('antialias'),
    '0.1',
    'an out-of-range antialias keeps the default option (guard false arm)'
  );

  // --- Case 7: a garbage hash with NO gist cold-loads the restored scene. -----
  await plBootGoto('', '#zzzz');
  await page.waitForFunction((v) => document.getElementById('editor').value === v, PL_FALLBACK, {
    timeout: 10_000,
  });
  await page.waitForFunction(
    () => window.__liveDraftProbe().pending || window.__liveDraftProbe().inFlight,
    null,
    {
      timeout: 10_000,
    }
  );

  // --- Case 8: the address bar stays clean until Copy Link. -------------------
  // A cold load leaves the hash clean; editing a scene persists local state but
  // does not keep rewriting the visible URL with a full scene payload.
  await plBootGoto('');
  assert.equal(
    await page.evaluate(() => location.hash),
    '',
    'a cold load leaves the URL hash clean until the first change'
  );
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    ed.value = '#version 3.8;\n// LIVE SYNC scene\nsphere { 0, 2 }';
    ed.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(600);
  const cleanEditUrl = await page.evaluate(() => ({
    search: location.search,
    hash: location.hash,
  }));
  assert.match(cleanEditUrl.search, /^\?pl=\d+$/, 'the test boot query may remain');
  assert.equal(
    cleanEditUrl.hash,
    '',
    'ordinary editing leaves the visible URL free of scene payloads'
  );

  // ===========================================================================
  // URL query params (?width=...&q=...&mode=...): seed the controls on load.
  // Valid values land on the controls; unknown select values are ignored,
  // keeping the default option.
  // ===========================================================================
  await plBootGoto(
    '?width=1024&height=768&threads=4&frames=30&fps=20&quality=5&antialias=0.3&flags=%2BAM2&mode=animate'
  );
  assert.equal(await ctlValue('width'), '1024', 'url param sets width');
  assert.equal(await ctlValue('height'), '768', 'url param sets height');
  assert.equal(await ctlValue('threads'), '4', 'url param sets threads');
  assert.equal(await ctlValue('frames'), '30', 'url param sets frames');
  assert.equal(await ctlValue('fps'), '20', 'url param sets fps');
  assert.equal(await ctlValue('quality'), '5', 'url param sets a valid quality option');
  assert.equal(await ctlValue('antialias'), '0.3', 'url param sets a valid antialias option');
  assert.equal(await ctlValue('flags'), '+AM2', 'url param sets the raw flags field');
  assert.equal(await bodyMode(), 'animate', 'url param sets animate mode');

  // Unknown select values are ignored (kept at default); mode=still covers the
  // other mode arm.
  await plBootGoto('?quality=999&antialias=bogus&mode=still');
  assert.equal(await ctlValue('quality'), '', 'an unknown quality param keeps the default option');
  assert.equal(
    await ctlValue('antialias'),
    '0.1',
    'an unknown antialias param keeps the default option'
  );
  assert.equal(await bodyMode(), 'still', 'url param sets still mode');

  await page.unroute('https://api.github.com/gists/*');

  // ===========================================================================
  // Editor autocomplete: the SDL keyword + include-library popup. Drives the
  // ui.js completion glue (caret-anchored popup, keyboard nav, insertion); the
  // ranking/insertion logic itself is covered by the node suite (complete.js is
  // measured in both maps and merged).
  // ===========================================================================
  // Wait until the include manifest has loaded (the readiness attribute), so the
  // shipped symbols (T_Stone1, macros) are in the pool.
  await page.waitForFunction(
    () => document.getElementById('editor').hasAttribute('data-complete-ready'),
    null,
    { timeout: 15_000 }
  );

  // Set the editor text + caret and fire input (the same path real typing takes).
  const openCompleteAt = (value, caretFromEnd = 0) =>
    page.evaluate(
      ({ value, caretFromEnd }) => {
        const e = document.getElementById('editor');
        e.focus();
        e.value = value;
        e.selectionStart = e.selectionEnd = value.length - caretFromEnd;
        e.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { value, caretFromEnd }
    );

  const cmp = () =>
    page.evaluate(() => {
      const b = document.getElementById('complete');
      const active = b.querySelector('.is-active');
      const name = (li) => (li ? li.querySelector('.cmp-name').textContent : null);
      return {
        hidden: b.hidden,
        count: b.children.length,
        first: name(b.children[0]),
        activeIndex: active ? Number(active.dataset.index) : -1,
        expanded: document.getElementById('editor').getAttribute('aria-expanded'),
      };
    });

  // 1. Include-library completion with the caret MID-line (text after the caret
  //    exercises the non-empty caret-marker branch). Arrow nav + Enter accept.
  await openCompleteAt('sphere { 0,1 texture { T_Sto } }', 4);
  let s = await cmp();
  assert.equal(s.hidden, false, 'typing an include prefix opens the completion popup');
  assert.equal(s.first, 'T_Stone1', 'the shipped T_Stone1 texture is the top match for T_Sto');
  assert.equal(s.expanded, 'true', 'aria-expanded reflects the open popup');
  assert.ok(s.count > 10, 'the full T_Stone family is offered');
  assert.ok(
    (
      await page.evaluate(() => document.querySelector('#complete-opt-0 .cmp-file').textContent)
    ).endsWith('.inc'),
    'an include row shows its source .inc file as visible provenance'
  );
  await page.keyboard.press('ArrowDown');
  assert.equal((await cmp()).activeIndex, 1, 'ArrowDown moves the active row down');
  await page.keyboard.press('ArrowUp');
  assert.equal((await cmp()).activeIndex, 0, 'ArrowUp moves it back');
  await page.keyboard.press('Enter');
  s = await cmp();
  assert.equal(s.hidden, true, 'Enter accepts and closes the popup');
  assert.equal(s.expanded, 'false', 'aria-expanded clears on accept');
  assert.ok(
    (await page.evaluate(() => document.getElementById('editor').value)).includes('T_Stone1 }'),
    'Enter inserts the chosen identifier'
  );

  // 2. Tab accepts too, and does NOT fall through to the indent handler.
  await openCompleteAt('union { T_Sto');
  assert.equal((await cmp()).hidden, false, 'popup reopens for a new token');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value),
    'union { T_Stone1',
    'Tab accepts the completion instead of indenting'
  );

  // 3. Incremental typing keeps the popup live; a non-identifier char closes it.
  //    Typing 'sphe' opens at 'sph' (3-char threshold), then the 'e' keydown
  //    arrives while the popup is open (the typed-through-an-open-popup path).
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.focus();
    e.value = '';
    e.selectionStart = e.selectionEnd = 0;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('#editor', 'sphe');
  s = await cmp();
  assert.equal(s.hidden, false, 'typing into a fresh token opens completion');
  assert.equal(s.first, 'sphere', 'sphere is the top keyword match for sphe');
  await page.keyboard.press('Space');
  assert.equal((await cmp()).hidden, true, 'a space ends the token and closes the popup');
  await page.keyboard.press('Space'); // second space: refresh while already closed (no-op path)
  assert.equal((await cmp()).hidden, true, 'staying on no-token keeps it closed');

  // 4. Escape dismisses the current token; typing more of the SAME token stays
  //    quiet, but moving to a NEW token reopens.
  await openCompleteAt('finish { Dul');
  assert.equal((await cmp()).hidden, false, 'a finish-library prefix opens the popup');
  await page.keyboard.press('Escape');
  assert.equal((await cmp()).hidden, true, 'Escape dismisses the popup');
  await openCompleteAt('finish { Dull');
  assert.equal((await cmp()).hidden, true, 'more of the dismissed token stays suppressed');
  await openCompleteAt('finish { Dull specular Shi');
  assert.equal((await cmp()).hidden, false, 'a new token clears the dismissal and reopens');

  // 5. Ctrl+Space browses on an empty token (the "what can go here" affordance).
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.focus();
    e.value = 'object { ';
    e.selectionStart = e.selectionEnd = e.value.length;
  });
  await page.keyboard.press('Control+Space');
  assert.ok((await cmp()).count > 0, 'Ctrl+Space opens a browse list on an empty token');
  await page.keyboard.press('Escape');

  // 6. Macro completion: the signature shows, and accepting drops `name()` with
  //    the caret inside the parens. (Token starts past column 9 so it can't
  //    collide with the Escape-suppression left by the browse step above.)
  await openCompleteAt('object { scale Axis_Rot');
  assert.ok(
    await page.evaluate(() => {
      const li = [...document.getElementById('complete').children].find((x) =>
        x.querySelector('.cmp-sig')
      );
      return li && li.querySelector('.cmp-sig').textContent.startsWith('(');
    }),
    'a macro candidate shows its parameter signature'
  );
  await page.keyboard.press('Enter');
  const macroAccept = await page.evaluate(() => {
    const e = document.getElementById('editor');
    return { value: e.value, caret: e.selectionStart };
  });
  assert.ok(macroAccept.value.includes('Axis_Rotate_Trans()'), 'accepting a macro inserts name() ');
  assert.equal(
    macroAccept.caret,
    macroAccept.value.indexOf('(') + 1,
    'the caret lands inside the parens of an accepted macro'
  );

  // 7. Directive completion after a # (no file provenance on these rows).
  await openCompleteAt('#decl');
  s = await cmp();
  assert.equal(s.hidden, false, 'typing #decl opens directive completion');
  assert.equal(s.first, 'declare', '#declare is the directive match');
  await page.keyboard.press('Escape');

  // 8. Click-to-accept inserts the clicked row.
  await openCompleteAt('union { T_Sto');
  const clicked = await page.evaluate(
    () => document.querySelector('#complete-opt-1 .cmp-name').textContent
  );
  await page.click('#complete-opt-1');
  assert.ok(
    (await page.evaluate(() => document.getElementById('editor').value)).includes(clicked),
    'clicking a row inserts that identifier'
  );

  // 9. A caret-move key closes the popup (the suggestions no longer apply).
  await openCompleteAt('union { T_Sto');
  assert.equal((await cmp()).hidden, false, 'popup is open before the caret move');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await cmp()).hidden, true, 'ArrowLeft closes the popup');

  // 10. The popup stays glued to the caret as the textarea scrolls (open arm),
  //     and a scroll while closed is a no-op (closed arm).
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.focus();
    e.value = Array.from({ length: 60 }, (_, i) => '// filler ' + i).join('\n') + '\nunion { T_Sto';
    e.selectionStart = e.selectionEnd = e.value.length;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal((await cmp()).hidden, false, 'popup opens in a scrollable editor');
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.scrollTop = 20;
    e.dispatchEvent(new Event('scroll'));
  });
  assert.equal((await cmp()).hidden, false, 'the popup survives a scroll (it repositions)');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('scroll')));

  // 11. Blurring the editor closes the popup.
  await openCompleteAt('union { T_Sto');
  assert.equal((await cmp()).hidden, false, 'popup is open before blur');
  await page.evaluate(() => document.getElementById('editor').blur());
  assert.equal((await cmp()).hidden, true, 'leaving the editor closes the popup');

  // 12. Context-aware ordering (v2): inside finish {}, the finish property
  //     'brilliance' leads 'brightness' (a radiosity keyword that otherwise sorts
  //     first alphabetically), proving the block context reorders the list.
  await openCompleteAt('sphere { 0,1 finish { bri');
  assert.equal(
    (await cmp()).first,
    'brilliance',
    'finish properties lead completions inside a finish block'
  );
  await page.keyboard.press('Escape');

  // ===========================================================================
  // Drag-and-drop asset import: drop an image/.inc to stage it into the render
  // FS (relative refs resolve via the wrapper's +L/work), drop a .pov to replace
  // the scene. The pure snippet logic is node-tested; here the DOM + FS round
  // trip and the chip management.
  // ===========================================================================
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.value = '';
    e.selectionStart = e.selectionEnd = 0;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // dragover marks the editor as a drop target and shows the hint overlay.
  await page.evaluate(() =>
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('dragover', { dataTransfer: new DataTransfer(), bubbles: true }))
  );
  assert.ok(
    await page.evaluate(() =>
      document.getElementById('editor-wrap').classList.contains('drag-over')
    ),
    'dragover marks the editor as a drop target'
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.getElementById('drop-hint')).display),
    'flex',
    'the drop hint shows while a file is dragged over the editor'
  );
  // dragleave onto a CHILD (the textarea) keeps the marker; leaving the editor clears it.
  await page.evaluate(() =>
    document.getElementById('editor-wrap').dispatchEvent(
      new DragEvent('dragleave', {
        relatedTarget: document.getElementById('editor'),
        bubbles: true,
      })
    )
  );
  assert.ok(
    await page.evaluate(() =>
      document.getElementById('editor-wrap').classList.contains('drag-over')
    ),
    'dragleave onto a child element does not clear the marker'
  );
  await page.evaluate(() =>
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('dragleave', { bubbles: true }))
  );
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('editor-wrap').classList.contains('drag-over')
    ),
    false,
    'leaving the editor clears the drop-target marker'
  );

  // Drop a PNG and an unsupported .txt together: the image stages + inserts a
  // pigment declare and a chip; the .txt is ignored (covers the loop + reject).
  await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 2;
    cv.height = 2;
    cv.getContext('2d').fillRect(0, 0, 2, 2);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'swatch.png', { type: 'image/png' }));
    dt.items.add(new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById('editor').value.includes('#declare P_swatch'),
    null,
    { timeout: 5_000 }
  );
  const chipNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#assets .asset-name')].map((s) => s.textContent)
    );
  assert.deepEqual(
    await chipNames(),
    ['swatch.png'],
    'only the image stages a chip; the .txt is ignored'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('assets').hidden),
    false,
    'the assets strip shows once something is loaded'
  );
  assert.match(
    await page.evaluate(() => document.getElementById('asset-note').textContent),
    /notes\.txt/,
    'the rejected .txt is named in the skip note'
  );

  // End-to-end: a scene referencing the staged image by RELATIVE name renders,
  // proving the files round trip + the +L/work search path.
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.value = [
      '#version 3.8;',
      'global_settings { assumed_gamma 1.0 }',
      'camera { location <0,0,-3> look_at 0 }',
      'light_source { <2,4,-3> rgb 1 }',
      'plane { z, 1.5 pigment { image_map { png "swatch.png" } } }',
      '',
    ].join('\n');
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.fill('#width', '64');
  await page.fill('#height', '64');
  await selAdvanced('#antialias', 'off');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => /^done in/.test(document.getElementById('status').textContent),
    null,
    { timeout: 30_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('output').naturalWidth),
    64,
    'a dropped image renders via its relative image_map reference'
  );

  // Drop a .inc: it stages and inserts an #include (the text-asset path).
  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['#declare Extra = 1;'], 'extra.inc', { type: 'text/plain' }));
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById('editor').value.includes('#include "extra.inc"'),
    null,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await chipNames(),
    ['swatch.png', 'extra.inc'],
    'the include stages a second chip'
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('asset-note').hidden),
    true,
    'a clean drop clears the skip note'
  );

  // Drop a .pov: dismissing the confirm leaves the scene; accepting replaces it.
  const beforeReplace = await page.evaluate(() => document.getElementById('editor').value);
  page.once('dialog', (d) => d.dismiss());
  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['// REPLACEMENT A'], 'a.pov', { type: 'text/plain' }));
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value),
    beforeReplace,
    'dismissing the replace confirm leaves the scene untouched'
  );
  page.once('dialog', (d) => d.accept());
  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['// REPLACEMENT B'], 'b.pov', { type: 'text/plain' }));
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById('editor').value.includes('REPLACEMENT B'),
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('restore-note').hidden),
    false,
    'an accepted .pov replace offers to restore the prior scene'
  );
  await page.click('#restore-btn');
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value),
    beforeReplace,
    'restoring after a .pov replace brings the prior scene back'
  );

  // A drop with the caret MID-line prefixes a newline so the declare lands on its
  // own line (the line-start guard's false arm).
  await page.evaluate(async () => {
    const e = document.getElementById('editor');
    e.value = 'abc';
    e.selectionStart = e.selectionEnd = 1;
    const cv = document.createElement('canvas');
    cv.width = 2;
    cv.height = 2;
    cv.getContext('2d').fillRect(0, 0, 2, 2);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'mid.png', { type: 'image/png' }));
    document
      .getElementById('editor-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById('editor').value.startsWith('a\n'),
    null,
    { timeout: 5_000 }
  );

  // Removing every asset chip unloads them and hides the strip.
  await page.evaluate(() => {
    document.querySelectorAll('#assets .asset-remove').forEach((b) => b.click());
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('assets').hidden),
    true,
    'removing every asset hides the strip'
  );

  // ===========================================================================
  // Live numeric controls: a slider per top-level `#declare = <number>`, and
  // Alt+drag scrubbing of any numeric literal. The parse/format logic is
  // node-tested; here the panel, the in-place rewrites, and the pointer wiring.
  // ===========================================================================
  // Scene-params disclosure: hidden with no params; a busy scene (more than the
  // auto-open max) reveals it COLLAPSED with the count; a handful auto-opens it.
  // Exercised empty -> many -> empty -> few so every count branch is hit.
  await setSceneSource('camera { location 0 look_at z }'); // no top-level #declare numbers
  assert.equal(
    await page.evaluate(() => document.getElementById('scene-params').hidden),
    true,
    'no #declare params hides the scene-params region'
  );
  await setSceneSource('#declare A=1;\n#declare B=2;\n#declare C=3;\n#declare D=4;\n#declare E=5;');
  assert.deepEqual(
    await page.evaluate(() => ({
      hidden: document.getElementById('scene-params').hidden,
      open: document.getElementById('scene-params').open,
      count: document.getElementById('scene-params-count').textContent,
    })),
    { hidden: false, open: false, count: '(5)' },
    'a busy scene reveals scene-params collapsed, labelled with the count'
  );
  await setSceneSource('// just a comment, no params');
  assert.equal(
    await page.evaluate(() => document.getElementById('scene-params').hidden),
    true,
    'clearing the params hides the region again'
  );

  await setSceneSource('#declare A = 5;\n#declare B = 7;');
  assert.deepEqual(
    await page.evaluate(() => ({
      hidden: document.getElementById('scene-params').hidden,
      open: document.getElementById('scene-params').open,
    })),
    { hidden: false, open: true },
    'a couple of params reveal the region auto-opened'
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('#sliders .slider-name')].map((s) => s.textContent)
    ),
    ['A', 'B'],
    'one slider per declared number'
  );

  // Dragging slider A rewrites its literal; B's tracked span shifts so dragging B
  // then rewrites the correct (moved) literal.
  await page.evaluate(() => {
    const inp = document.querySelectorAll('#sliders input')[0];
    inp.value = '8';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value.split('\n')[0]),
    '#declare A = 8.0;',
    'the slider rewrites its literal in place'
  );
  await page.evaluate(() => {
    const inp = document.querySelectorAll('#sliders input')[1];
    inp.value = '9';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value.split('\n')[1]),
    '#declare B = 9.0;',
    'the second slider tracks its shifted literal correctly'
  );

  // The per-slider reset restores the ORIGINAL literal text (5, not a reformatted
  // 5.0), even after the drag rewrote the code to 8.0.
  await page.evaluate(() => document.querySelector('#sliders .slider-reset').click());
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').value.split('\n')[0]),
    '#declare A = 5;',
    'reset restores the original literal text, not a reformatted value'
  );

  // Editing the number in the CODE makes that the new slider value + default.
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.value = '#declare A = 20;';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('#sliders input').value),
    '20',
    'a code edit updates the slider to the new default value'
  );

  // Inline Alt+drag scrub of a numeric literal, plus the no-scrub guards. The
  // line is TAB-indented so offsetFromPoint's tab-expansion path is exercised.
  const scrubbed = await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.value = '\t#declare S = 5;';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    const cs = getComputedStyle(e);
    const rect = e.getBoundingClientRect();
    const probe = document.createElement('span');
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'])
      probe.style[k] = cs[k];
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.textContent = '0'.repeat(20);
    document.body.appendChild(probe);
    const cw = probe.offsetWidth / 20;
    probe.remove();
    // The '5' sits at visual column 15: a 2-column tab then `#declare S = ` (13).
    const x = rect.left + parseFloat(cs.paddingLeft) + 15 * cw;
    const y = rect.top + parseFloat(cs.paddingTop) + 0.5 * parseFloat(cs.lineHeight);
    // move/up while NOT scrubbing first (the early-return guards)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    // a real Alt+drag scrub
    e.dispatchEvent(
      new MouseEvent('mousedown', { altKey: true, clientX: x, clientY: y, bubbles: true })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: x + 40, clientY: y, bubbles: true })
    );
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    // no-scrub cases: above the text, below the text, and a non-Alt press
    e.dispatchEvent(
      new MouseEvent('mousedown', {
        altKey: true,
        clientX: x,
        clientY: rect.top - 20,
        bubbles: true,
      })
    );
    e.dispatchEvent(
      new MouseEvent('mousedown', {
        altKey: true,
        clientX: x,
        clientY: rect.top + 9999,
        bubbles: true,
      })
    );
    e.dispatchEvent(
      new MouseEvent('mousedown', { altKey: false, clientX: x, clientY: y, bubbles: true })
    );
    return e.value;
  });
  assert.match(scrubbed, /#declare S = \d+\.\d;/, 'Alt+drag scrubs the literal to a fresh value');
  assert.notEqual(scrubbed, '\t#declare S = 5;', 'the scrubbed value changed');

  // Holding Alt reveals the scrub cursor on the editor; releasing clears it.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt' })));
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').style.cursor),
    'ew-resize',
    'holding Alt reveals the number-scrub cursor'
  );
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' })));
  assert.equal(
    await page.evaluate(() => document.getElementById('editor').style.cursor),
    '',
    'releasing Alt clears the scrub cursor'
  );

  // A scene with no declared numbers hides the scene-params region again.
  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.value = 'sphere { 0, 1 }';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('scene-params').hidden),
    true,
    'a scene with no declared numbers hides the scene-params region'
  );

  // ===========================================================================
  // Scene history: a successful render snapshots the scene (deduped + capped),
  // the panel lists versions newest-first, clicking one loads it back, and the
  // load guards (junk / non-array / malformed localStorage) are exercised via
  // seeded reloads.
  // ===========================================================================
  await page.evaluate(() => document.getElementById('mode-still').click()); // ensure the still path
  const histScene = (tag) =>
    `// ${tag}\n#version 3.8;\ncamera { location <0,0,-3> look_at 0 }\n` +
    `light_source { <2,4,-3> rgb 1 }\nsphere { 0, 1 pigment { rgb <1,0,0> } }`;
  const histCount = () =>
    page.evaluate(() => document.querySelectorAll('#history .history-entry').length);
  const histRender = async () => {
    await page.click('#render-btn');
    await page.waitForFunction(
      () => document.getElementById('status').dataset.state === 'done',
      null,
      { timeout: 120_000 }
    );
  };

  await setSceneSource(histScene('HIST ALPHA'));
  await histRender();
  const afterAlpha = await histCount();
  assert.ok(afterAlpha >= 1, 'a successful render adds a history entry');
  assert.equal(
    await page.evaluate(() => document.getElementById('history').hidden),
    false,
    'history panel is revealed once there is a version'
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#history .history-preview').textContent),
    'HIST ALPHA',
    'the newest row previews the rendered scene, comment marker stripped'
  );

  await histRender(); // re-render the identical scene -> dedup, no new entry
  assert.equal(await histCount(), afterAlpha, 're-rendering the same scene does not duplicate it');

  await setSceneSource(histScene('HIST BETA'));
  await histRender();
  assert.equal(await histCount(), afterAlpha + 1, 'a changed render adds a newer version');

  // Opening the panel refreshes it (the toggle-open path); rows are newest-first.
  await page.evaluate(() => (document.getElementById('history').open = true));
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('#history .history-preview')]
        .slice(0, 2)
        .map((p) => p.textContent)
    ),
    ['HIST BETA', 'HIST ALPHA'],
    'versions list newest-first'
  );

  // Clicking a version loads it back (undoable via the restore note) and collapses.
  await page.evaluate(() => document.querySelectorAll('#history .history-entry')[1].click());
  assert.deepEqual(
    await page.evaluate(() => ({
      first: document.getElementById('editor').value.split('\n')[0],
      restore: !document.getElementById('restore-note').hidden,
      open: document.getElementById('history').open,
    })),
    { first: '// HIST ALPHA', restore: true, open: false },
    'loading a version restores its source, offers undo, and collapses the panel'
  );

  // saveHistory is best-effort: a setItem failure during a render must not throw.
  await page.evaluate(() => {
    window.__histOrigSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
  });
  await setSceneSource(histScene('HIST GAMMA'));
  await histRender();
  assert.equal(
    await page.evaluate(() => document.querySelector('#history .history-preview').textContent),
    'HIST GAMMA',
    'a storage failure does not block the in-memory history update'
  );
  await page.evaluate(() => {
    localStorage.setItem = window.__histOrigSet;
  });

  // loadHistory guards via seeded reloads: a valid blob with junk keeps only the
  // well-formed snapshots; a non-array and malformed JSON both yield no history.
  const seedHistory = async (raw) => {
    await page.addInitScript((r) => localStorage.setItem('povrayer.ui.history', r), raw);
    await page.goto(`${server.url}?seed=${seedNav++}`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
  };
  await seedHistory(
    JSON.stringify([
      { t: 1, source: '// kept one' },
      { t: 'bad', source: 'rejected: t not a number' },
      { nope: true },
      { t: 2, source: '// kept two' },
    ])
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.querySelectorAll('#history .history-preview')].map((p) => p.textContent)
    ),
    ['kept one', 'kept two'],
    'a seeded history keeps only well-formed snapshots'
  );
  await seedHistory('{ "not": "an array" }');
  assert.equal(
    await page.evaluate(() => document.getElementById('history').hidden),
    true,
    'a non-array history payload yields no history'
  );
  await seedHistory('{ broken json');
  assert.equal(
    await page.evaluate(() => document.getElementById('history').hidden),
    true,
    'malformed history JSON is swallowed'
  );

  // ===========================================================================
  // Power-user batch: the find / go-to-line bar, the draggable editor/output
  // split (drag + keyboard + persistence), history delta badges, and the
  // draft-size select driving the live draft's rendered size.
  // ===========================================================================

  // -- find bar + split restore (one seeded reload covers both) ---------------
  const FIND_SCENE = 'line a\nfoo bar\nline c\nFOO again\nlast foo';
  await seedReload(JSON.stringify({ source: FIND_SCENE, liveDraft: false, split: 1.5 }));

  assert.equal(
    await page.evaluate(() => document.querySelector('main').style.getPropertyValue('--split')),
    '1.5fr',
    'a saved split restores onto main as --split'
  );
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('split-handle').getAttribute('aria-valuenow')
    ),
    '60',
    'the restored split is mirrored into the separator aria-valuenow (1.5fr = 60%)'
  );

  const findState = () =>
    page.evaluate(() => {
      const e = document.getElementById('editor');
      return {
        hidden: document.getElementById('find-bar').hidden,
        count: document.getElementById('find-count').textContent,
        selStart: e.selectionStart,
        selEnd: e.selectionEnd,
        focused: document.activeElement && document.activeElement.id,
      };
    });

  await page.evaluate(() => {
    const e = document.getElementById('editor');
    e.focus();
    e.setSelectionRange(0, 0);
  });
  await page.keyboard.press('Control+f');
  let find = await findState();
  assert.equal(find.hidden, false, 'Ctrl+F opens the find bar');
  assert.equal(find.focused, 'find-input', 'the find input takes focus');
  assert.equal(find.count, '0/0', 'the counter reads 0/0 before a query');

  // Case-insensitive matches: 'foo bar', 'FOO again', 'last foo'.
  const m1 = FIND_SCENE.toLowerCase().indexOf('foo');
  const m2 = FIND_SCENE.toLowerCase().indexOf('foo', m1 + 1);
  const m3 = FIND_SCENE.toLowerCase().indexOf('foo', m2 + 1);
  await page.keyboard.type('foo');
  find = await findState();
  assert.deepEqual(
    { count: find.count, selStart: find.selStart, selEnd: find.selEnd },
    { count: '1/3', selStart: m1, selEnd: m1 + 3 },
    'typing selects the first match from the caret, counting case-insensitively'
  );

  await page.keyboard.press('Enter');
  find = await findState();
  assert.deepEqual([find.count, find.selStart], ['2/3', m2], 'Enter steps to the next match');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // past the last -> wraps to the first
  find = await findState();
  assert.deepEqual([find.count, find.selStart], ['1/3', m1], 'next wraps past the last match');
  assert.equal(find.focused, 'find-input', 'cycling keeps focus in the find bar (no re-render)');
  await page.keyboard.press('Shift+Enter'); // before the first -> wraps to the last
  find = await findState();
  assert.deepEqual([find.count, find.selStart], ['3/3', m3], 'previous wraps to the last match');

  await page.keyboard.press('Escape');
  find = await findState();
  assert.equal(find.hidden, true, 'Esc closes the find bar');
  assert.equal(find.focused, 'editor', 'Esc hands focus back to the editor');
  assert.deepEqual(
    [find.selStart, find.selEnd],
    [m3, m3 + 3],
    'the editor keeps the current match selected after Esc'
  );

  // Editing the scene closes a still-open bar (stale match offsets).
  await page.keyboard.press('Control+f');
  assert.equal((await findState()).hidden, false, 'the bar reopens for the edit-close check');
  await page.evaluate(() =>
    document.getElementById('editor').dispatchEvent(new Event('input', { bubbles: true }))
  );
  assert.equal((await findState()).hidden, true, 'an editor edit closes the find bar');

  // -- go-to-line --------------------------------------------------------------
  await page.evaluate(() => document.getElementById('editor').focus());
  await page.keyboard.press('Control+g');
  assert.deepEqual(
    await page.evaluate(() => ({
      hidden: document.getElementById('find-bar').hidden,
      placeholder: document.getElementById('find-input').placeholder,
      count: document.getElementById('find-count').textContent,
    })),
    { hidden: false, placeholder: 'go to line', count: '5 lines' },
    'Ctrl+G opens the bar in go-to-line mode with the buffer line count'
  );
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  const line3Start = FIND_SCENE.split('\n').slice(0, 2).join('\n').length + 1;
  find = await findState();
  assert.equal(find.hidden, true, 'go-to-line closes on Enter');
  assert.equal(find.focused, 'editor', 'go-to-line hands focus back to the editor');
  assert.deepEqual(
    [find.selStart, find.selEnd],
    [line3Start, line3Start + 'line c'.length],
    'Enter selects the requested line via selectEditorLine'
  );

  // -- draggable split: pointer drag, keyboard, reset, persistence -------------
  const splitBox = await page.locator('#split-handle').boundingBox();
  assert.ok(splitBox, 'the split handle is laid out at the two-column breakpoint');
  await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 200);
  await page.mouse.down();
  await page.mouse.move(splitBox.x - 200, splitBox.y + 200, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => ({
    split: document.querySelector('main').style.getPropertyValue('--split'),
    editorW: document.getElementById('editor-pane').getBoundingClientRect().width,
    outputW: document.getElementById('output-pane').getBoundingClientRect().width,
  }));
  assert.match(dragged.split, /^[\d.]+fr$/, 'dragging writes an fr count into --split');
  assert.ok(
    parseFloat(dragged.split) < 1.5,
    `dragging left shrinks the editor pane's fr (got ${dragged.split})`
  );
  assert.ok(
    dragged.editorW < dragged.outputW,
    `the panes are visibly uneven after the drag (${dragged.editorW} vs ${dragged.outputW})`
  );

  await page.focus('#split-handle');
  const beforeNudge = parseFloat(dragged.split);
  await page.keyboard.press('ArrowLeft');
  const afterNudge = await page.evaluate(() =>
    parseFloat(document.querySelector('main').style.getPropertyValue('--split'))
  );
  assert.ok(afterNudge < beforeNudge, 'ArrowLeft nudges the split toward the editor');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  assert.equal(
    await page.evaluate(() => document.querySelector('main').style.getPropertyValue('--split')),
    '',
    'Home resets the split to the stylesheet 50/50 default'
  );

  // Persistence: nudge off the default, flush the save, and check the blob.
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const savedSplit = await page.evaluate(
    () => JSON.parse(localStorage.getItem('povrayer.ui.v1')).split
  );
  assert.equal(typeof savedSplit, 'number', 'the split persists as a number in the saved state');
  assert.ok(savedSplit > 1, `ArrowRight saved an editor-favoring split (got ${savedSplit})`);

  await page.locator('#split-handle').dblclick();
  assert.equal(
    await page.evaluate(() => document.querySelector('main').style.getPropertyValue('--split')),
    '',
    'double-click resets the split to 50/50'
  );

  // -- history delta badges ----------------------------------------------------
  const HIST_OLD = 'line one\nline two\nline three';
  const HIST_NEW = 'line one\nline two\nline four\nline five';
  await page.addInitScript(
    ([hist, ui]) => {
      localStorage.setItem('povrayer.ui.history', hist);
      localStorage.setItem('povrayer.ui.v1', ui);
    },
    [
      JSON.stringify([{ t: Date.now(), source: HIST_OLD }]),
      JSON.stringify({ source: HIST_NEW, liveDraft: false }),
    ]
  );
  await page.goto(`${server.url}?seed=${seedNav++}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
    null,
    { timeout: 30_000 }
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#history .history-delta').textContent),
    '+2 −1',
    'the badge counts lines only in the editor (+) and only in the snapshot (−)'
  );

  // Loading the snapshot text and reopening the panel relabels it "current"
  // (the badge recomputes on open, not per keystroke).
  await setSceneSource(HIST_OLD);
  await page.evaluate(() => {
    const h = document.getElementById('history');
    h.open = false;
    h.open = true;
  });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('#history .history-delta');
      return b && b.textContent === 'current';
    },
    null,
    { timeout: 5_000 }
  );

  // -- draft-size select drives the live draft's rendered size -----------------
  await seedReload(
    JSON.stringify({
      source: histScene('DRAFT SIZE'),
      width: '400',
      height: '300',
      antialias: 'off',
      liveDraft: false,
      draft: '256',
    })
  );
  await openAdvanced();
  assert.equal(
    await page.evaluate(() => document.getElementById('draft-size').value),
    '256',
    'a saved draft size restores into the select'
  );
  await page.click('#live-toggle');
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        o.src.startsWith('blob:') &&
        o.naturalWidth === 256 &&
        o.naturalHeight === 192
      );
    },
    null,
    { timeout: 60_000 }
  );
  // Raising the edge past the render size re-drafts the unchanged scene at the
  // uncapped 400×300 (the no-upscale clamp).
  await selAdvanced('#draft-size', '512');
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        o.naturalWidth === 400 &&
        o.naturalHeight === 300
      );
    },
    null,
    { timeout: 60_000 }
  );

  // ===========================================================================
  // Power-user keyboard batch: the editor line ops (Ctrl/Cmd+/ comment toggle,
  // Alt+arrow line move / number step / Alt+Shift duplicate) and the document
  // shortcuts (Ctrl/Cmd+S scene download, Ctrl/Cmd+K example browser, the ?
  // shortcuts overlay), plus the w/h swap button, the find no-match arm, the
  // one-shot final-quality render, and the animate hint's NaN-frames fallback.
  // Everything below runs on ONE page (no reloads): the scene-download blob's
  // 10s revoke grace has to elapse in-page, asserted at the end of the batch.
  // ===========================================================================
  await seedReload(JSON.stringify({ source: 'keyboard batch', liveDraft: false }));

  const selRange = () =>
    page.evaluate(() => {
      const e = document.getElementById('editor');
      return [e.selectionStart, e.selectionEnd];
    });

  // -- Ctrl/Cmd+S: download the scene as scene.pov -----------------------------
  // Stubbed anchor click (the export-pipeline idiom) captures the filename;
  // createObjectURL/revokeObjectURL wrappers capture the text/plain blob URL so
  // the revoke-after-grace can be asserted later without a blind sleep.
  await page.evaluate(() => {
    window.__dl = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push(this.download);
    };
    window.__sceneUrls = [];
    window.__revoked = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = origCreate(b);
      if (b instanceof Blob && b.type === 'text/plain') window.__sceneUrls.push(u);
      return u;
    };
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => {
      window.__revoked.push(u);
      origRevoke(u);
    };
  });
  const DOWNLOAD_SCENE = '// downloaded scene\nsphere { 0, 1 }';
  await setEditor(DOWNLOAD_SCENE, 0, 0);
  await page.keyboard.press('Control+s');
  assert.deepEqual(
    await page.evaluate(() => window.__dl),
    ['scene.pov'],
    'Ctrl+S downloads the scene as scene.pov'
  );
  assert.equal(
    await page.evaluate(() => fetch(window.__sceneUrls[0]).then((r) => r.text())),
    DOWNLOAD_SCENE,
    'the downloaded blob carries the editor text'
  );
  await page.click('#download-scene-btn');
  assert.deepEqual(
    await page.evaluate(() => window.__dl),
    ['scene.pov', 'scene.pov'],
    'the visible Download .pov button uses the same scene download path'
  );
  // setEditor never fired input, so only downloadScene's saveState flush can
  // have put this text into the saved blob.
  assert.equal(
    await page.evaluate(() => JSON.parse(localStorage.getItem('povrayer.ui.v1')).source),
    DOWNLOAD_SCENE,
    'Ctrl+S flushes the debounced save before building the download'
  );

  // -- Ctrl/Cmd+/ comment toggle ------------------------------------------------
  // Single line, caret only: comment, caret shifted by the marker (preserve arm).
  await setEditor('alpha\nbeta', 2, 2);
  await page.keyboard.press('Control+/');
  assert.equal(await editorValue(), '// alpha\nbeta', 'Ctrl+/ comments the caret line');
  assert.deepEqual(await selRange(), [5, 5], 'the caret shifts by the inserted marker');
  // Same toggle via Cmd (the metaKey arm), now uncommenting.
  await page.keyboard.press('Meta+/');
  assert.equal(await editorValue(), 'alpha\nbeta', 'Cmd+/ uncomments an all-commented block');
  assert.deepEqual(await selRange(), [2, 2], 'the caret shifts back with the removed marker');

  // Mixed multi-line block with a blank line: comments EVERY non-blank line
  // (idempotent over a mixed region), the blank line gains no marker, and the
  // block stays selected (the select arm).
  await setEditor('// one\n\ntwo', 0, 11);
  await page.keyboard.press('Control+/');
  assert.equal(
    await editorValue(),
    '// // one\n\n// two',
    'a mixed selection comments every non-blank line, skipping the blank'
  );
  assert.deepEqual(await selRange(), [0, 17], 'the multi-line edit keeps the block selected');
  // Now every non-blank line is commented, so the toggle uncomments back.
  await page.keyboard.press('Control+/');
  assert.equal(
    await editorValue(),
    '// one\n\ntwo',
    'toggling again uncomments back to the mixed original'
  );
  assert.deepEqual(await selRange(), [0, 11], 'the uncommented block stays selected');

  // An all-blank block produces no edit (toggleLineComment returns false). The
  // selection also ends on a newline, so selectedLineRange excludes that line.
  await setEditor('a\n\n\nb', 2, 3);
  await page.keyboard.press('Control+/');
  assert.equal(await editorValue(), 'a\n\n\nb', 'Ctrl+/ over blank lines only is a no-op');

  // -- Alt+ArrowUp/Down: move lines ----------------------------------------------
  await setEditor('one\ntwo\nthree', 1, 1);
  await page.keyboard.press('Alt+ArrowUp');
  assert.equal(await editorValue(), 'one\ntwo\nthree', 'Alt+Up on the first line is a no-op');
  await setEditor('one\ntwo\nthree', 12, 12);
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await editorValue(), 'one\ntwo\nthree', 'Alt+Down on the last line is a no-op');

  await setEditor('one\ntwo\nthree', 5, 5);
  await page.keyboard.press('Alt+ArrowUp');
  assert.equal(await editorValue(), 'two\none\nthree', 'Alt+Up swaps the line with the one above');
  assert.deepEqual(await selRange(), [1, 1], 'the caret rides the moved line up');
  // Down with a further line below (the indexOf-found arm)...
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await editorValue(), 'one\ntwo\nthree', 'Alt+Down swaps back down');
  assert.deepEqual(await selRange(), [5, 5], 'the caret rides the moved line down');
  // ...and down onto the unterminated last line (the indexOf -1 arm).
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(await editorValue(), 'one\nthree\ntwo', 'Alt+Down swaps with the final line');
  assert.deepEqual(await selRange(), [11, 11], 'the caret lands on the now-last line');

  // -- Alt+Shift+ArrowUp/Down: duplicate lines -----------------------------------
  await setEditor('dup me\nkeep', 2, 2);
  await page.keyboard.press('Alt+Shift+ArrowUp');
  assert.equal(await editorValue(), 'dup me\ndup me\nkeep', 'Alt+Shift+Up duplicates the line');
  assert.deepEqual(await selRange(), [2, 2], 'duplicating up keeps the caret on the upper copy');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  assert.equal(
    await editorValue(),
    'dup me\ndup me\ndup me\nkeep',
    'Alt+Shift+Down duplicates again'
  );
  assert.deepEqual(await selRange(), [9, 9], 'duplicating down moves the caret to the lower copy');

  // -- Alt+arrows on a number literal: keyboard scrubbing -------------------------
  // A collapsed caret inside a literal steps it (magnitude-aware step, here
  // 0.01) and leaves the literal selected...
  await setEditor('radius 2.5 end', 8, 8);
  await page.keyboard.press('Alt+ArrowUp');
  assert.equal(await editorValue(), 'radius 2.51 end', 'Alt+Up steps the literal under the caret');
  assert.deepEqual(await selRange(), [7, 11], 'the stepped literal is left selected');
  // ...so a held/repeated press keeps stepping (the exact-token-selection arm);
  // Shift makes it a 10x step, and ArrowDown steps the value down.
  await page.keyboard.press('Alt+Shift+ArrowDown');
  assert.equal(await editorValue(), 'radius 2.41 end', 'Alt+Shift+Down re-steps the selection 10x');
  assert.deepEqual(await selRange(), [7, 11], 'the re-stepped literal stays selected');
  // A selection that is NOT exactly the literal means line ops, not stepping.
  await setEditor('num 123\nlast', 4, 5);
  await page.keyboard.press('Alt+ArrowDown');
  assert.equal(
    await editorValue(),
    'last\nnum 123',
    'a partial selection inside a literal falls through to the line move'
  );
  assert.deepEqual(await selRange(), [9, 10], 'the partial selection rides the moved line');

  // -- ? shortcuts overlay ---------------------------------------------------------
  const shortcutsState = () =>
    page.evaluate(() => ({
      hidden: document.getElementById('shortcuts').hidden,
      focused: document.activeElement && document.activeElement.id,
    }));
  // Inside a text field ? must stay a character (isTextField).
  await setEditor('', 0, 0);
  await page.keyboard.press('?');
  assert.equal(await editorValue(), '?', '? typed in the editor stays a character');
  assert.equal((await shortcutsState()).hidden, true, '? in a text field never opens the overlay');
  // From a non-typing target it opens the panel and hands it focus.
  await page.evaluate(() => document.getElementById('editor').blur());
  await page.keyboard.press('?');
  assert.deepEqual(
    await shortcutsState(),
    { hidden: false, focused: 'shortcuts' },
    '? opens the shortcuts overlay and focuses the panel'
  );
  // ? again (focus on the panel, not a field) toggles it closed.
  await page.keyboard.press('?');
  assert.equal((await shortcutsState()).hidden, true, '? toggles the overlay closed');
  // The footer kbd hint opens it too; Esc closes with focus back on the hint.
  await page.click('#shortcuts-hint');
  assert.deepEqual(
    await shortcutsState(),
    { hidden: false, focused: 'shortcuts' },
    'the footer hint click opens the overlay'
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await shortcutsState(),
    { hidden: true, focused: 'shortcuts-hint' },
    'Esc closes the overlay and restores focus to the opener'
  );

  // -- Ctrl/Cmd+K example browser ---------------------------------------------------
  // Guard: while the shortcuts overlay is up, Ctrl+K leaves the screen alone.
  await page.click('#shortcuts-hint');
  await page.keyboard.press('Control+k');
  assert.equal(await browserExpanded(), 'false', 'Ctrl+K is ignored under the shortcuts overlay');
  await page.keyboard.press('Control+Shift+K');
  assert.equal(
    await page.evaluate(() => document.getElementById('gallery').hidden),
    true,
    'Ctrl+Shift+K is ignored under the shortcuts overlay'
  );
  assert.equal((await shortcutsState()).hidden, false, 'the overlay survives the swallowed chord');
  await page.keyboard.press('Escape');
  // Guard: an open completion popup owns the keyboard. (This page is a fresh
  // load, so wait for the include manifest before relying on a T_Sto match.)
  await page.waitForFunction(
    () => document.getElementById('editor').hasAttribute('data-complete-ready'),
    null,
    { timeout: 15_000 }
  );
  await openCompleteAt('union { T_Sto');
  assert.equal((await cmp()).hidden, false, 'the completion popup is open for the guard check');
  await page.keyboard.press('Control+k');
  assert.equal(await browserExpanded(), 'false', 'Ctrl+K is ignored while completion is open');
  await page.keyboard.press('Control+Shift+K');
  assert.equal(
    await page.evaluate(() => document.getElementById('gallery').hidden),
    true,
    'Ctrl+Shift+K is ignored while completion is open'
  );
  await page.keyboard.press('Escape'); // dismiss the popup
  // With nothing else open, Ctrl+K opens the example browser on the search box.
  await page.keyboard.press('Control+k');
  assert.equal(await browserExpanded(), 'true', 'Ctrl+K opens the example browser');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'example-search',
    'Ctrl+K hands focus to the example search'
  );
  // Ctrl+K while it is already open is ignored (re-opening would reset state).
  await page.keyboard.type('die');
  await page.keyboard.press('Control+k');
  assert.equal(await browserExpanded(), 'true', 'a second Ctrl+K leaves the open browser alone');
  assert.equal(
    await page.evaluate(() => document.getElementById('example-search').value),
    'die',
    'the swallowed re-open preserves the typed filter'
  );
  await page.keyboard.press('Escape'); // close the browser
  await page.keyboard.press('Control+Shift+K');
  assert.deepEqual(
    await page.evaluate(() => ({
      hidden: document.getElementById('gallery').hidden,
      focused: document.activeElement?.id,
    })),
    { hidden: false, focused: 'gallery-search' },
    'Ctrl+Shift+K opens the gallery'
  );
  await page.keyboard.press('Control+Shift+K');
  assert.equal(
    await page.evaluate(() => document.getElementById('gallery').hidden),
    false,
    'a second Ctrl+Shift+K leaves the open gallery alone'
  );
  await page.keyboard.press('Escape');

  // -- Shift+Ctrl/Cmd+Enter: one-shot final-quality override -------------------------
  // The armed render runs at quality 9 + antialias 0.05 (visible in the download
  // name) without touching the persisted control values.
  await typeScene(VALID_SCENE);
  await page.fill('#width', '64');
  await page.fill('#height', '48');
  await selAdvanced('#antialias', 'off');
  await page.keyboard.press('Shift+Control+Enter');
  await waitState('done');
  assert.match(
    await page.evaluate(() => document.getElementById('download-btn').getAttribute('download')),
    /^render-64x48-q9-a005\.png$/,
    'the final-quality chord renders at q9 + aa 0.05'
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      quality: document.getElementById('quality').value,
      antialias: document.getElementById('antialias').value,
    })),
    { quality: '', antialias: 'off' },
    'the one-shot override leaves the persisted controls untouched'
  );

  // -- the w/h swap button -----------------------------------------------------------
  await page.fill('#width', '320');
  await page.fill('#height', '100');
  await page.click('#swap-size');
  assert.deepEqual(
    await page.evaluate(() => ({
      width: document.getElementById('width').value,
      height: document.getElementById('height').value,
      aspect: document.querySelector('#output-plate .hint').style.aspectRatio,
    })),
    { width: '100', height: '320', aspect: '100 / 320' },
    'the swap button exchanges w/h and re-aspects the empty-state plate'
  );

  // -- find: a query with no matches ---------------------------------------------------
  await setEditor('nothing to see here', 0, 0);
  await page.keyboard.press('Control+f');
  await page.keyboard.type('zebra');
  assert.deepEqual(
    await page.evaluate(() => ({
      hidden: document.getElementById('find-bar').hidden,
      count: document.getElementById('find-count').textContent,
    })),
    { hidden: false, count: '0/0' },
    'a no-match query reads 0/0 with the bar still open'
  );
  await page.keyboard.press('Escape');

  // -- animate empty-plate hint: unparsable frames falls back to 24 ---------------------
  await page.click('#mode-animate');
  await page.evaluate(() => {
    const f = document.getElementById('frames');
    f.value = '';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('#output-plate .hint').textContent),
    'Render to ray-trace 24 frames of this scene.',
    'an empty frames input quotes the 24-frame default in the animate hint'
  );
  await page.click('#mode-still');

  // The scene-download blob from the Ctrl+S at the top of this batch is revoked
  // after a 10s grace; everything since has been eating that grace, so this
  // bounded wait is the remainder at most.
  await page.waitForFunction(
    () =>
      window.__sceneUrls.length > 0 &&
      window.__sceneUrls.every((u) => window.__revoked.includes(u)),
    null,
    { timeout: 15_000 }
  );

  // ===========================================================================
  // Output-pane interaction batch: render-state tab chrome (favicon + title),
  // hold-to-peek A/B compare (Alt+B + press-and-hold), the zoom cycle's
  // click-anchored 1:1/4x + drag-to-pan, the full-height hero stage, and
  // Enter-to-render in the raw-flags field. Continues on the keyboard-batch
  // page: live draft is off, and the page's ONE render so far (the 64x48
  // final-quality chord) means prevUrl is still empty.
  // ===========================================================================
  const BASE_TITLE = 'povrayer, POV-Ray in the browser';
  const tabState = () =>
    page.evaluate(() => ({
      title: document.title,
      gold: document.querySelector('link[rel=icon]').href.includes('ffd23f'),
      dim: document.querySelector('link[rel=icon]').href.includes('98a1ab'),
    }));
  const outputState = () =>
    page.evaluate(() => ({
      w: document.getElementById('output').naturalWidth,
      status: document.getElementById('status').textContent,
      cls: document.getElementById('output').className,
    }));
  const waitOutputWidth = (w, t = 30_000) =>
    page.waitForFunction((n) => document.getElementById('output').naturalWidth === n, w, {
      timeout: t,
    });
  const renderAt = async (w, h) => {
    await page.fill('#width', String(w));
    await page.fill('#height', String(h));
    await page.click('#render-btn');
    await waitState('done');
  };

  // -- discoverability: the peek binding is listed in the shortcuts overlay ----
  assert.ok(
    await page.evaluate(() =>
      [...document.querySelectorAll('#shortcuts dd')].some((d) =>
        d.textContent.includes('peek at the previous render')
      )
    ),
    'the shortcuts overlay must list the Alt+B peek binding'
  );

  // -- peek with no history yet: a strict no-op --------------------------------
  // This page has shown exactly one image, so prevUrl is null and the hold
  // must change nothing (the !prevUrl guard).
  const beforeNoHistory = await outputState();
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  assert.deepEqual(
    await outputState(),
    beforeNoHistory,
    'Alt+B with no previous render must change nothing'
  );
  await page.keyboard.up('b');
  await page.keyboard.up('Alt');

  // -- tab chrome: busy dims the orb + narrates the title ----------------------
  await typeScene(VALID_SCENE);
  await page.fill('#width', '200');
  await page.fill('#height', '150');
  // startRender runs synchronously up to its first await, so reading the tab
  // state in the same evaluate as the click observes the busy phase without
  // racing a fast render.
  const busyTab = await page.evaluate(() => {
    document.getElementById('render-btn').click();
    return {
      title: document.title,
      dim: document.querySelector('link[rel=icon]').href.includes('98a1ab'),
    };
  });
  assert.deepEqual(
    busyTab,
    { title: 'rendering… · povrayer', dim: true },
    'a render in flight dims the orb favicon and titles the tab "rendering…"'
  );
  await waitState('done');
  assert.deepEqual(
    await tabState(),
    { title: BASE_TITLE, gold: true, dim: false },
    'a render finishing on a VISIBLE tab restores the gold orb and resting title'
  );

  // -- tab chrome: finishing while hidden surfaces the payoff in the title -----
  await page.evaluate(() => {
    // Instance-level override (configurable, so it can be deleted) shadows the
    // prototype getter: the app reads document.hidden at setStatus time.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await renderAt(240, 180);
  assert.match(
    await page.evaluate(() => document.title),
    /^done in \d+\.\d\ds · 240×180 · povrayer$/,
    'finishing while hidden puts the done-line in the tab title'
  );
  // Returning to the tab restores the resting title via visibilitychange.
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(
    await tabState(),
    { title: BASE_TITLE, gold: true, dim: false },
    'returning to the tab restores the resting title'
  );

  // -- tab chrome: error while hidden -------------------------------------------
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await typeScene(BROKEN_SCENE);
  await page.click('#render-btn');
  await waitState('error');
  assert.deepEqual(
    await tabState(),
    { title: 'render failed · povrayer', gold: true, dim: false },
    'an error while hidden titles the tab "render failed" with the orb back to gold'
  );
  // A non-done/error state while still hidden rests the title (the mode switch
  // routes through setStatus with an idle state).
  await page.click('#mode-animate');
  assert.equal(
    await page.evaluate(() => document.title),
    BASE_TITLE,
    'an idle-state status while hidden keeps the resting title'
  );
  await page.click('#mode-still');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // -- hold-to-peek: Alt+B swaps the previous render in while held -------------
  await typeScene(VALID_SCENE);
  await renderAt(80, 60); // prevUrl is now the 240x180 hidden-done render
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  await waitOutputWidth(240);
  assert.equal(
    await page.evaluate(() => document.getElementById('status').textContent),
    'previous render',
    'the peek labels the status line so the swap is legible'
  );
  // Key-repeat re-fires keydown for the whole hold; the peeking guard absorbs it.
  await page.keyboard.down('b');
  assert.equal((await outputState()).w, 240, 'a repeated Alt+B keydown keeps the same peek');
  await page.keyboard.up('b');
  await page.keyboard.up('Alt');
  await waitOutputWidth(80);
  assert.match(
    (await outputState()).status,
    /^done in \d+\.\d\ds · 80×60$/,
    'releasing the peek restores the current render and the saved status text'
  );

  // -- peek stranding guards: window blur, and a frame landing mid-peek --------
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  await waitOutputWidth(240);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); // Alt+Tab away
  assert.equal((await outputState()).w, 80, 'a window blur mid-peek restores the current render');
  await page.keyboard.up('b'); // endPeek no-op: the blur already restored
  await page.keyboard.up('Alt');
  // A render finishing WHILE peeked must win over the release's restore.
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  await waitOutputWidth(240);
  await page.evaluate(() => document.getElementById('render-btn').click());
  await page.fill('#width', '96'); // (set after click: the running render read 80x60)
  await page.fill('#height', '72');
  await waitState('done');
  assert.equal((await outputState()).w, 80, 'the freshly landed frame beats the held peek');
  await page.keyboard.up('b');
  await page.keyboard.up('Alt');
  assert.equal((await outputState()).w, 80, 'releasing after the landing changes nothing');
  await renderAt(96, 72); // prevUrl becomes the 80x60 render for the pointer peek

  // -- hold-to-peek: press-and-hold the image itself ----------------------------
  const imgPoint = async (fx, fy) => {
    const r = await page.evaluate(() => {
      const b = document.getElementById('output').getBoundingClientRect();
      return { left: b.left, top: b.top, width: b.width, height: b.height };
    });
    return { x: r.left + fx * r.width, y: r.top + fy * r.height };
  };
  const center = await imgPoint(0.5, 0.5);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.waitForFunction(
    () =>
      document.getElementById('status').textContent === 'previous render' &&
      document.getElementById('output').naturalWidth === 80,
    null,
    { timeout: 5_000 }
  );
  await page.mouse.up();
  await waitOutputWidth(96);
  assert.equal(
    (await outputState()).cls,
    '',
    'a hold-to-peek release must not also cycle the zoom (suppressed click)'
  );

  // -- zoom cycle: a QUICK image click engages an anchored 1:1 ------------------
  await page.mouse.click(center.x, center.y);
  assert.equal((await outputState()).cls, 'zoom-1x', 'a quick image click cycles fit -> 1:1');

  // -- zoom cycle: the next image click engages 4x anchored on the click point --
  const mid = await imgPoint(0.5, 0.5); // recompute: 1:1 re-laid the image out
  await page.mouse.click(mid.x, mid.y);
  const anchored = await page.evaluate(() => {
    const plate = document.getElementById('output-plate');
    const o = document.getElementById('output');
    const clampTo = (n, hi) => Math.min(hi, Math.max(0, Math.round(n)));
    return {
      cls: o.className,
      width: o.style.width,
      sl: plate.scrollLeft,
      st: plate.scrollTop,
      expL: clampTo(
        0.5 * o.clientWidth - plate.clientWidth / 2,
        plate.scrollWidth - plate.clientWidth
      ),
      expT: clampTo(
        0.5 * o.clientHeight - plate.clientHeight / 2,
        plate.scrollHeight - plate.clientHeight
      ),
    };
  });
  assert.equal(anchored.cls, 'zoom-1x zoom-4x', 'the second click engages the 4x pixel-peep');
  assert.equal(anchored.width, '384px', '4x writes 4 x the 96px natural width inline');
  assert.ok(
    Math.abs(anchored.sl - anchored.expL) <= 2 && Math.abs(anchored.st - anchored.expT) <= 2,
    `the clicked point lands centered (got ${anchored.sl},${anchored.st}, want ${anchored.expL},${anchored.expT})`
  );

  // -- drag-to-pan is mouse/pen only: touch + secondary buttons never grab ------
  assert.deepEqual(
    await page.evaluate(() => {
      const plate = document.getElementById('output-plate');
      const before = { sl: plate.scrollLeft, st: plate.scrollTop };
      const fire = (type, init) =>
        plate.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }));
      fire('pointerdown', {
        pointerType: 'touch',
        pointerId: 90,
        button: 0,
        clientX: 600,
        clientY: 400,
      });
      fire('pointermove', { pointerType: 'touch', pointerId: 90, clientX: 560, clientY: 360 });
      fire('pointerup', { pointerType: 'touch', pointerId: 90 });
      fire('pointerdown', {
        pointerType: 'mouse',
        pointerId: 91,
        button: 2,
        clientX: 600,
        clientY: 400,
      });
      fire('pointermove', { pointerType: 'mouse', pointerId: 91, clientX: 560, clientY: 360 });
      fire('pointerup', { pointerType: 'mouse', pointerId: 91 });
      return {
        moved: plate.scrollLeft !== before.sl || plate.scrollTop !== before.st,
        panning: plate.classList.contains('panning'),
      };
    }),
    { moved: false, panning: false },
    'touch presses and secondary buttons must not start a pan'
  );

  // -- drag-to-pan: a real mouse drag scrolls the plate, then eats its click ----
  const panStart = await page.evaluate(() => {
    const plate = document.getElementById('output-plate');
    const r = plate.getBoundingClientRect();
    window.__panBefore = { sl: plate.scrollLeft, st: plate.scrollTop };
    return {
      x: r.left + r.width / 2,
      y: r.top + Math.min(r.height, window.innerHeight - r.top) / 2,
    };
  });
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x - 60, panStart.y - 40, { steps: 3 });
  const midDrag = await page.evaluate(() => {
    const plate = document.getElementById('output-plate');
    const clampTo = (n, hi) => Math.min(hi, Math.max(0, n));
    return {
      panning: plate.classList.contains('panning'),
      cursor: getComputedStyle(plate).cursor,
      sl: plate.scrollLeft,
      expL: clampTo(window.__panBefore.sl + 60, plate.scrollWidth - plate.clientWidth),
      st: plate.scrollTop,
      expT: clampTo(window.__panBefore.st + 40, plate.scrollHeight - plate.clientHeight),
    };
  });
  assert.equal(midDrag.panning, true, 'a moving drag flags the plate as panning');
  assert.equal(midDrag.cursor, 'grabbing', 'the plate shows the grabbing cursor mid-drag');
  assert.ok(
    Math.abs(midDrag.sl - midDrag.expL) <= 2 && Math.abs(midDrag.st - midDrag.expT) <= 2,
    `the drag pans the scroll position (got ${midDrag.sl},${midDrag.st}, want ${midDrag.expL},${midDrag.expT})`
  );
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => ({
      panning: document.getElementById('output-plate').classList.contains('panning'),
      cls: document.getElementById('output').className,
    })),
    { panning: false, cls: 'zoom-1x zoom-4x' },
    'releasing the drag drops the panning flag and suppresses the zoom-cycle click'
  );
  await page.mouse.move(10, 10); // off the plate: the pointerleave release arm

  // -- a sub-4px press stays a click: it cycles 4x back to fit ------------------
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 2, panStart.y);
  await page.mouse.up();
  assert.deepEqual(
    await page.evaluate(() => {
      const o = document.getElementById('output');
      return { cls: o.className, width: o.style.width };
    }),
    { cls: '', width: '' },
    'a press that moves under the pan threshold still counts as a zoom click'
  );

  // -- clicks on the surrounding mat are not zoom clicks ------------------------
  // The full-height stage leaves mat on every side of the centered image; a
  // click there must not cycle (each probe trips one bounds arm).
  for (const [fx, fy] of [
    [-0.3, 0.5],
    [1.3, 0.5],
    [0.5, -0.5],
    [0.5, 1.5],
  ]) {
    const p = await imgPoint(fx, fy);
    await page.mouse.click(p.x, p.y);
  }
  assert.equal((await outputState()).cls, '', 'mat clicks around the image never cycle the zoom');

  // -- animate mode: the hidden image is neither zoomable nor peekable ----------
  await page.click('#mode-animate');
  const animStatus = (await outputState()).status;
  const platePoint = await page.evaluate(() => {
    const r = document.getElementById('output-plate').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height, 300) / 2 };
  });
  await page.mouse.click(platePoint.x, platePoint.y);
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  assert.deepEqual(
    await page.evaluate(() => ({
      cls: document.getElementById('output').className,
      status: document.getElementById('status').textContent,
    })),
    { cls: '', status: animStatus },
    'with the still image hidden, plate clicks and Alt+B are no-ops'
  );
  await page.keyboard.up('b');
  await page.keyboard.up('Alt');
  await page.click('#mode-still');

  // -- a live draft's footprint hold yields to the zoom and returns at fit ------
  await page.fill('#width', '200');
  await page.fill('#height', '150');
  await page.click('#live-toggle'); // live back on for one draft
  await typeScene(LIVE_SCENE + '// zoom-vs-held-width\n');
  await page.waitForFunction(
    () => document.getElementById('output').style.width === '200px',
    null,
    { timeout: 60_000 }
  );
  await page.click('#output'); // fit -> 1:1
  assert.equal(
    await page.evaluate(() => document.getElementById('output').style.width),
    '',
    '1:1 suspends the draft footprint hold (true device pixels)'
  );
  await page.click('#output-pane .zoom-toggle'); // 1:1 -> 4x
  assert.equal(
    await page.evaluate(() => document.getElementById('output').style.width),
    '800px',
    'the 4x width wins over the held draft width'
  );
  await page.click('#output-pane .zoom-toggle'); // 4x -> fit
  assert.equal(
    await page.evaluate(() => document.getElementById('output').style.width),
    '200px',
    'returning to fit restores the draft footprint hold'
  );
  await page.click('#live-toggle'); // live back off for the rest of the batch

  // -- the full-height hero stage ------------------------------------------------
  // The output pane is a flex column whose plate absorbs the spare height with
  // the image at its optical center; the meta rows pin below the plate.
  const stage = await page.evaluate(() => {
    const plate = document.getElementById('output-plate');
    const p = plate.getBoundingClientRect();
    const img = document.getElementById('output').getBoundingClientRect();
    return {
      direction: getComputedStyle(document.getElementById('output-pane')).flexDirection,
      grow: getComputedStyle(plate).flexGrow,
      centered: Math.abs((img.top + img.bottom) / 2 - (p.top + p.bottom) / 2) <= 1,
      stageTallerThanImage: p.height > img.height + 60,
    };
  });
  assert.deepEqual(
    stage,
    { direction: 'column', grow: '1', centered: true, stageTallerThanImage: true },
    'the plate fills the output column with the hero at its vertical center'
  );

  // -- Enter in the raw-flags field renders --------------------------------------
  await page.fill('#width', '72');
  await page.fill('#height', '54');
  await fillAdvanced('#flags', '+A0.3'); // leaves focus in the flags field
  await page.keyboard.press('Enter');
  await waitState('done');
  assert.match(
    (await outputState()).status,
    /^done in \d+\.\d\ds · 72×54$/,
    'plain Enter in the raw-flags field triggers a render like its siblings'
  );
  await fillAdvanced('#flags', ''); // leave no flags behind for later batches

  // ===========================================================================
  // Mobile UX (coarse pointer): the iPhone fixes. A separate context emulates a
  // touch, mobile-viewport, coarse-pointer device so the @media (pointer:coarse)
  // editor/example rules actually apply (the default desktop page is fine-
  // pointer). Chromium can't reproduce iOS's focus-zoom or text inflation, so we
  // assert the CSS guards that prevent them by computed style; the real on-device
  // zoom/inflation behaviour still needs a manual iPhone check. Live-draft is
  // seeded OFF so no render fires while we only read layout. Runs in its own
  // context, torn down before the shared browser closes; its coverage is not
  // merged (the main page already exercises every ui.js branch).
  // ===========================================================================
  {
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      reducedMotion: 'reduce', // stable popover geometry (no entrance translate)
    });
    const mpage = await mctx.newPage();
    await mpage.addInitScript(() =>
      localStorage.setItem('povrayer.ui.v1', JSON.stringify({ liveDraft: false }))
    );
    await mpage.goto(server.url, { waitUntil: 'load' });
    assert.equal(
      await mpage.evaluate(() => globalThis.crossOriginIsolated),
      true,
      'the mobile context must still be cross-origin isolated'
    );
    await mpage.waitForFunction(
      () => document.querySelectorAll('#example-listbox .ex-option').length >= 4,
      null,
      { timeout: 30_000 }
    );
    assert.equal(
      await mpage.evaluate(() => matchMedia('(pointer: coarse)').matches),
      true,
      'the mobile context must report a coarse pointer (the iOS rules key on it)'
    );

    // iOS focus-zoom floor: the editor and the two layers locked to it (the line
    // numbers + the syntax overlay) must all be >= 16px AND identical, or iOS
    // zooms the page on focus and the colored overlay drifts off the caret.
    const fonts = await mpage.evaluate(() => {
      const fs = (id) => getComputedStyle(document.getElementById(id)).fontSize;
      return { editor: fs('editor'), gutter: fs('gutter'), highlight: fs('editor-highlight') };
    });
    assert.equal(fonts.editor, '16px', 'the editor must be 16px on a coarse pointer (no iOS zoom)');
    assert.equal(fonts.gutter, fonts.editor, 'the gutter font must match the editor');
    assert.equal(fonts.highlight, fonts.editor, 'the syntax overlay font must match the editor');

    // Text-inflation guard: without text-size-adjust, iOS/Android enlarge the
    // editor + overlay text past their declared size ("font too big").
    assert.equal(
      await mpage.evaluate(() => getComputedStyle(document.documentElement).webkitTextSizeAdjust),
      '100%',
      'text-size-adjust must pin declared sizes against mobile text inflation'
    );

    // Scroll containment: the capped editor scrolls itself without chaining into
    // a page jump (the swipe trap), and stays scrollable.
    assert.equal(
      await mpage.evaluate(
        () => getComputedStyle(document.getElementById('editor')).overscrollBehaviorY
      ),
      'contain',
      'the editor must contain its overscroll so touch scrolling never chains a page jump'
    );

    // On a phone the editor SOFT-WRAPS long lines (overriding wrap=off) and
    // paints its own text, with the unalignable syntax overlay + the now-
    // meaningless line gutter hidden: readable + editable beats clipped.
    const wrap = await mpage.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('editor'));
      return {
        whiteSpace: cs.whiteSpace,
        fill: cs.webkitTextFillColor,
        overlay: getComputedStyle(document.getElementById('editor-highlight')).display,
        gutter: getComputedStyle(document.getElementById('gutter')).display,
      };
    });
    assert.equal(wrap.whiteSpace, 'pre-wrap', 'the phone editor soft-wraps long lines');
    assert.notEqual(
      wrap.fill,
      'rgba(0, 0, 0, 0)',
      'the phone editor paints its own (non-transparent) text'
    );
    assert.equal(wrap.overlay, 'none', 'the unalignable syntax overlay is hidden when wrapped');
    assert.equal(wrap.gutter, 'none', 'the line gutter is hidden when wrapped');

    // The example list is the phone's path to the scenes: an obvious 16px
    // trigger, and a popover whose list scrolls in place (overscroll contained)
    // and fits within the small viewport.
    assert.equal(
      await mpage.evaluate(
        () => getComputedStyle(document.getElementById('example-trigger')).fontSize
      ),
      '16px',
      'the example trigger must read as a 16px control on a phone'
    );
    await mpage.click('#example-trigger');
    await mpage.waitForFunction(
      () => document.getElementById('example-trigger').getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 5_000 }
    );
    const list = await mpage.evaluate(() => {
      const lb = document.getElementById('example-listbox');
      const b = document.getElementById('example-browser').getBoundingClientRect();
      return {
        overscroll: getComputedStyle(lb).overscrollBehaviorY,
        scrollable: lb.scrollHeight > lb.clientHeight,
        bottom: b.bottom,
        innerH: window.innerHeight,
      };
    });
    assert.equal(list.overscroll, 'contain', 'the example list must contain its overscroll');
    assert.ok(list.scrollable, 'the example list must scroll within the popover');
    assert.ok(
      list.bottom <= list.innerH,
      `the example popover must fit the viewport (bottom ${list.bottom} <= ${list.innerH})`
    );

    await mctx.close();
  }
} catch (err) {
  failure = err;
} finally {
  // Browser first (drops its keep-alive connections), then the server.
  if (page) await saveBrowserCoverage(page, 'ui');
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

if (failure) {
  console.error('ui test failed:', failure);
  if (consoleLines.length) {
    console.error('--- page console ---');
    console.error(consoleLines.join('\n'));
  }
  process.exit(1);
}

clearTimeout(watchdog);
console.log('ui test passed (160x120 render, download link, log summary, progress, cancel path)');
