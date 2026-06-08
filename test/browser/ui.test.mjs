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

// Hard watchdog: only cleared on success, after browser and server have shut
// down cleanly.
const watchdog = setTimeout(() => {
  console.error('watchdog: ui test still running after 300s, force-exiting');
  process.exit(1);
}, 300_000);

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
  const logSummary = await page.evaluate(
    () => document.getElementById('log-summary').textContent
  );
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
} catch (err) {
  failure = err;
} finally {
  // Browser first (drops its keep-alive connections), then the server.
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
