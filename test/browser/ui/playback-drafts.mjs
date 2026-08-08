import assert from 'node:assert/strict';

export async function runPlaybackDrafts(ctx) {
  const { page, server, selAdvanced, fillAdvanced, VALID_SCENE, BROKEN_SCENE, waitState } = ctx;

  // --- persistence: restore a full saved blob, then reload variants ----------
  // Seed via an init script (runs on the NEXT document, after the unloading
  // page's pagehide->saveState fires) so the app's own save can't clobber the
  // blob we're trying to restore. addInitScript stacks across loads; the most
  // recently added runs last and wins.
  let seedNav = 0;
  const nextSeedUrl = () => `${server.url}?seed=${seedNav++}`;
  const seedReload = async (blob) => {
    await page.addInitScript((b) => {
      localStorage.setItem('povrayer.ui.v1', b);
    }, blob);
    // Load a fresh, HASHLESS URL rather than page.reload(): the live permalink
    // sync may have left a #payload in the bar, and on reload that stale hash
    // would hydrate OVER the seeded localStorage we're restoring (hash > saved).
    // The unique ?seed forces a full document load with no fragment.
    await page.goto(nextSeedUrl(), { waitUntil: 'load' });
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
    { example: 'csg-die', width: '512', quality: '9', antialias: '0.1' },
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

  assert.match(
    await page.evaluate(async () => {
      const { renderAnimation } = await import('./render-client.js');
      try {
        await renderAnimation('', { frames: 100 }); // wrapper-default 800×600 exceeds the budget
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      return '';
    }),
    /safety limit 256 MiB/,
    'the animation budget should apply the wrapper defaults when dimensions are omitted'
  );

  // Reject an animation whose decoded playback assets would exceed the tab-safe
  // memory budget before wasm starts, then prove the render lock remains free.
  await page.fill('#width', '2048');
  await page.fill('#height', '2048');
  await page.fill('#frames', '9');
  await page.click('#render-btn');
  await page.waitForFunction(() => document.getElementById('status').dataset.state === 'error');
  assert.match(
    await page.evaluate(() => document.getElementById('error').textContent),
    /animation needs about \d+ MiB.*safety limit 256 MiB/,
    'oversized animations should fail with an actionable memory-budget message'
  );
  await page.fill('#width', '48');
  await page.fill('#height', '36');
  await page.fill('#frames', '30');

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

  const cachedPage = await page.evaluate(() => {
    const canvas = document.getElementById('player-canvas');
    const before = { width: canvas.width, height: canvas.height };
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    return {
      before,
      after: { width: canvas.width, height: canvas.height },
      controlsHidden: document.getElementById('player-controls').hidden,
      playLabel: document.getElementById('play-btn').textContent,
    };
  });
  assert.deepEqual(
    cachedPage,
    {
      before: { width: 48, height: 36 },
      after: { width: 48, height: 36 },
      controlsHidden: false,
      playLabel: 'Play',
    },
    'entering the back/forward cache pauses playback without releasing restorable frames'
  );

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

  // Mode toggle + plate routing: leaving animate releases its playback assets.
  // A subsequent still render remains available when bouncing through the now
  // empty animate plate.
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
  await page.click('#mode-animate'); // animation assets were released on the earlier mode switch
  assert.equal(
    await page.evaluate(() => document.getElementById('player-canvas').hidden),
    true,
    'switching back to animate should not resurrect released frames'
  );
  // syncStatusToPlate re-derives a neutral footer that agrees with the empty
  // animation plate, not the prior still 'done …' line.
  assert.deepEqual(
    await page.evaluate(() => {
      const s = document.getElementById('status');
      return { text: s.textContent, state: s.dataset.state };
    }),
    { text: 'no render yet', state: 'idle' },
    'switching into animate after cleanup must read "no render yet"'
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
    page.evaluate(async (v) => {
      const ed = document.getElementById('editor');
      ed.value = v;
      ed.dispatchEvent(new Event('input'));
      await new Promise(requestAnimationFrame);
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

  // --- the readout has to describe what is ON the plate ----------------------
  // The stat chips and the render log narrate the last EXPLICIT render. A draft
  // replaces the image under them, so they go .stale until a real render
  // repopulates them. Measured before this: a 512x384 glass render left
  // "pixels 196,608" at full opacity under a 320x240 sphere draft, indefinitely,
  // and it survived an example switch. `grep logDetails.classList` found nothing,
  // so the log was never dimmed at all.
  const narration = () =>
    page.evaluate(() => ({
      stats: document.getElementById('stats').classList.contains('stale'),
      log: document.getElementById('log-details').classList.contains('stale'),
    }));
  const waitDraftReady = (prevSrc) =>
    page.waitForFunction(
      (prev) => {
        const o = document.getElementById('output');
        const st = document.getElementById('status');
        return (
          st.dataset.state === 'draft' &&
          /^preview ready · /.test(st.textContent) &&
          o.src.startsWith('blob:') &&
          o.src !== prev &&
          !window.__liveDraftProbe().inFlight
        );
      },
      prevSrc,
      { timeout: 60_000 }
    );
  assert.deepEqual(
    await narration(),
    { stats: true, log: true },
    'a draft image must dim the chips + log it does not describe'
  );
  await page.click('#render-btn');
  await waitState('done');
  assert.deepEqual(
    await narration(),
    { stats: false, log: false },
    'an explicit render repopulates the chips + log, so both read live again'
  );
  const fullRenderSrc = await outSrc();
  await typeScene(LIVE_SCENE + '// nudge the draft\n');
  await waitDraftReady(fullRenderSrc);
  assert.deepEqual(
    await narration(),
    { stats: true, log: true },
    'the next draft dims them again (they still describe the full render)'
  );

  // An EMPTY buffer has no scene to describe, so the plate goes back to its
  // empty-state hint instead of holding a full-size image of a scene that no
  // longer exists, and the footer says why no preview is coming. Before this the
  // reason was computed and dropped: no preview, no error, no status change.
  await typeScene('');
  await page.waitForFunction(
    () => {
      const st = document.getElementById('status');
      return st.dataset.state === 'draft' && st.textContent === 'preview paused · empty scene';
    },
    null,
    { timeout: 10_000 }
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      output: document.getElementById('output').hidden,
      hint: document.querySelector('#output-plate .hint').hidden,
      // The link still works (that PNG is a render the user asked for) but reads
      // as outdated: it is the last trace of a scene the editor no longer holds.
      downloadStale: document.getElementById('download-btn').classList.contains('stale'),
    })),
    { output: true, hint: false, downloadStale: true },
    'emptying the buffer must hand the plate back to the empty-state hint'
  );

  // A scene with no #version previews like any other. POV-Ray only WARNS about a
  // missing #version (clicking Render on this exact text succeeds), so the
  // pre-check's no-version code must not park the preview: otherwise the preview
  // and the Render button disagree about what is renderable, which is what left
  // version-less scenes sitting in total silence.
  const NO_VERSION_SCENE = LIVE_SCENE.split('\n').slice(1).join('\n');
  const emptiedSrc = await outSrc();
  await typeScene(NO_VERSION_SCENE);
  await waitDraftReady(emptiedSrc);
  assert.equal(
    await page.evaluate(() => document.getElementById('output').naturalWidth),
    320,
    'a version-less scene must still auto-preview'
  );

  // Validity gate: an obviously mid-edit (unbalanced) scene must NOT auto-render,
  // but it must SAY so (the mid-edit reason, in the dim draft state).
  const noVersionSrc = await outSrc();
  await typeScene(LIVE_SCENE);
  await waitDraftReady(noVersionSrc);
  const goodDraftSrc = await outSrc();
  await typeScene(LIVE_SCENE + '\nsphere { 0, 1'); // dangling '{'
  await page.waitForFunction(
    () => {
      const st = document.getElementById('status');
      return (
        st.dataset.state === 'draft' && st.textContent === 'preview paused · unbalanced { } ( ) [ ]'
      );
    },
    null,
    { timeout: 10_000 }
  );
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

  // The radiosity cornell at the default quality (9) on one thread stays in
  // flight for seconds, so every fireDraft below (now firing at the floored
  // debounce) lands while it is still live. Quality 9 already computes radiosity
  // (the slow part); 10/11 only add antialiasing/jitter, which an AA-off draft
  // skips, so the default is as slow as +Q11.
  await selAdvanced('#quality', '9');
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
  // ...and the footer says PREVIEWING, not "preview ready". Both draft hooks used
  // to print previewReadyStatus, so the finished-preview line appeared the instant
  // a draft started (measured: 1,650ms of "preview ready" next to a live spinner,
  // with the previous scene still in the plate). This runs while the cornell draft
  // is provably in flight, so the two states can't be confused.
  assert.deepEqual(
    await page.evaluate(() => {
      const st = document.getElementById('status');
      return { text: st.textContent, state: st.dataset.state };
    }),
    { text: 'previewing… 320×240', state: 'draft' },
    'an in-flight draft must announce previewing, not preview ready'
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

  Object.assign(ctx, { seedReload, nextSeedUrl, LIVE_SCENE, typeScene });
}
