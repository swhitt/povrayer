// Shared paths + the first-party file set for the coverage harness.
// One place so run.mjs, build-map.mjs, and check.mjs can't drift apart.
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';

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

// The single first-party manifest. Every list below is derived from this so the
// three views (gate set, browser map, pragma-scan set) can never drift apart;
// adding a file is a one-line edit here. Order is the gate's display order.
//
// Per-file flags:
//   browser - also measured in the browser via Playwright V8 coverage. These
//             web/ modules run in Chromium against the real DOM; the rest are
//             measured Node-side (pure modules under node --test, the CLI, the
//             dev server) or both (a pure module imported by ui.js merges its
//             two maps by absolute path). The vendored coi-serviceworker.js is
//             absent entirely: it is excluded, not first-party.
//   scan    - the source to scan for `c8 ignore` / `istanbul ignore` pragmas
//             when it differs from the measured path. dist/index.js is the built
//             wrapper; any ignore there originates in wrapper/src/index.ts, so we
//             scan the TS source instead of the generated output.
/** @type {Array<{ path: string, browser?: boolean, scan?: string }>} */
const FILES = [
  { path: 'dist/index.js', scan: 'wrapper/src/index.ts' },
  { path: 'src/cli.mjs' },
  { path: 'test/browser/serve.mjs' },
  { path: 'web/examples.js', browser: true },
  { path: 'web/highlight.js', browser: true },
  { path: 'web/sdl-strip.js', browser: true },
  { path: 'web/complete.js', browser: true },
  { path: 'web/context.js', browser: true },
  { path: 'web/assets.js', browser: true },
  { path: 'web/sliders.js', browser: true },
  { path: 'web/settings.js', browser: true },
  { path: 'web/render-client.js', browser: true },
  { path: 'web/sdl-validate.js', browser: true },
  { path: 'web/permalink.js', browser: true },
  { path: 'web/url-params.js' },
  { path: 'web/flags.js' },
  { path: 'web/stats.js' },
  { path: 'web/apng.js' },
  { path: 'web/gif.js' },
  { path: 'web/ui.js', browser: true },
  { path: 'web/repl.js', browser: true },
  { path: 'web/anim-export.js', browser: true },
];

// Browser modules measured via Playwright V8 coverage, keyed by the basename the
// dev server serves them under, valued by their absolute repo path (so the
// converted istanbul map keys match the Node map for shared modules like
// web/examples.js and merge cleanly).
export const WEB_FILES = Object.fromEntries(
  FILES.filter((f) => f.browser).map((f) => [basename(f.path), resolve(repoRoot, f.path)])
);

// The 100%-or-bust set. Every file the gate enforces; a file missing from the
// merged map is itself a failure (a test stopped exercising it).
export const FIRST_PARTY = FILES.map((f) => resolve(repoRoot, f.path));

// Source files scanned for `c8 ignore` / `istanbul ignore` pragmas, using each
// file's `scan` override where the measured artifact differs from its source.
export const IGNORE_SCAN_FILES = FILES.map((f) => resolve(repoRoot, f.scan ?? f.path));

// Display path relative to the repo root.
export function rel(absPath) {
  return absPath.startsWith(repoRoot + '/') ? absPath.slice(repoRoot.length + 1) : absPath;
}
