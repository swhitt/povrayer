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
// `path` is always the SOURCE path, and for web/*.ts that is also the key the
// gate sees: tsconfig.build.json emits an inline source map, so both c8 and
// build-map.mjs re-key their coverage from _build/web/foo.js back to web/foo.ts.
// The gate therefore reports on TypeScript source, never on compiled output.
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
  { path: 'web/examples-sourced.js', browser: true },
  { path: 'web/example-filters.ts', browser: true },
  { path: 'web/gallery.ts', browser: true },
  { path: 'web/dom.ts', browser: true },
  { path: 'web/orb.ts' },
  { path: 'web/highlight.js', browser: true },
  { path: 'web/glsl-highlight.js' },
  { path: 'web/sdl-strip.ts', browser: true },
  { path: 'web/complete.js', browser: true },
  { path: 'web/context.js', browser: true },
  { path: 'web/assets.ts', browser: true },
  { path: 'web/sliders.ts', browser: true },
  { path: 'web/settings.ts', browser: true },
  { path: 'web/history.ts', browser: true },
  { path: 'web/render-feedback.ts', browser: true },
  { path: 'web/render-client.ts', browser: true },
  { path: 'web/render-orchestrator.ts', browser: true },
  { path: 'web/sdl-validate.ts', browser: true },
  { path: 'web/scene-state.ts', browser: true },
  { path: 'web/permalink.ts', browser: true },
  { path: 'web/url-params.ts' },
  { path: 'web/flags.ts' },
  { path: 'web/stats.ts' },
  { path: 'web/apng.ts' },
  { path: 'web/gif.ts' },
  { path: 'web/ui.js', browser: true },
  { path: 'web/player.ts', browser: true },
  { path: 'web/repl.js', browser: true },
  { path: 'web/repl-scene.ts', browser: true },
  { path: 'web/anim-export.ts', browser: true },
  { path: 'web/asset-drop.ts', browser: true },
  { path: 'web/coi.ts', browser: true },
  { path: 'web/live-draft.ts', browser: true },
  { path: 'web/turbo-sw.js' },
];

// The ARTIFACT a given source is loaded as at runtime. A web/*.ts module is
// never loaded directly (no browser reads .ts, and neither does Node 20), so its
// artifact is the compiled _build/web/*.js that tools/build-web.mjs produces and
// that both test/browser/serve.mjs and tools/assemble-site.mjs overlay. Anything
// still written in JavaScript is its own artifact, shipped byte-identical.
//
// This is what keeps the basename lookup below honest through the migration: the
// served name stays `ui.js` whether the source is ui.js or ui.ts.
//
// It is also the set .c8rc.json has to enroll, because c8 filters V8 scripts by
// the path Node actually loaded, BEFORE the source map is applied: a compiled
// module listed as `web/foo.ts` would simply never be measured.
// test/node/coverage-config.test.mjs asserts .c8rc.json against this function so
// the two cannot drift.
/**
 * @param {string} sourcePath a repo-relative first-party source path
 * @returns {string} the repo-relative path of the artifact that is actually loaded
 */
export function servedPath(sourcePath) {
  return sourcePath.startsWith('web/') && sourcePath.endsWith('.ts')
    ? `_build/${sourcePath.slice(0, -3)}.js`
    : sourcePath;
}

// Browser modules measured via Playwright V8 coverage, keyed by the basename the
// dev server serves them under, valued by the absolute path of the artifact the
// browser actually loaded. Handing v8-to-istanbul the COMPILED path matters for
// a .ts module: the inline map's `sources` is relative to the emitted file, so
// resolving it from anywhere else would invent a path that does not exist. Once
// resolved, the map keys land on web/foo.ts and merge with the Node map for
// shared modules like web/examples.js exactly as before.
export const WEB_FILES = Object.fromEntries(
  FILES.filter((f) => f.browser).map((f) => [
    basename(servedPath(f.path)),
    resolve(repoRoot, servedPath(f.path)),
  ])
);

// The 100%-or-bust set. Every file the gate enforces; a file missing from the
// merged map is itself a failure (a test stopped exercising it). Keyed on SOURCE
// (see the note on `path` above), so converting a module to TypeScript moves its
// gate entry rather than dropping it.
export const FIRST_PARTY = FILES.map((f) => resolve(repoRoot, f.path));

// Source files scanned for `c8 ignore` / `istanbul ignore` pragmas, using each
// file's `scan` override where the measured artifact differs from its source.
export const IGNORE_SCAN_FILES = FILES.map((f) => resolve(repoRoot, f.scan ?? f.path));

// Display path relative to the repo root.
export function rel(absPath) {
  return absPath.startsWith(repoRoot + '/') ? absPath.slice(repoRoot.length + 1) : absPath;
}
