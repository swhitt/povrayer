import assert from 'node:assert/strict';

export async function runOutputMobile(ctx) {
  const {
    page,
    server,
    browser,
    fillAdvanced,
    VALID_SCENE,
    BROKEN_SCENE,
    waitState,
    LIVE_SCENE,
    typeScene,
  } = ctx;

  // ===========================================================================
  // Output-pane interaction batch: render-state tab chrome (favicon + title),
  // hold-to-peek A/B compare (Alt+B + press-and-hold), the zoom cycle's
  // click-anchored 1:1/4x + drag-to-pan, the full-height hero stage, and
  // Enter-to-render in the raw-flags field. Continues on the keyboard-batch
  // page: live draft is off, and the page's ONE render so far (the 64x48
  // final-quality chord) means prevUrl is still empty.
  // ===========================================================================
  const BASE_TITLE = 'povrayer · POV-Ray in the browser';
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
}
