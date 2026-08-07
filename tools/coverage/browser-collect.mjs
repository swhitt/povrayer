// Playwright V8 coverage collection for the browser test drivers. Both helpers
// are no-ops unless POVRAYER_COVERAGE is set, so a plain `npm test` runs exactly
// as before; `npm run coverage` flips the env on and dumps one raw V8 file per
// driver into POVRAYER_COVERAGE_DIR for tools/coverage to convert + merge.
//
// playwright is deliberately pinned to 1.61.1: its Chromium reports V8 function
// coverage for every function in a module, while 1.62.1's under-reports badly
// (web/ui.js 168 functions -> 167 found / 115 hit, web/repl.js 61 -> 51 / 7),
// which drops the 100% gate below threshold even though the same tests pass and
// line coverage is unchanged. The tests are not at fault; the dumps themselves
// are missing the functions. Re-check on a future Playwright before unpinning:
// bump it, run `node tools/coverage/collect.mjs ui` and confirm the FNF/FNH in
// coverage/lcov.info for web/ui.js is 168/168.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENABLED = !!process.env.POVRAYER_COVERAGE;
const DIR = process.env.POVRAYER_COVERAGE_DIR;

// Call right after page creation, BEFORE page.goto, so the module scripts the
// page loads during navigation are captured. resetOnNavigation:false keeps the
// counters across the single goto each driver performs.
export async function startBrowserCoverage(page) {
  if (!ENABLED) return;
  try {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
  } catch {
    // page.coverage is Chromium-only; the suite only uses Chromium, but never
    // let a coverage hiccup fail the actual test.
  }
}

// Call once at the end (before browser.close). `name` disambiguates the dump
// file per driver.
export async function saveBrowserCoverage(page, name) {
  if (!ENABLED || !DIR) return;
  let entries;
  try {
    entries = await page.coverage.stopJSCoverage();
  } catch {
    return; // coverage wasn't started (non-Chromium) or page already gone
  }
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${name}.json`), JSON.stringify(entries));
  } catch {
    // Disk hiccup: coverage is best-effort, the test result is what matters.
  }
}
