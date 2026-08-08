import assert from 'node:assert/strict';

export async function runStartupRender(ctx) {
  const { page, selAdvanced } = ctx;

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

  // ---- first-run guidance ---------------------------------------------------
  // This page is the suite's only genuinely COLD load (no saved blob yet), so it
  // is the only place the first-run strip can be tested at all. It is the single
  // piece of instruction a newcomer gets: before it existed, the plate's
  // empty-state sentence was, and the on-load auto-draft hid the plate ~1.6s
  // after load, so the guidance was erased by the app working correctly. The
  // survives-the-first-draft half of that is asserted after the draft lands.
  const onboardState = () =>
    page.evaluate(() => ({
      hidden: document.getElementById('onboard').hidden,
      text: document.getElementById('onboard').querySelector('p')?.textContent?.trim() ?? '',
    }));
  const first = await onboardState();
  assert.equal(first.hidden, false, 'a cold load must show the first-run guidance strip');
  assert.match(
    first.text,
    /Ctrl\/Cmd.+Enter.+renders/s,
    `the strip must say how to render, got: ${first.text}`
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

  // The regression this strip exists for: the first draft has now landed, so the
  // plate's own hint IS hidden (showImage hides it and nothing brings it back),
  // and the guidance must still be on screen.
  assert.deepEqual(
    await page.evaluate(() => ({
      plateHint: document.querySelector('#output-plate .hint').hidden,
      strip: document.getElementById('onboard').hidden,
    })),
    { plateHint: true, strip: false },
    'the first draft hides the plate hint; the guidance strip must survive it'
  );

  // Dismissal is explicit and remembered: the strip goes away and the saved blob
  // records it (the reload half is asserted in the playback/drafts suite, which
  // owns the seeded-blob reloads).
  await page.click('#onboard-dismiss');
  await page.waitForFunction(
    () => {
      try {
        return JSON.parse(localStorage.getItem('povrayer.ui.v1') || '{}').onboarded === true;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 5_000 }
  );
  assert.equal(
    (await onboardState()).hidden,
    true,
    'dismissing the strip must hide it for the rest of the session'
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
}
