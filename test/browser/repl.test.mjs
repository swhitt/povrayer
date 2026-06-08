// REPL page test: drives web/repl.html through the COOP/COEP server.
// This script owns the server lifecycle; nothing else starts it.
//
// Mirrors browser.test.mjs's timeout discipline: page.evaluate has NO timeout
// option, so every long wait here is a waitForFunction with an explicit
// timeout, and a hard 300s process watchdog force-exits if anything (including
// a hung browser.close()) wedges.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { EXAMPLES } from '../../web/examples.js';
import {
  startBrowserCoverage,
  saveBrowserCoverage,
} from '../../tools/coverage/browser-collect.mjs';

// Hard watchdog: only cleared on success, after browser and server have shut
// down cleanly.
const watchdog = setTimeout(() => {
  console.error('watchdog: repl test still running after 300s, force-exiting');
  process.exit(1);
}, 300_000);

// fill() focuses #input (and auto-waits while the REPL holds it readOnly
// mid-render: Playwright's editable check covers readOnly exactly like it did
// disabled), so the plain Enter press lands on the textarea and submits.
async function submit(page, text) {
  await page.fill('#input', text);
  await page.keyboard.press('Enter');
}

const imgCount = (page) =>
  page.evaluate(() => document.querySelectorAll('#scrollback img.preview').length);
const infoCount = (page) =>
  page.evaluate(() => document.querySelectorAll('#scrollback .info').length);
const lastInfoText = (page) =>
  page.evaluate(() => {
    const infos = document.querySelectorAll('#scrollback .info');
    return infos[infos.length - 1]?.textContent ?? '';
  });

const consoleLines = [];
let server;
let browser;
let page;
let failure;

try {
  server = await startServer();
  browser = await chromium.launch();
  page = await browser.newPage();
  // Start V8 coverage before navigation so repl.js/render-client.js/examples.js
  // are captured (no-op unless POVRAYER_COVERAGE is set).
  await startBrowserCoverage(page);
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto(new URL('repl.html', server.url).href, { waitUntil: 'load' });

  // FIRST: cross-origin isolation, so a header regression fails distinctly
  // from a REPL regression.
  const iso = await page.evaluate(() => globalThis.crossOriginIsolated);
  assert.equal(iso, true, 'page is not crossOriginIsolated (COOP/COEP header regression)');
  assert.equal(
    await page.evaluate(() => document.getElementById('iso-warning').hidden),
    true,
    'iso warning banner should stay hidden on an isolated page'
  );

  // Bounded wait for repl.js: it appends a greeting .info on load, so if the
  // import chain fails we die here in 30s with the page console attached
  // instead of riding out the watchdog.
  await page.waitForFunction(
    () => document.querySelectorAll('#scrollback .info').length >= 1,
    null,
    {
      timeout: 30_000,
    }
  );

  // 1. An SDL entry auto-renders at the 320x240 default. The bare sphere also
  // proves scaffold injection: camera/light/background are all implicit.
  await submit(page, 'sphere { 0, 1 pigment { color rgb <1,0,0> } }');
  // Mid-render the input swaps to readOnly (never disabled), so focus and the
  // caret survive the render. The first render includes the wasm cold start,
  // leaving a multi-second window for this poll to observe the busy state.
  await page.waitForFunction(
    () => {
      const input = document.getElementById('input');
      return input.readOnly === true && document.activeElement === input;
    },
    null,
    { timeout: 60_000 }
  );
  await page.waitForFunction(
    () => {
      const imgs = document.querySelectorAll('#scrollback img.preview');
      const img = imgs[imgs.length - 1];
      return (
        !!img &&
        img.src.startsWith('blob:') &&
        img.naturalWidth === 320 &&
        img.naturalHeight === 240
      );
    },
    null,
    { timeout: 120_000 }
  );
  // Result figures carry a provenance caption: render number, dimensions
  // (U+00D7), elapsed seconds.
  const figcaption = await page.evaluate(() => {
    const caps = document.querySelectorAll('#scrollback figure.result figcaption');
    return caps[caps.length - 1]?.textContent ?? '';
  });
  assert.match(
    figcaption,
    /render #\d+ · 320×240 · \d+\.\ds/,
    `unexpected result figcaption: ${figcaption}`
  );

  // 2. A bad entry rolls back: an error block appears, no image is added, and
  // :list still shows only the sphere.
  const imagesBeforeBad = await imgCount(page);
  await submit(page, 'bogus { nonsense }');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('#scrollback .error')].some((el) =>
        el.textContent.includes('rolled back')
      ),
    null,
    { timeout: 60_000 }
  );

  const infosBeforeList = await infoCount(page);
  await submit(page, ':list');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#scrollback .info').length > n,
    infosBeforeList,
    { timeout: 30_000 }
  );
  const listing = await lastInfoText(page);
  assert.ok(listing.includes('1: sphere'), `:list should show the sphere entry, got: ${listing}`);
  assert.ok(!listing.includes('bogus'), `rolled-back entry leaked into :list: ${listing}`);
  assert.equal(await imgCount(page), imagesBeforeBad, 'failed entry must not add an image');

  // 3. :size changes the next render's dimensions; :render forces one.
  const infosBeforeSize = await infoCount(page);
  await submit(page, ':size 64x48');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#scrollback .info').length > n,
    infosBeforeSize,
    { timeout: 30_000 }
  );
  await submit(page, ':render');
  await page.waitForFunction(
    () => {
      const imgs = document.querySelectorAll('#scrollback img.preview');
      const img = imgs[imgs.length - 1];
      return !!img && img.naturalWidth === 64 && img.naturalHeight === 48;
    },
    null,
    { timeout: 120_000 }
  );

  // 4. Command ergonomics: dispatch lowercases the name, so :EXAMPLE resolves
  // to :example (which, with no argument, lists the example scenes)...
  const infosBeforeExample = await infoCount(page);
  await submit(page, ':EXAMPLE');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#scrollback .info').length > n,
    infosBeforeExample,
    { timeout: 30_000 }
  );
  const exampleListing = await lastInfoText(page);
  // Assert against whatever examples.js actually ships rather than a
  // hardcoded id; the listing must mention every example by name.
  assert.ok(
    EXAMPLES.every((ex) => exampleListing.includes(ex.name)),
    `:EXAMPLE should lowercase-dispatch to the example listing, got: ${exampleListing}`
  );

  // 4b. Loading a standalone example must render through the assembly path.
  // Regression: examples declare their own `#version`, which POV-Ray fatals
  // on when any injected scaffold line precedes it; the assembled scene now
  // always leads with #version so in-entry directives are legal mid-scene
  // changes. csg-die is the canonical repro (it lacks `background`, so one
  // scaffold line is always injected above it).
  const imgsBeforeLoad = await page.evaluate(
    () => document.querySelectorAll('#scrollback img.preview').length
  );
  await submit(page, ':example csg-die');
  await page.waitForFunction(
    (n) => {
      const imgs = document.querySelectorAll('#scrollback img.preview');
      return imgs.length > n && imgs[imgs.length - 1].naturalWidth === 64;
    },
    imgsBeforeLoad,
    { timeout: 120_000 }
  );

  // ...and an unknown command suggests the nearest real one (:sz is not a
  // prefix of :size, so this exercises the edit-distance pass).
  const childrenBeforeSz = await page.evaluate(
    () => document.getElementById('scrollback').children.length
  );
  await submit(page, ':sz 64x48');
  await page.waitForFunction(
    (n) =>
      [...document.getElementById('scrollback').children]
        .slice(n)
        .some((el) => !el.classList.contains('entry') && el.textContent.includes(':size')),
    childrenBeforeSz,
    { timeout: 30_000 }
  );

  // ===========================================================================
  // repl.js DOM-controller coverage: every : command (incl. error/edge cases),
  // input mechanics (Tab completion, history, click-to-copy), rollback/cancel,
  // warnings, persistence restore. Everything below drives controller branches
  // the entry-render/rollback/:size/:example paths above never reach.
  // ===========================================================================

  const sbCount = () => page.evaluate(() => document.getElementById('scrollback').children.length);
  const inputVal = () => page.evaluate(() => document.getElementById('input').value);
  // Submit a non-render command and wait for its echo + block to land.
  const runCmd = async (text) => {
    const before = await sbCount();
    await submit(page, text);
    await page.waitForFunction(
      (n) => document.getElementById('scrollback').children.length > n + 1,
      before,
      {
        timeout: 30_000,
      }
    );
  };
  // Submit something that renders and wait for the new image.
  const submitRender = async (text) => {
    const before = await imgCount(page);
    await submit(page, text);
    await page.waitForFunction(
      (n) => document.querySelectorAll('#scrollback img.preview').length > n,
      before,
      {
        timeout: 120_000,
      }
    );
  };

  // --- PART 1: fast commands (no render), entries = [csg-die] -----------------
  await runCmd(':help'); // buildHelpBlock
  assert.ok(
    await page.evaluate(() => !!document.querySelector('#scrollback .help .help-grid')),
    ':help should render the structured help grid'
  );
  await runCmd(':source'); // numbered assembled scene
  await runCmd(':q 9'); // quality set
  await runCmd(':q abc'); // usage (non-numeric)
  await runCmd(':q 99'); // usage (out of range)
  await runCmd(':aa'); // antialias -> 0.3 (true); updateStatus -> aaLabel '0.3'
  await runCmd(':aa 0.5'); // antialias -> 0.5; updateStatus -> aaLabel '0.5'
  await runCmd(':aa off'); // antialias off
  await runCmd(':aa 9'); // usage (out of range)
  await runCmd(':threads 4'); // threads set
  await runCmd(':threads abc'); // usage
  await runCmd(':threads 99'); // usage (out of range)
  await runCmd(':args +UA +AM2'); // args set
  await runCmd(':args'); // args cleared
  await runCmd(':size 4x4'); // usage (too small)
  await runCmd(':size 9000x9000'); // usage (too big)
  await runCmd(':size nonsense'); // usage (no WxH match)
  await runCmd(':log full'); // raw log (a render already happened above)
  await runCmd(':log'); // distilled stats (0 warnings)
  await runCmd(':'); // bare colon -> unknown command (regex miss)
  await runCmd(':hel'); // unknown -> unique-prefix suggestion :help
  await runCmd(':e'); // unknown -> ambiguous prefix -> no suggestion
  await runCmd(':zzzzz'); // unknown -> no edit-distance match
  await runCmd(':example zzzz'); // no such example

  // Empty-scene command variants.
  await runCmd(':reset'); // clears scene + settings (-> 320x240)
  await runCmd(':list'); // scene empty
  await runCmd(':source'); // scene empty
  await runCmd(':undo'); // nothing to undo
  await runCmd(':render'); // scene empty, add something first
  await runCmd(':del 1'); // usage (1..0)
  await runCmd(':edit 1'); // usage (1..0)

  // --- PART 2: render-driving commands (small size) --------------------------
  await runCmd(':size 48x32');
  await submitRender('sphere { 0, 1 pigment { rgb <1,0,0> } }'); // entry A
  await submitRender('box { <-1,-1,-1>, <1,1,1> pigment { rgb <0,1,0> } }'); // entry B
  await runCmd(':q 5');
  await runCmd(':aa'); // antialias true -> downloadName + aaLabel exercised below
  await submitRender(':render'); // re-render [A,B] with quality + antialias
  await submitRender(':del 1'); // remove A, re-render the remaining entry
  await runCmd(':edit 1'); // copy B into the input, remove it (scene empty)
  assert.ok((await inputVal()).includes('box'), ':edit should copy the entry into the input');
  {
    // Resubmit B straight from the :edit-prefilled input (don't clear it).
    const before = await imgCount(page);
    await page.evaluate(() => document.getElementById('input').focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (n) => document.querySelectorAll('#scrollback img.preview').length > n,
      before,
      {
        timeout: 120_000,
      }
    );
  }
  await runCmd(':undo'); // remove the last entry (scene empty)

  // --- PART 3: warnings in the figcaption + :log -----------------------------
  await runCmd(':reset');
  await runCmd(':size 48x32');
  const WARN_ENTRY = '#warning "note" sphere { 0, 1 pigment { rgb <1,0,0> } }';
  await submitRender(WARN_ENTRY); // 1 warning -> singular caption
  await runCmd(':log'); // 1 warning -> singular, with the rewritten warning line
  await submitRender(WARN_ENTRY); // now 2 entries -> 2 warnings -> plural caption
  await runCmd(':log'); // 2 warnings -> plural

  // --- PART 4: cancel + flashHint (slow renders via cornell-mood) ------------
  // flashHint: submit while a >2s render is in flight; the 2s restore timer
  // fires mid-render.
  await runCmd(':reset');
  await runCmd(':size 1000x1000');
  {
    const before = await imgCount(page);
    await submit(page, ':example cornell-mood');
    await page.waitForFunction(() => document.getElementById('input').readOnly === true, null, {
      timeout: 60_000,
    });
    await page.keyboard.press('Enter'); // submit while busy -> flashHint
    await page.waitForFunction(
      (n) => document.querySelectorAll('#scrollback img.preview').length > n,
      before,
      {
        timeout: 120_000,
      }
    );
  }

  // cancel a fresh entry mid-render -> rollback + 'render cancelled' (cancel btn)
  await runCmd(':reset');
  await runCmd(':size 500x500');
  await submit(page, 'sphere { 0, 1 pigment { rgb <1,0,0> } }');
  await page.waitForFunction(() => document.getElementById('input').readOnly === true, null, {
    timeout: 60_000,
  });
  await page.click('#cancel-render');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('#scrollback .info')].some((el) =>
        el.textContent.includes('cancelled')
      ),
    null,
    { timeout: 30_000 }
  );

  // cancel a no-rollback render via Escape -> 'render cancelled' kept in place
  await submit(page, ':example csg-die');
  await page.waitForFunction(() => document.getElementById('input').readOnly === true, null, {
    timeout: 60_000,
  });
  await page.keyboard.press('Escape'); // document-level Escape abort
  await page.waitForFunction(() => document.getElementById('input').readOnly === false, null, {
    timeout: 30_000,
  });

  // no-rollback render that FAILS (bad raw args) -> error block in place
  await runCmd(':size 48x32');
  await runCmd(':args +ZZZ');
  {
    const before = await sbCount();
    await submit(page, ':render');
    await page.waitForFunction(
      (n) =>
        [...document.getElementById('scrollback').children]
          .slice(n)
          .some((el) => el.classList.contains('error')),
      before,
      { timeout: 60_000 }
    );
  }
  await runCmd(':args'); // clear the bad args

  // A no-brace entry that fails rolls back AND prints the "this is scene code"
  // tip (the entrySource-has-no-'{' branch).
  {
    const before = await sbCount();
    await submit(page, 'hello world not povray');
    await page.waitForFunction(
      (n) =>
        [...document.getElementById('scrollback').children]
          .slice(n)
          .some((el) => el.classList.contains('error') && el.textContent.includes('tip:')),
      before,
      { timeout: 60_000 }
    );
  }

  // --- PART 5: input mechanics -----------------------------------------------
  // Non-isolated submit bails (commands and entries both gate on isolation).
  await page.evaluate(() => {
    document.getElementById('iso-warning').hidden = true;
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => false });
  });
  await submit(page, 'sphere { 0, 1 pigment { rgb 1 } }');
  assert.equal(
    await page.evaluate(() => document.getElementById('iso-warning').hidden),
    false,
    'a non-isolated submit must surface the iso warning'
  );
  await page.evaluate(() => {
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, get: () => true });
    document.getElementById('iso-warning').hidden = true;
    document.getElementById('input').value = '';
  });

  // Empty submit is a no-op.
  await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = '';
    i.focus();
  });
  await page.keyboard.press('Enter');

  // The run button submits through the form handler.
  await page.fill('#input', ':list');
  await page.click('#run-btn');

  // Tab completion: unique prefix, ambiguous prefix, no match, non-command,
  // caret past the token.
  await page.fill('#input', ':hel');
  await page.keyboard.press('Tab');
  assert.equal(await inputVal(), ':help ', 'Tab should complete a unique :command');
  await page.fill('#input', ':e');
  await page.keyboard.press('Tab'); // ambiguous -> common prefix (no trailing space)
  await page.fill('#input', ':zzz');
  await page.keyboard.press('Tab'); // no candidates -> consumed, unchanged
  await page.fill('#input', 'plain text');
  await page.keyboard.press('Tab'); // not a :command -> Tab falls through
  await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = ':help extra';
    i.focus();
    i.setSelectionRange(11, 11); // caret past the command token
  });
  await page.keyboard.press('Tab');

  // Shift+Enter inserts a newline instead of submitting; Ctrl+Enter submits.
  await page.fill('#input', 'abc');
  await page.keyboard.press('Shift+Enter');
  assert.ok((await inputVal()).includes('\n'), 'Shift+Enter should insert a newline');
  await page.fill('#input', ':list');
  await page.keyboard.press('Control+Enter');

  // History recall: ArrowUp/Down on the first/last line; multi-line caret blocks
  // recall (caretOnFirstLine / caretOnLastLine false sides).
  await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = '';
    i.focus();
  });
  await page.keyboard.press('ArrowUp'); // recall previous
  assert.ok((await inputVal()).length > 0, 'ArrowUp should recall history');
  await page.keyboard.press('ArrowDown'); // step forward
  await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = 'a\nb';
    i.focus();
    i.setSelectionRange(3, 3); // caret on the last line, not the first
  });
  await page.keyboard.press('ArrowUp'); // caretOnFirstLine false -> no recall
  await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = 'a\nb';
    i.focus();
    i.setSelectionRange(0, 0); // caret on the first line, not the last
  });
  await page.keyboard.press('ArrowDown'); // caretOnLastLine false -> no recall
  await page.evaluate(() => {
    document.getElementById('input').value = '';
  });

  // Click an echoed entry to copy it back into the input; clicking links,
  // non-entry blocks, or while text is selected are all ignored.
  await page.click('#scrollback .entry pre.src');
  assert.ok((await inputVal()).length > 0, 'clicking an entry should copy it into the input');
  await page.evaluate(() => {
    document.getElementById('input').value = '';
  });
  await page.click('#scrollback .info'); // not inside an .entry -> ignored
  const saveLink = await page.$('#scrollback figure.result a');
  if (saveLink) await saveLink.click(); // an <a> inside the transcript -> ignored
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#scrollback .entry'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.click('#scrollback .entry pre.src'); // text selected -> ignored
  await page.evaluate(() => window.getSelection().removeAllRanges());

  // saveState swallows a storage write failure (persistence is best-effort).
  await page.evaluate(() => {
    window.__si = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('storage blocked');
    };
  });
  await runCmd(':q 7'); // triggers saveState -> catch
  await page.evaluate(() => {
    localStorage.setItem = window.__si;
  });

  // :reset swallows a removeItem failure too.
  await page.evaluate(() => {
    window.__ri = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = () => {
      throw new Error('storage blocked');
    };
  });
  await runCmd(':reset');
  await page.evaluate(() => {
    localStorage.removeItem = window.__ri;
  });

  // Scrollback eviction: seed past the 300-child cap, then one more append
  // evicts the oldest children (revoking any preview blob URLs they hold).
  await page.evaluate(() => {
    const sb = document.getElementById('scrollback');
    for (let i = 0; i < 305; i++) sb.appendChild(document.createElement('div'));
  });
  // appendNode -> over cap -> eviction loop. Eviction shrinks the count back to
  // the cap, so wait on the capped size + the new block rather than a delta.
  await submit(page, ':list');
  await page.waitForFunction(
    () => {
      const sb = document.getElementById('scrollback');
      return (
        sb.children.length <= 300 &&
        (sb.lastElementChild?.textContent ?? '').includes('scene empty')
      );
    },
    null,
    { timeout: 30_000 }
  );

  // --- PART 6: persistence restore -------------------------------------------
  const seedReload = async (blob) => {
    await page.addInitScript((b) => {
      localStorage.setItem('povrayer.repl.v1', b);
    }, blob);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelectorAll('#scrollback .info').length >= 1,
      null,
      { timeout: 30_000 }
    );
  };
  const lastInfo = () => lastInfoText(page);

  // Two valid entries + full settings + history -> 'restored 2 entries'.
  await seedReload(
    JSON.stringify({
      entries: [{ source: 'sphere { 0, 1 pigment { rgb 1 } }' }, { source: 'box { 0, 1 }' }],
      settings: { width: 100, height: 100, quality: 5, antialias: true, threads: 4, args: '+UA' },
      history: ['sphere { 0, 1 }', ':size 100x100'],
    })
  );
  assert.match(await lastInfo(), /restored 2 entries/, 'a saved blob should restore its entries');
  // On a fresh load nothing has rendered yet.
  await runCmd(':log'); // no render yet

  // One entry + number-range antialias -> singular 'restored 1 entry'.
  await seedReload(
    JSON.stringify({
      entries: [{ source: 'sphere { 0, 1 pigment { rgb 1 } }' }],
      settings: { width: 200, height: 150, quality: 3, antialias: 0.5, threads: 8, args: '+AM2' },
      history: ['only one'],
    })
  );
  assert.match(await lastInfo(), /restored 1 entry\b/, 'a single restored entry reads singular');

  // Every field invalid / wrong-typed -> nothing restored, no greeting.
  await seedReload(
    JSON.stringify({
      entries: [{ source: '' }, { source: 123 }, { nope: 1 }, 'not-an-object'],
      settings: { width: 1, height: 5000, quality: 99, antialias: 5, threads: 0, args: '   ' },
      history: [1, 2],
    })
  );
  // Non-object JSON -> loadState bails on the typeof guard.
  await seedReload('5');
  // Empty object -> no entries/settings/history arrays.
  await seedReload('{}');
  // Malformed JSON -> loadState swallows the parse error.
  await seedReload('{ not json');
} catch (err) {
  failure = err;
} finally {
  // Browser first (drops its keep-alive connections), then the server.
  if (page) await saveBrowserCoverage(page, 'repl');
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

if (failure) {
  console.error('repl test failed:', failure);
  if (consoleLines.length) {
    console.error('--- page console ---');
    console.error(consoleLines.join('\n'));
  }
  process.exit(1);
}

clearTimeout(watchdog);
console.log(
  'repl test passed (entry render, readOnly + figcaption, rollback, :size + :render, command ergonomics)'
);
