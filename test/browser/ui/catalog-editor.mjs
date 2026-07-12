import assert from 'node:assert/strict';

export async function runCatalogEditor(ctx) {
  const { page, selAdvanced, fillAdvanced, setSceneSource } = ctx;

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
  // Heavy stills auto-draft like every other still example now: the draft caps
  // (320px edge, q5, 4 threads) keep them cheap and the controller's slow-draft
  // pause backstops the truly pathological ones, so loading any still example
  // shows a preview instead of an empty plate.
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return (
        document.getElementById('status').dataset.state === 'draft' &&
        /^preview ready · /.test(document.getElementById('status').textContent) &&
        !d.pending &&
        !d.inFlight
      );
    },
    null,
    { timeout: 60_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('example-trigger').dataset.name),
    'julia-fractal',
    'a pristine heavy still example loads and auto-previews'
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
    'editing a heavy still example keeps live preview running'
  );
  // Restoring the pristine heavy text re-drafts it (the suppression that used
  // to kick in here is gone); wait for that draft to settle so the next
  // section starts from a quiet scheduler.
  await page.evaluate(async () => {
    const { getExample } = await import('/examples.js');
    const ed = document.getElementById('editor');
    ed.value = getExample('julia-fractal');
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => {
      const d = window.__liveDraftProbe();
      return (
        /^preview ready · /.test(document.getElementById('status').textContent) &&
        !d.pending &&
        !d.inFlight
      );
    },
    null,
    { timeout: 60_000 }
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
  // Every still example auto-drafts now (heavy included), so each of these
  // waits blocks on a real draft render completing: long render timeout.
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
    { timeout: 60_000 }
  );
  assert.equal(
    await page.evaluate(() => document.getElementById('quality').value),
    '8',
    'loading the cornell radiosity example from auto quality selects the heavy tier'
  );
  await selAdvanced('#quality', '');
  await switchExample('csg-die');
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
    const { GALLERY_BATCH_SIZE } = await import('/gallery.js');
    const first = document.querySelector('.gallery-card[data-name="csg-die"] img');
    return {
      count: [...document.querySelectorAll('.gallery-card')].length,
      loaded: document.querySelector('.gallery-card[data-loaded="true"]')?.dataset.name,
      focused: document.activeElement?.id,
      img: first.getAttribute('src'),
      imgW: first.getAttribute('width'),
      batch: GALLERY_BATCH_SIZE,
      expected: EXAMPLES.length,
    };
  });
  assert.equal(galleryOpen.count, galleryOpen.batch, 'gallery renders only its first batch');
  assert.deepEqual(
    galleryOpen,
    {
      count: galleryOpen.batch,
      loaded: 'csg-die',
      focused: 'gallery-search',
      img: 'example-thumbnails/csg-die.png',
      imgW: '160',
      batch: galleryOpen.batch,
      expected: galleryOpen.expected,
    },
    'gallery opens with bounded DOM, search focused, and the loaded example marked'
  );
  await page.evaluate(() => {
    const grid = document.getElementById('gallery-grid');
    Object.defineProperties(grid, {
      scrollHeight: { value: 2_000, configurable: true },
      clientHeight: { value: 500, configurable: true },
      scrollTop: { value: 0, configurable: true },
    });
    grid.dispatchEvent(new Event('scroll'));
    delete grid.scrollHeight;
    delete grid.clientHeight;
    delete grid.scrollTop;
  });
  assert.equal(
    await page.locator('.gallery-card').count(),
    galleryOpen.batch,
    'scrolling away from the end does not append a batch'
  );
  await page.locator('.gallery-more').evaluate((button) => button.click());
  assert.equal(
    await page.locator('.gallery-card').count(),
    Math.min(galleryOpen.batch * 2, galleryOpen.expected),
    'the accessible fallback appends the next gallery batch'
  );
  await page.evaluate(() => {
    const grid = document.getElementById('gallery-grid');
    grid.scrollTop = grid.scrollHeight;
    grid.dispatchEvent(new Event('scroll'));
  });
  assert.equal(
    await page.locator('.gallery-card').count(),
    Math.min(galleryOpen.batch * 3, galleryOpen.expected),
    'scrolling near the end appends another gallery batch'
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
  await page.click('#gallery-clear');
  assert.equal(
    await page.locator('.gallery-card').first().getAttribute('data-name'),
    'sourced-wineglass',
    'clearing filters keeps the loaded example at the front of a fresh batch'
  );
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

  Object.assign(ctx, {
    VALID_SCENE,
    BROKEN_SCENE,
    waitState,
    editorValue,
    browserExpanded,
    setEditor,
  });
}
