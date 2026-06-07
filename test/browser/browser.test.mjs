// Browser render test: playwright chromium against the COOP/COEP server.
// This script owns the server lifecycle; nothing else starts it.
//
// Two layers of timeout protection, because page.evaluate has NO timeout
// option (it waits indefinitely): a 120s Promise.race on the render itself,
// and a hard 180s process watchdog so a wedged browser can never hang CI.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const be32 = (bytes, off) =>
  ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
const rejectAfter = (ms, message) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref());

// Hard watchdog: only cleared on success, after browser and server have shut
// down cleanly. Anything wedged (including a hung browser.close()) dies here.
const watchdog = setTimeout(() => {
  console.error('watchdog: browser test still running after 180s, force-exiting');
  process.exit(1);
}, 180_000);

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
  // from a render regression.
  const iso = await page.evaluate(() => globalThis.crossOriginIsolated);
  assert.equal(iso, true, 'page is not crossOriginIsolated (COOP/COEP header regression)');

  // Bounded wait for the module script: if /index.js fails to import, fail in
  // 30s with the page console attached instead of riding out the watchdog.
  await page.waitForFunction(() => typeof window.runRender === 'function', null, {
    timeout: 30_000,
  });
  assert.equal(await page.evaluate(() => window.iso), true, 'window.iso should be true');

  const bytes = await Promise.race([
    page.evaluate(() => window.runRender()),
    rejectAfter(120_000, 'render did not complete within 120s'),
  ]);

  assert.deepEqual(bytes.slice(0, 8), PNG_SIGNATURE, 'PNG signature mismatch');
  assert.equal(be32(bytes, 16), 320, 'IHDR width');
  assert.equal(be32(bytes, 20), 240, 'IHDR height');
} catch (err) {
  failure = err;
} finally {
  // Browser first (drops its keep-alive connections), then the server.
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
}

if (failure) {
  console.error('browser test failed:', failure);
  if (consoleLines.length) {
    console.error('--- page console ---');
    console.error(consoleLines.join('\n'));
  }
  process.exit(1);
}

clearTimeout(watchdog);
console.log('browser render test passed (320x240 PNG, crossOriginIsolated)');
