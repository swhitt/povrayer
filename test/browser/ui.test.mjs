// UI page test: drives web/index.html (served at /) through the COOP/COEP
// server. This script owns the server lifecycle; nothing else starts it.
//
// Mirrors browser.test.mjs's timeout discipline: page.evaluate has NO timeout
// option, so every long wait here is a waitForFunction with an explicit
// timeout, and a hard 300s process watchdog force-exits if anything (including
// a hung browser.close()) wedges.
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import {
  startBrowserCoverage,
  saveBrowserCoverage,
} from '../../tools/coverage/browser-collect.mjs';
import { createUiHarness } from './ui/harness.mjs';
import { runStartupRender } from './ui/startup-render.mjs';
import { runCatalogEditor } from './ui/catalog-editor.mjs';
import { runPlaybackDrafts } from './ui/playback-drafts.mjs';
import { runDeepLinks } from './ui/deep-links.mjs';
import { runEditorTools } from './ui/editor-tools.mjs';
import { runOutputMobile } from './ui/output-mobile.mjs';

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

  const harness = createUiHarness({ server, browser, page });
  await runStartupRender(harness);
  await runCatalogEditor(harness);
  await runPlaybackDrafts(harness);
  await runDeepLinks(harness);
  await runEditorTools(harness);
  await runOutputMobile(harness);
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
