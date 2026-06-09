// `npm run coverage`: produce ONE merged report from the Node (c8) and browser
// (Playwright V8) coverage sources, single-process. Does NOT enforce thresholds;
// that is `npm run coverage:check`. Always writes the merged report, even if a
// test failed, but exits non-zero so CI / the pre-push hook still notice a
// broken suite.
//
// This is the local convenience path: it collects the WHOLE suite into one raw
// root ('full') and merges that single root. CI splits the same collection
// across parallel shards (collect.mjs per shard) and merges them in a gate job
// (merge.mjs) -- but through the exact same collect + buildMergedMap machinery,
// so the 100% gate is identical either way.
import { rm } from 'node:fs/promises';
import { collectRaw } from './collect.mjs';
import { mergeReport } from './merge.mjs';
import { COVERAGE_DIR, rawRoot } from './paths.mjs';

// Clean slate so stale dumps never inflate a run.
await rm(COVERAGE_DIR, { recursive: true, force: true });

// 1. Run the whole suite under c8, dumping raw Node + browser coverage into the
//    single 'full' root.
console.log('coverage: running suite under c8 (node + browser)...');
const status = await collectRaw('full');
const testsFailed = status !== 0;
if (testsFailed) {
  console.error(`\ncoverage: suite exited ${status}; report below may be incomplete.`);
}

// 2. Merge that root into the standard reports + first-party summary.
const { anyMissing } = await mergeReport([rawRoot('full')]);
console.log('gate: run `npm run coverage:check` to enforce 100%.');

if (anyMissing) {
  console.error('\ncoverage: one or more first-party files were never loaded.');
}
process.exit(testsFailed ? 1 : 0);
