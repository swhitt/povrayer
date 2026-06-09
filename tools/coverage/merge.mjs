// Merge accumulated RAW shard coverage into the single report `coverage:check`
// gates on. CI's merge-gate job downloads every shard's root into coverage/raw/
// and runs this, then `npm run coverage:check`. With no args it merges every
// coverage/raw/* root it finds; explicit root paths can be passed for a targeted
// merge (run.mjs passes just the 'full' root). Writes coverage/coverage-final.json
// (+ lcov + html) and prints the first-party summary. Does NOT enforce the gate.
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { buildMergedMap } from './build-map.mjs';
import { printFileGaps } from './gaps.mjs';
import { COVERAGE_DIR, RAW_DIR, FIRST_PARTY, rel } from './paths.mjs';

// Every immediate subdir of coverage/raw is a shard root (its name is irrelevant
// to the merge; CI's download-artifact names them rawcov-<shard>, locally they
// are <shard>). Returns absolute paths.
async function discoverRoots() {
  if (!existsSync(RAW_DIR)) return [];
  const roots = [];
  for (const name of await readdir(RAW_DIR)) {
    const p = resolve(RAW_DIR, name);
    if ((await stat(p)).isDirectory()) roots.push(p);
  }
  return roots;
}

export async function mergeReport(roots) {
  const map = await buildMergedMap(roots);

  await mkdir(COVERAGE_DIR, { recursive: true });
  const context = libReport.createContext({ dir: COVERAGE_DIR, coverageMap: map });
  for (const reporter of [
    reports.create('json', { file: 'coverage-final.json' }),
    reports.create('lcovonly', { file: 'lcov.info' }),
    reports.create('html', { subdir: 'html' }),
  ]) {
    reporter.execute(context);
  }

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
  console.log(
    `\nmerged report: ${rel(COVERAGE_DIR)}/ (coverage-final.json, lcov.info, html/) from ${roots.length} raw root(s)`
  );
  return { anyMissing };
}

// CLI: node tools/coverage/merge.mjs [root ...]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const roots = args.length ? args.map((r) => resolve(r)) : await discoverRoots();
  if (!roots.length) {
    console.error('merge: no raw coverage roots found. Run `collect.mjs <shard>` first.');
    process.exit(1);
  }
  const { anyMissing } = await mergeReport(roots);
  console.log('gate: run `npm run coverage:check` to enforce 100%.');
  if (anyMissing) {
    console.error('\ncoverage: one or more first-party files were never loaded.');
  }
}
