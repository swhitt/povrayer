// `npm run coverage:check`: the 100% gate. Reads the merged report written by
// `npm run coverage` and fails if any first-party file is below 100% on
// statements / functions / lines / branches. Also audits every `c8 ignore` /
// `istanbul ignore` pragma: each must carry a `-- <reason>`, and the count is
// reported (so suppressions stay visible and justified).
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import libCoverage from 'istanbul-lib-coverage';
import { MERGED_FINAL, FIRST_PARTY, IGNORE_SCAN_FILES, rel } from './paths.mjs';
import { printFileGaps } from './gaps.mjs';

if (!existsSync(MERGED_FINAL)) {
  console.error(
    `coverage:check: ${rel(MERGED_FINAL)} not found. Run \`npm run coverage\` first.`
  );
  process.exit(1);
}

const map = libCoverage.createCoverageMap(JSON.parse(await readFile(MERGED_FINAL, 'utf8')));
const METRICS = ['statements', 'functions', 'lines', 'branches'];

let failed = false;

console.log('=== coverage gate: 100% first-party (statements/functions/lines/branches) ===');
for (const abs of FIRST_PARTY) {
  if (!map.files().includes(abs)) {
    console.error(`FAIL ${rel(abs)}: missing from coverage (no test loaded it)`);
    failed = true;
    continue;
  }
  const fc = map.fileCoverageFor(abs);
  const s = fc.toSummary().data;
  const below = METRICS.filter((m) => s[m].pct < 100);
  if (below.length) {
    failed = true;
    console.error(`FAIL ${rel(abs)}: ${below.map((m) => `${m} ${s[m].pct}%`).join(', ')}`);
    printFileGaps(abs, fc);
  } else {
    console.log(`ok   ${rel(abs)}`);
  }
}

// --- ignore-pragma audit ------------------------------------------------------
// A genuinely unhittable branch may be excluded with `/* c8 ignore next -- why */`,
// but only WITH a reason. We scan source (TS for the wrapper, since dist is
// generated) and fail any pragma missing its `--` reason.
function scanIgnores() {
  const found = [];
  for (const abs of IGNORE_SCAN_FILES) {
    if (!existsSync(abs)) continue;
    readFileSync(abs, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const m = /\b(c8|istanbul) ignore\b([^]*?)(?:\*\/|$)/.exec(text);
        if (!m) return;
        const reason = /--\s*(.+?)\s*$/.exec(m[2].replace(/\*\/.*$/, ''));
        found.push({
          file: abs,
          line: i + 1,
          tool: m[1],
          reason: reason ? reason[1].trim() : null,
        });
      });
  }
  return found;
}

const ignores = scanIgnores();
console.log(`\n=== ignore pragmas (${ignores.length}) ===`);
if (!ignores.length) {
  console.log('none');
}
for (const ig of ignores) {
  if (ig.reason) {
    console.log(`ok   ${rel(ig.file)}:${ig.line} (${ig.tool}) -- ${ig.reason}`);
  } else {
    console.error(`FAIL ${rel(ig.file)}:${ig.line} (${ig.tool}) missing "-- <reason>"`);
    failed = true;
  }
}

console.log('');
if (failed) {
  console.error('coverage:check: FAILED (see gaps above)');
  process.exit(1);
}
console.log('coverage:check: PASS (all first-party files at 100%)');
