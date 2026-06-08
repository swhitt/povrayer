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

  // Bounded wait for ui.js: the module populates #examples on load, so if the
  // import chain fails we die here in 30s with the page console attached
  // instead of riding out the watchdog.
  await page.waitForFunction(() => document.getElementById('examples')?.options.length >= 4, null, {
    timeout: 30_000,
  });

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

  // --- example switch + dirty guard ------------------------------------------
  const switchExample = (name) =>
    page.evaluate((n) => {
      const sel = document.getElementById('examples');
      sel.value = n;
      sel.dispatchEvent(new Event('change'));
    }, name);

  // Pristine editor (=== the loaded example) switches with no confirm.
  await switchExample('blobs');
  await page.waitForFunction(() => document.getElementById('examples').value === 'blobs', null, {
    timeout: 5_000,
  });
  assert.ok((await editorValue()).length > 0, 'switching example should load its source');

  // A change event whose value resolves to no example (getExample undefined)
  // hits the defensive guard that restores the previous selection.
  await page.evaluate(() => {
    const sel = document.getElementById('examples');
    sel.value = '__no-such-option__'; // no matching <option> -> value becomes ''
    sel.dispatchEvent(new Event('change'));
  });
  assert.equal(
    await page.evaluate(() => document.getElementById('examples').value),
    'blobs',
    'an unresolvable example change must restore the previous selection'
  );

  // Edited editor + confirm() rejected -> revert the select, keep the edit.
  await page.fill('#editor', 'EDITED scene one');
  await page.evaluate(() => {
    window.confirm = () => false;
  });
  await switchExample('glass');
  await page.waitForFunction(() => document.getElementById('examples').value === 'blobs', null, {
    timeout: 5_000,
  });
  assert.equal(
    await editorValue(),
    'EDITED scene one',
    'a rejected example switch must keep the edited editor'
  );

  // Edited editor + confirm() accepted -> stash the edit, load the new example.
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await switchExample('glass');
  await page.waitForFunction(() => document.getElementById('examples').value === 'glass', null, {
    timeout: 5_000,
  });
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
  await page.waitForFunction(() => document.getElementById('examples').value === 'blobs', null, {
    timeout: 5_000,
  });
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
        helpText: help.textContent.trim(),
        // sr-only: off-screen but NOT display:none (still in the a11y tree).
        clipped: cs.position === 'absolute' && cs.width === '1px',
        visible: cs.display !== 'none',
      };
    }),
    {
      describedBy: 'editor-tabhelp status',
      helpText: 'Tab indents the line. Press Escape then Tab to move focus out of the editor.',
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
  await page.selectOption('#quality', '9');
  await page.selectOption('#antialias', '0.3');
  await page.fill('#threads', '4');
  await page.evaluate(() => document.getElementById('threads').focus());
  await page.keyboard.press('Control+Enter'); // startRender via the document shortcut
  await page.keyboard.press('Meta+Enter'); // busy re-entry guard returns immediately
  await waitState('done');
  await page.waitForTimeout(300); // let the decode().then(scrollIntoView) chain settle
  assert.match(
    await page.evaluate(() => document.getElementById('download-btn').getAttribute('download')),
    /^render-64x48-q9-a03\.png$/,
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
      () => document.getElementById('examples')?.options.length >= 4,
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
      example: document.getElementById('examples').value,
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
      example: document.getElementById('examples').value,
      width: document.getElementById('width').value,
      quality: document.getElementById('quality').value,
      antialias: document.getElementById('antialias').value,
    })),
    { example: 'csg-die', width: '512', quality: '', antialias: '0.3' },
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
  // prior draft (e.g. the q11 cornell below) otherwise inflates the debounce
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

  // Scroll sync: the overlay mirrors BOTH axes (the gutter mirrors only the top).
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
    const hl = document.getElementById('editor-highlight');
    const g = document.getElementById('gutter');
    return {
      hlTop: hl.scrollTop,
      hlLeft: hl.scrollLeft,
      edTop: ed.scrollTop,
      edLeft: ed.scrollLeft,
      gTop: g.scrollTop,
    };
  });
  assert.equal(sync.hlTop, sync.edTop, 'overlay scrollTop must mirror the editor');
  assert.equal(sync.hlLeft, sync.edLeft, 'overlay scrollLeft must mirror the editor');
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

  // q11 cornell on one thread stays in flight for seconds, so every fireDraft
  // below (now firing at the floored debounce) lands while it is still live.
  await page.selectOption('#quality', '11');
  await typeScene(cornellA);
  await page.waitForFunction(
    (s) => {
      const d = window.__liveDraftProbe();
      return d.inFlight && d.source === s;
    },
    cornellA,
    { timeout: 60_000 }
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
  await page.selectOption('#quality', '');

  // The q11 cornell draft just inflated the debounce back toward its cap; floor
  // it again so the busy-guard / isolation drafts below fire promptly and never
  // linger into a later section's idle assertion.
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
  await page.fill('#threads', '');
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
