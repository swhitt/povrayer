// `npm run coverage`: produce ONE merged report from the Node (c8) and browser
// (Playwright V8) coverage sources. Does NOT enforce thresholds; that is
// `npm run coverage:check`. Always writes the merged report, even if a test
// failed, but exits non-zero so CI still notices a broken suite.
import { rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { buildMergedMap } from './build-map.mjs';
import { printFileGaps } from './gaps.mjs';
import { repoRoot, COVERAGE_DIR, BROWSER_V8_DIR, NODE_DIR, FIRST_PARTY, rel } from './paths.mjs';

// 1. Clean slate so stale dumps never inflate a run.
await rm(COVERAGE_DIR, { recursive: true, force: true });
await mkdir(BROWSER_V8_DIR, { recursive: true });
await mkdir(NODE_DIR, { recursive: true });

// 2. Run the whole suite under c8. c8 captures Node coverage for every spawned
//    process; the browser drivers additionally dump their V8 coverage because
//    POVRAYER_COVERAGE is set.
console.log('coverage: running suite under c8 (node + browser)...');
const run = spawnSync('npx', ['c8', '--config', '.c8rc.json', 'npm', 'test'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    POVRAYER_COVERAGE: '1',
    POVRAYER_COVERAGE_DIR: BROWSER_V8_DIR,
  },
});
const testsFailed = run.status !== 0;
if (testsFailed) {
  console.error(`\ncoverage: suite exited ${run.status}; report below may be incomplete.`);
}

// 3. Merge Node + browser into one map and emit the standard reports.
const map = await buildMergedMap();
const context = libReport.createContext({ dir: COVERAGE_DIR, coverageMap: map });
for (const reporter of [
  reports.create('json', { file: 'coverage-final.json' }),
  reports.create('lcovonly', { file: 'lcov.info' }),
  reports.create('html', { subdir: 'html' }),
]) {
  reporter.execute(context);
}

// 4. First-party summary to stdout.
console.log('\n=== merged first-party coverage ===');
let anyMissing = false;
for (const abs of FIRST_PARTY) {
  if (!map.files().includes(abs)) {
    console.log(`\n${rel(abs)}\n  MISSING from coverage (no test exercised it)`);
    anyMissing = true;
    continue;
  }
  printFileGaps(abs, map.fileCoverageFor(abs));
}
console.log(`\nmerged report: ${rel(COVERAGE_DIR)}/ (coverage-final.json, lcov.info, html/)`);
console.log('gate: run `npm run coverage:check` to enforce 100%.');

if (anyMissing) {
  console.error('\ncoverage: one or more first-party files were never loaded.');
}
process.exit(testsFailed ? 1 : 0);
