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
let failure;

try {
  server = await startServer();
  browser = await chromium.launch();
  const page = await browser.newPage();
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
  await page.waitForFunction(() => document.querySelectorAll('#scrollback .info').length >= 1, null, {
    timeout: 30_000,
  });

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
} catch (err) {
  failure = err;
} finally {
  // Browser first (drops its keep-alive connections), then the server.
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
