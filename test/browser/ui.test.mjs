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
  await page.selectOption('#antialias', 'off');
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
  assert.match(doneStatus, /^done in \d+\.\d\ds/, `unexpected status after render: ${doneStatus}`);
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
  // The raw log lives behind a disclosure whose summary carries the line count.
  const logSummary = await page.evaluate(() => document.getElementById('log-summary').textContent);
  assert.match(
    logSummary,
    /render log \(\d+ lines\)/,
    `unexpected log summary after a successful render: ${logSummary}`
  );

  // Cancel path: start a deliberately slow render (big frame, tight AA),
  // abort it, and require the 'cancelled' status. Only the AbortError branch
  // sets that text, so this proves cancellation actually rejects the render.
  await page.fill('#width', '1024');
  await page.fill('#height', '768');
  await page.selectOption('#antialias', '0.05');
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
    () => document.getElementById('status').textContent === 'cancelled',
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
  // flight, and activating it cancels exactly like the toolbar Cancel.
  await page.fill('#width', '1024');
  await page.fill('#height', '768');
  await page.selectOption('#antialias', '0.05');
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
    () => document.getElementById('status').textContent === 'cancelled',
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
    return {
      busyThrew,
      progress,
      busyAfter: mod.isBusy(),
      bytes: res.bytes.length,
      blob: res.blobUrl.startsWith('blob:'),
      logLen: res.log.length,
    };
  });
  assert.ok(direct.busyThrew, 'a second concurrent renderScene must throw the busy backstop');
  assert.ok(direct.progress > 0, 'onProgress must fire for a real render');
  assert.equal(direct.busyAfter, false, 'isBusy must clear after the render resolves');
  assert.ok(direct.bytes > 0 && direct.blob, 'direct render should resolve bytes + a blob url');
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
    const out = {
      count: res.frames.length,
      isPng: res.frames.every((b) => b[0] === 0x89 && b[1] === 0x50),
      blobUrls: res.blobUrls.every((u) => u.startsWith('blob:')),
      bitmapW: res.bitmaps[0].width,
      bitmapsAreImageBitmap: res.bitmaps.every((b) => b instanceof ImageBitmap),
      elapsed: typeof res.elapsedMs === 'number' && res.elapsedMs > 0,
      logLen: res.log.length,
      frameEvents: events.filter((k) => k === 'frame').length,
      frameCalls,
      progress,
      busyAfter: mod.isBusy(),
    };
    res.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    res.bitmaps.forEach((b) => b.close());
    return out;
  });
  assert.equal(anim.count, 3, 'renderAnimation should return one PNG per frame');
  assert.ok(anim.isPng, 'each animation frame should be a PNG');
  assert.ok(anim.blobUrls, 'renderAnimation should hand back blob: playback URLs');
  assert.equal(anim.bitmapW, 32, 'bitmaps should match the render width');
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
  await page.waitForFunction(
    () => !document.querySelector('#output-pane .zoom-toggle').hidden,
    null,
    {
      timeout: 5_000,
    }
  );
  assert.match(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').textContent),
    /^fit/,
    'zoom toggle should read fit before engaging 1:1'
  );
  await page.click('#output-pane .zoom-toggle'); // toggleZoom -> 1:1
  assert.equal(
    await page.evaluate(() => document.getElementById('output').classList.contains('zoom-1x')),
    true,
    'zoom toggle should engage 1:1'
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').textContent),
    '1:1',
    'zoom label should read 1:1 when engaged'
  );
  await page.click('#output'); // clicking the visible image toggles back to fit
  assert.equal(
    await page.evaluate(() => document.getElementById('output').classList.contains('zoom-1x')),
    false,
    'clicking the image should toggle back to fit'
  );
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // updateZoomLabel fit path

  // --- example browser: open / filter / navigate / select + dirty guard ------
  // The flat <select> is gone; the example picker is now an editable-combobox
  // popover (trigger + filter + grouped listbox + attribution footer). These
  // drive every controller branch the popover added.
  const browserExpanded = () =>
    page.evaluate(() => document.getElementById('example-trigger').getAttribute('aria-expanded'));
  const triggerName = () =>
    page.evaluate(() => document.getElementById('example-trigger').dataset.name);
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
        .filter((o) => !o.hidden)
        .map((o) => o.dataset.name)
    );
  const visibleCount = () =>
    page.evaluate(
      () => [...document.querySelectorAll('.ex-option')].filter((o) => !o.hidden).length
    );
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
      attr: document.querySelector('#example-attribution .ex-attr-text').textContent,
      srcHidden: document.querySelector('#example-attribution .ex-attr-src').hidden,
    })),
    {
      focused: 'example-search',
      aria: 'true',
      loaded: 'csg-die',
      attr: 'by povrayer · CC0-1.0',
      srcHidden: true,
    },
    'open focuses search, marks the loaded option active, shows the CC0 attribution with hidden link'
  );

  // open-collapses-others: the accordion opens COMPACT. Only the loaded scene's
  // category (Solid Modeling) is expanded; every other category is collapsed, so
  // the panel shows five rows, not a 29-row wall. Each head carries a scene-count
  // chip matching its category size.
  assert.deepEqual(
    await page.evaluate(() => ({
      expanded: [...document.querySelectorAll('.ex-group-head')]
        .filter((h) => h.getAttribute('aria-expanded') === 'true')
        .map((h) => h.id),
      visible: [...document.querySelectorAll('.ex-option')]
        .filter((o) => !o.hidden)
        .map((o) => o.dataset.name),
    })),
    {
      expanded: ['exgrp-modeling'],
      visible: ['csg-die', 'steinmetz', 'lathe-vase', 'prism-lantern', 'sweep-knot'],
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
  assert.ok((await visibleNames()).includes('isosurface'), 'expanding a head reveals its rows');
  assert.equal(await activeDesc(), 'exgrp-implicit', 'a head click ropes the roving onto the head');
  assert.equal(await headExpanded('modeling'), 'true', 'toggling one head leaves the others alone');
  await page.click('#exgrp-implicit');
  await page.waitForFunction(
    () => document.getElementById('exgrp-implicit').getAttribute('aria-expanded') === 'false',
    null,
    { timeout: 5_000 }
  );
  assert.ok(!(await visibleNames()).includes('isosurface'), 'a second click collapses the head');

  // search auto-expand: while the filter is non-empty, collapse state is ignored.
  // Typing "modeling" surfaces the whole Solid Modeling group (every row matches
  // the category label) and hides every non-matching head; #example-empty stays
  // hidden while anything matches. Real typing also runs the search keydown
  // handler's non-navigation default arms.
  await page.type('#example-search', 'modeling');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.ex-option')].filter((o) => !o.hidden).length === 5 &&
      document.getElementById('exgrp-implicit').parentElement.hidden,
    null,
    { timeout: 5_000 }
  );
  assert.deepEqual(
    await visibleNames(),
    ['csg-die', 'steinmetz', 'lathe-vase', 'prism-lantern', 'sweep-knot'],
    'filtering "modeling" shows exactly the Solid Modeling group'
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
      [...document.querySelectorAll('.ex-option')].filter((o) => !o.hidden).length === 0 &&
      !document.getElementById('example-empty').hidden,
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
    () =>
      [...document.querySelectorAll('.ex-option')].filter((o) => !o.hidden).length === 5 &&
      document.getElementById('exgrp-modeling').getAttribute('aria-expanded') === 'true' &&
      document.getElementById('exgrp-implicit').getAttribute('aria-expanded') === 'false' &&
      document.querySelector('.ex-option.is-active')?.dataset.name === 'csg-die',
    null,
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
  assert.equal(await visibleCount(), 5, 'expanding restores the category rows');
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
  // (commitOption, selectExample pristine path, applyExampleClock animated arm,
  // closeBrowser(returnFocus=true), setTriggerLabel re-mark.)
  await page.fill('#example-search', 'orbit');
  await page.waitForFunction(
    () => {
      const v = [...document.querySelectorAll('.ex-option')].filter((o) => !o.hidden);
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
  assert.equal(await browserExpanded(), 'false', 'selecting an option closes the panel');
  assert.deepEqual(
    await page.evaluate(() => ({
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
      focused: document.activeElement?.id,
      label: document.getElementById('example-trigger-text').textContent,
    })),
    {
      frames: '24',
      fps: '24',
      focused: 'example-trigger',
      label: 'Orbit (two moons, clock-driven)',
    },
    'an animated example autofills frames/fps, returns focus, and relabels the trigger'
  );

  // Loading a STILL example must leave dialed-in frames/fps untouched (the
  // applyExampleClock early-return), and this exercises the click-select path.
  // The animate-only inputs are hidden in still mode, so seed them directly.
  await page.evaluate(() => {
    document.getElementById('frames').value = '7';
    document.getElementById('fps').value = '9';
  });
  await switchExample('csg-die');
  assert.deepEqual(
    await page.evaluate(() => ({
      frames: document.getElementById('frames').value,
      fps: document.getElementById('fps').value,
    })),
    { frames: '7', fps: '9' },
    'loading a still example must not touch frames/fps'
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

  // Pristine editor (=== the loaded scene) switches with no confirm.
  await switchExample('blobs');
  assert.ok((await editorValue()).length > 0, 'switching example should load its source');

  // Edited editor + confirm() rejected -> keep the edit, the panel still closes,
  // and the loaded scene is unchanged. (selectExample dirty-guard reject arm.)
  await page.fill('#editor', 'EDITED scene one');
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

  // Edited editor + confirm() accepted -> stash the edit, load the new example.
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await switchExample('glass');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('povrayer.ui.stash')),
    'EDITED scene one',
    'an accepted example switch must stash the replaced edit'
  );
  assert.notEqual(
    await editorValue(),
    'EDITED scene one',
    'an accepted example switch must replace the editor with the new example'
  );

  // Accepted switch while localStorage.setItem throws: the stash write is
  // best-effort, so the catch swallows it and the example still loads.
  await page.fill('#editor', 'EDITED scene two');
  await page.evaluate(() => {
    window.__origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
  });
  await switchExample('blobs');
  assert.notEqual(
    await editorValue(),
    'EDITED scene two',
    'a stash-write failure must not block the example switch'
  );
  await page.evaluate(() => {
    localStorage.setItem = window.__origSetItem;
  });

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
        'Tab indents the line. Press Escape, then Tab (or Shift+Tab) to move focus out of the editor.',
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
  await page.selectOption('#quality', '8'); // 8 is the highest explicit quality option
  await page.selectOption('#antialias', '0.3');
  await page.fill('#threads', '4');
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
  await page.selectOption('#antialias', 'off');
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

  // --- status throttle: immediate path (stepped clock forces now - last >= 1s)
  await page.fill('#editor', VALID_SCENE);
  await page.fill('#width', '64');
  await page.fill('#height', '48');
  await page.selectOption('#antialias', 'off');
  await page.selectOption('#quality', '');
  await page.fill('#threads', '');
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
  await page.selectOption('#antialias', '0.1');
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
  await page.selectOption('#antialias', '0.05');
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
  // blob we're trying to restore. addInitScript stacks across reloads; the most
  // recently added runs last and wins.
  const seedReload = async (blob) => {
    await page.addInitScript((b) => {
      localStorage.setItem('povrayer.ui.v1', b);
    }, blob);
    await page.reload({ waitUntil: 'load' });
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
      example: 'glass',
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
      example: document.getElementById('example-trigger').dataset.name,
    })),
    {
      source: 'SAVED restore source',
      width: '200',
      height: '150',
      quality: '5',
      antialias: '0.1',
      threads: '6',
      example: 'glass',
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
    document.getElementById('export-btn').click(); // exportVideo -> !bitmaps.length
  });

  // First animate render (3 frames, fresh page so engineSeen is false).
  await page.fill('#frames', '3');
  await page.fill('#fps', '12');
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await page.selectOption('#antialias', 'off');
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
    { aria: 'frame 2 of 3', readout: '2 / 3' },
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
  assert.equal(resync.before, '1 / 3', 'the player must start parked on frame 0 (reads "1 / 3")');
  assert.equal(
    resync.after,
    '2 / 3',
    'a stalled tick must resync and advance exactly one frame (not burst the backlog)'
  );
  assert.equal(resync.aria, 'frame 2 of 3', 'the resync-advanced frame announces "frame 2 of 3"');

  // Export WebM via a stubbed MediaRecorder -> 'animation.webm' download.
  await page.evaluate(() => {
    window.__dl = [];
    window.__origAClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__dl.push(this.download);
    };
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
  });
  // Re-entrancy + feedback: the first click disables the button and relabels it
  // 'exporting…' (synchronously, before the playOnce await); a SECOND click
  // while that export is still running hits the `exporting` guard and no-ops, so
  // only one file is produced (no second MediaRecorder on the same stream).
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
  await page.waitForFunction(() => (window.__dl ?? []).some((n) => /\.webm$/.test(n)), null, {
    timeout: 15_000,
  });
  // The export finished: button re-enabled + relabel restored, and exactly one
  // webm came out despite the re-entrant second click.
  await page.waitForFunction(
    (label) => {
      const btn = document.getElementById('export-btn');
      return !btn.disabled && btn.textContent === label;
    },
    exportFeedback.prevLabel,
    { timeout: 15_000 }
  );
  assert.equal(
    await page.evaluate(() => (window.__dl ?? []).filter((n) => /\.webm$/.test(n)).length),
    1,
    'a re-entrant export click must not produce a second file'
  );

  // Export fallback (MediaRecorder gone) -> sequential frameNNN.png downloads.
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__origAClick;
    delete window.MediaRecorder;
    window.__dl2 = [];
    HTMLAnchorElement.prototype.click = function () {
      window.__dl2.push(this.download);
    };
  });
  await page.click('#export-btn');
  await page.waitForFunction(
    () => (window.__dl2 ?? []).filter((n) => /frame\d+\.png/.test(n)).length >= 3,
    null,
    { timeout: 5_000 }
  );
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__origAClick;
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
  await page.selectOption('#antialias', '0.1');
  await page.click('#render-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent.startsWith('rendering'),
    null,
    { timeout: 15_000 }
  );
  await page.click('#mode-still'); // busy -> setMode returns, mode stays animate
  await page.click('#cancel-btn');
  await page.waitForFunction(
    () => document.getElementById('status').textContent === 'cancelled',
    null,
    { timeout: 60_000 }
  );

  // A broken scene in animate mode -> PovrayError error path (line jump + exit).
  await page.fill('#editor', BROKEN_SCENE);
  await page.fill('#frames', '2');
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await page.selectOption('#antialias', 'off');
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
    window.createImageBitmap = () => Promise.reject(new Error('bitmap boom'));
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
  await page.evaluate(() => {
    window.createImageBitmap = window.__origCIB;
  });

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
  await page.selectOption('#antialias', 'off');
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
  // ...and switching back to still (image present) reads 'render ready', never a
  // lingering 'animation ready' / 'live draft' line.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'render ready', state: 'idle' },
    'switching back into still with a kept image must read "render ready"'
  );

  // updateZoomLabel with a zero-width (but shown) image: clientWidth/naturalWidth
  // rounds to 0, so the label falls back to '|| 100'.
  await page.evaluate(() => {
    const o = document.getElementById('output');
    o.style.width = '0px';
    window.dispatchEvent(new Event('resize'));
    o.style.width = '';
  });
  assert.match(
    await page.evaluate(() => document.querySelector('#output-pane .zoom-toggle').textContent),
    /fit \(100%\)/,
    'a zero-width image should fall back to a 100% fit label'
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
  const floorDebounce = async () => {
    // Wait for a genuinely NEW draft image (the blob src changes), not just any
    // 320×240 'draft' state: a prior cornell draft already leaves status='draft'
    // at 320×240, so matching on those alone resolves instantly on the stale
    // frame and never actually re-floors lastDraftMs (which left the debounce
    // inflated, so a later busy-guard draft fired late and lingered in flight
    // under the isolation guard's idle assertion).
    const before = await page.evaluate(() => document.getElementById('output').src);
    await typeScene(LIVE_SCENE);
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
    /live draft · 320×240/,
    'the draft status reads the downscaled dims in a muted state'
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
    /live draft · error/,
    'a draft error sets a muted draft-error status'
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
  await page.fill('#threads', '1');

  // Explicit-render priority: a draft in flight is aborted by clicking Render
  // (the pendingFull hand-off), and the result is a FULL-dimension image, not
  // the 320 draft cap.
  await page.fill('#width', '400');
  await page.fill('#height', '300');
  await page.selectOption('#antialias', 'off');
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
  await page.selectOption('#quality', '');
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
  // The footer was sitting in the 'draft' state ('live draft · …'), so toggling
  // off neutralizes it to 'live off' (idle) rather than leaving the now-frozen
  // preview announced as live.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'live off', state: 'idle' },
    'toggling live off from a draft footer must read "live off"'
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
  await page.click('#stop-btn'); // aborts the draft AND turns live-draft off
  assert.equal(
    await ariaPressed('live-toggle'),
    'false',
    'stopping a live draft flips the live-draft toggle off (aria-pressed false)'
  );
  // The footer neutralizes from the 'live draft · …' line to 'live off' (idle).
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'live off', state: 'idle' },
    'stopping a live draft reads "live off"'
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

  await page.fill('#threads', '');

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

  // Success (bare id): the gist .pov overrides the restored scene, the param is
  // stripped from the URL, no error shows, and a live-draft preview renders it.
  await gistGoto('?gist=abc1');
  await editorIs(GIST_POV);
  await page.waitForFunction(
    () => {
      const o = document.getElementById('output');
      return o.src.startsWith('blob:') && o.naturalWidth > 0;
    },
    null,
    { timeout: 120_000 }
  );
  assert.equal(await searchHasGist(), false, 'a successful gist load strips ?gist from the URL');
  assert.equal(
    await page.evaluate(() => document.getElementById('error').hidden),
    true,
    'a successful gist load surfaces no error'
  );

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
  await page.selectOption('#quality', '4');
  await page.selectOption('#antialias', '0.3');
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
  assert.equal(await ctlValue('frames'), '10', 'permalink hydrates frames');
  assert.equal(await ctlValue('fps'), '8', 'permalink hydrates fps');
  assert.equal(await bodyMode(), 'still', 'permalink hydrates still mode');
  assert.equal(await aria('mode-still'), 'true', 'still toggle reflects pressed');

  // --- Case 3: an animate-mode permalink hydrates mode + player fps. ----------
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
    await page.evaluate(() => document.getElementById('fps-readout').textContent),
    /30/,
    'player.setFps reflects the hydrated fps in the readout'
  );
  // A live draft never fires in animate (scheduleDraft self-guards to still).
  assert.equal(
    await page.evaluate(() => window.__liveDraftProbe().pending),
    false,
    'no live draft schedules in an animate permalink'
  );

  // --- Case 4: a garbage hash WITH ?gist falls through to the gist load. ------
  await plBootGoto('?gist=abc123', '#%%%not-base64%%%');
  await page.waitForFunction((v) => document.getElementById('editor').value === v, PL_GIST, {
    timeout: 10_000,
  });
  assert.match(await editorValue(), /FROM GIST/, 'a junk hash falls through to the gist load');

  // --- Case 5: out-of-range select values in the payload are ignored. ---------
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

  // --- Case 6: a garbage hash with NO gist cold-loads the restored scene. -----
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

  await page.unroute('https://api.github.com/gists/*');

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

    // Scroll containment: the capped wrap=off editor scrolls itself without
    // chaining into a page jump (the swipe trap), and stays scrollable.
    assert.equal(
      await mpage.evaluate(
        () => getComputedStyle(document.getElementById('editor')).overscrollBehaviorY
      ),
      'contain',
      'the editor must contain its overscroll so touch scrolling never chains a page jump'
    );

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
