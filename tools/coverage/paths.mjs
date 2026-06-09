// Shared paths + the first-party file set for the coverage harness.
// One place so run.mjs, build-map.mjs, and check.mjs can't drift apart.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');

export const COVERAGE_DIR = resolve(repoRoot, 'coverage');
export const MERGED_FINAL = resolve(COVERAGE_DIR, 'coverage-final.json');

// RAW (pre-merge) coverage lives under coverage/raw/<shard>. Each shard root
// holds the c8 Node istanbul map at node/coverage-final.json and the Playwright
// V8 dumps in browser-v8/. The local full run uses a single 'full' shard; CI
// uses one root per parallel shard, downloaded back into coverage/raw/ before
// the merge. buildMergedMap is root-agnostic: it just reads these two locations
// from whatever roots it is handed, so the local one-root merge and the CI
// many-root merge are the SAME code path (the 100% gate can't drift between them).
export const RAW_DIR = resolve(COVERAGE_DIR, 'raw');
export const rawRoot = (shard) => resolve(RAW_DIR, shard);
export const rawNodeDir = (root) => resolve(root, 'node');
export const rawNodeFinal = (root) => resolve(rawNodeDir(root), 'coverage-final.json');
export const rawBrowserDir = (root) => resolve(root, 'browser-v8');

// Browser modules measured via Playwright V8 coverage, keyed by the basename
// the dev server serves them under, valued by their absolute repo path (so the
// converted istanbul map keys match the Node map for web/examples.js and merge
// cleanly). The wrapper (index.js) and the vendored coi-serviceworker.js are
// deliberately absent: the wrapper is measured Node-side, the SW is excluded.
export const WEB_FILES = {
  'render-client.js': resolve(repoRoot, 'web/render-client.js'),
  'ui.js': resolve(repoRoot, 'web/ui.js'),
  'repl.js': resolve(repoRoot, 'web/repl.js'),
  'examples.js': resolve(repoRoot, 'web/examples.js'),
  'highlight.js': resolve(repoRoot, 'web/highlight.js'),
  'complete.js': resolve(repoRoot, 'web/complete.js'),
  'context.js': resolve(repoRoot, 'web/context.js'),
  'assets.js': resolve(repoRoot, 'web/assets.js'),
  'sdl-validate.js': resolve(repoRoot, 'web/sdl-validate.js'),
  'permalink.js': resolve(repoRoot, 'web/permalink.js'),
};

// The 100%-or-bust set. Every file the gate enforces; a file missing from the
// merged map is itself a failure (a test stopped exercising it).
export const FIRST_PARTY = [
  resolve(repoRoot, 'dist/index.js'),
  resolve(repoRoot, 'src/cli.mjs'),
  resolve(repoRoot, 'test/browser/serve.mjs'),
  resolve(repoRoot, 'web/examples.js'),
  resolve(repoRoot, 'web/highlight.js'),
  resolve(repoRoot, 'web/complete.js'),
  resolve(repoRoot, 'web/context.js'),
  resolve(repoRoot, 'web/assets.js'),
  resolve(repoRoot, 'web/render-client.js'),
  resolve(repoRoot, 'web/sdl-validate.js'),
  resolve(repoRoot, 'web/permalink.js'),
  resolve(repoRoot, 'web/url-params.js'),
  resolve(repoRoot, 'web/flags.js'),
  resolve(repoRoot, 'web/stats.js'),
  resolve(repoRoot, 'web/apng.js'),
  resolve(repoRoot, 'web/gif.js'),
  resolve(repoRoot, 'web/ui.js'),
  resolve(repoRoot, 'web/repl.js'),
];

// Source files scanned for `c8 ignore` / `istanbul ignore` pragmas. dist is the
// built wrapper, but any ignore there originates in wrapper/src/index.ts, so we
// scan the TS source instead of the generated output.
export const IGNORE_SCAN_FILES = [
  resolve(repoRoot, 'wrapper/src/index.ts'),
  resolve(repoRoot, 'src/cli.mjs'),
  resolve(repoRoot, 'test/browser/serve.mjs'),
  resolve(repoRoot, 'web/examples.js'),
  resolve(repoRoot, 'web/highlight.js'),
  resolve(repoRoot, 'web/complete.js'),
  resolve(repoRoot, 'web/context.js'),
  resolve(repoRoot, 'web/assets.js'),
  resolve(repoRoot, 'web/render-client.js'),
  resolve(repoRoot, 'web/sdl-validate.js'),
  resolve(repoRoot, 'web/permalink.js'),
  resolve(repoRoot, 'web/url-params.js'),
  resolve(repoRoot, 'web/flags.js'),
  resolve(repoRoot, 'web/stats.js'),
  resolve(repoRoot, 'web/apng.js'),
  resolve(repoRoot, 'web/gif.js'),
  resolve(repoRoot, 'web/ui.js'),
  resolve(repoRoot, 'web/repl.js'),
];

// Display path relative to the repo root.
export function rel(absPath) {
  return absPath.startsWith(repoRoot + '/') ? absPath.slice(repoRoot.length + 1) : absPath;
}
