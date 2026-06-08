// Playwright V8 coverage collection for the browser test drivers. Both helpers
// are no-ops unless POVRAYER_COVERAGE is set, so a plain `npm test` runs exactly
// as before; `npm run coverage` flips the env on and dumps one raw V8 file per
// driver into POVRAYER_COVERAGE_DIR for tools/coverage to convert + merge.
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
