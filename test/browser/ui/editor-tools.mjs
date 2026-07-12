import assert from 'node:assert/strict';

export async function runEditorTools(ctx) {
  const {
    page,
    openAdvanced,
    selAdvanced,
    setSceneSource,
    VALID_SCENE,
    waitState,
    editorValue,
    browserExpanded,
    seedReload,
    nextSeedUrl,
    setEditor,
    typeScene,
  } = ctx;

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
  const deferredEditorWork = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const editor = document.getElementById('editor');
    const code = document.getElementById('editor-code');
    const sliders = document.getElementById('sliders');
    const before = code.textContent;
    let rebuilds = 0;
    sliders.replaceChildren = (...nodes) => {
      rebuilds++;
      Element.prototype.replaceChildren.call(sliders, ...nodes);
    };
    try {
      editor.value = '#declare RAF_A = 1;';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.value = '#declare RAF_B = 2;';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      const immediate = code.textContent;
      await new Promise(requestAnimationFrame);
      return { before, immediate, final: code.textContent, rebuilds };
    } finally {
      delete sliders.replaceChildren;
    }
  });
  assert.equal(
    deferredEditorWork.immediate,
    deferredEditorWork.before,
    'editor input defers the full-source overlay scan until the next frame'
  );
  assert.equal(
    deferredEditorWork.final,
    '#declare RAF_B = 2;',
    'the deferred overlay reflects the newest source in the burst'
  );
  assert.equal(
    deferredEditorWork.rebuilds,
    1,
    'two inputs in one frame rebuild generated sliders once'
  );

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
  await page.evaluate(async () => {
    const e = document.getElementById('editor');
    e.value = '#declare A = 20;';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
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
  await page.evaluate(async () => {
    const e = document.getElementById('editor');
    e.value = 'sphere { 0, 1 }';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
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
    await page.goto(nextSeedUrl(), { waitUntil: 'load' });
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
  await page.goto(nextSeedUrl(), { waitUntil: 'load' });
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
}
