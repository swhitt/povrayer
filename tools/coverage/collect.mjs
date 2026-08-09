// Collect RAW (pre-merge) coverage for ONE shard of the suite. Runs that shard's
// test command under c8, writing the Node istanbul map to <root>/node and the
// browser Playwright V8 dumps to <root>/browser-v8 (root = coverage/raw/<shard>).
// Does NOT merge or gate; that is merge.mjs + check.mjs. Each parallel CI shard
// runs this and uploads its root; the local full run goes through here too
// (shard 'full'), so there is exactly ONE collection path and the sharded gate
// can't diverge from the single-process one.
import { rm, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, rawRoot, rawNodeDir, rawBrowserDir } from './paths.mjs';
import { buildWeb } from '../build-web.mjs';

// Deep requires into c8: deliberate. c8 has no exports map, the Report half of
// the package is yargs-free, and only the yargs half is broken on Node >= 26.
const require = createRequire(import.meta.url);
const { outputReport } = require('c8/lib/commands/report.js');
const defaultExtension = require('@istanbuljs/schema/default-extension');

// shard -> test command. Single-sourced so CI and local can't drift. The browser
// drivers run standalone (no pretest hook needed); the node shard goes through
// `npm run test:node` so its `pretest:node` link-wrapper still wires src/index.js
// for the CLI tests. 'full' is the local one-shot used by run.mjs.
export const SHARDS = {
  // SERIAL, like the node-20-compat lane and for the same measured reason:
  // concurrent WASM renders exhaust POV-Ray's worker startup budget on a small
  // runner. This shard is the heaviest thing in CI (it renders all 96 example
  // scenes) and it hung for over two hours on a 4-core runner inside the
  // animation tests, having passed the run before. Coverage is identical either
  // way (the same files execute, just not at the same time), and the Node 20 lane
  // already proves serial finishes in acceptable time, so the concurrency was
  // buying wall-clock at the price of a flake class the repo had already
  // diagnosed once.
  node: ['npm', 'run', 'test:node:serial'],
  browser: ['npm', 'run', 'test:browser:core'],
  ui: ['node', 'test/browser/ui.test.mjs'],
  repl: ['node', 'test/browser/repl.test.mjs'],
  full: ['npm', 'test'],
};

export async function collectRaw(shard) {
  const cmd = SHARDS[shard];
  if (!cmd) {
    throw new Error(`collect: unknown shard '${shard}' (have: ${Object.keys(SHARDS).join(', ')})`);
  }

  // Compile web/*.ts before spawning the shard. Necessary because this is the ONE
  // entry point the npm pre-hooks do not cover: the browser shards run their
  // drivers directly (`node test/browser/ui.test.mjs`, see SHARDS above), so no
  // pretest hook fires, and the drivers STATICALLY import out of _build/web (e.g.
  // test/browser/ui/deep-links.mjs imports permalink), which is evaluated before
  // test/browser/serve.mjs gets the chance to build. CI caught this as
  // ERR_MODULE_NOT_FOUND on a clean checkout while it passed locally purely
  // because _build already existed. buildWeb() verifies freshness rather than
  // rebuilding, so calling it here costs nothing when the output is current.
  buildWeb();
  const root = rawRoot(shard);
  const nodeDir = rawNodeDir(root);
  const browserDir = rawBrowserDir(root);

  // Clean only THIS shard's root so a sibling shard (parallel CI, or a local
  // multi-shard verify) keeps its own raw dumps.
  await rm(root, { recursive: true, force: true });
  await mkdir(nodeDir, { recursive: true });
  await mkdir(browserDir, { recursive: true });

  // The c8 CLI is unusable on Node >= 26 (its yargs 17 dependency ships an
  // extensionless CJS entry that newer Node force-parses as ESM and crashes),
  // so this replicates the CLI's two halves directly: NODE_V8_COVERAGE on the
  // child is the entire instrumentation story (every Node process in the tree
  // inherits it and dumps V8 JSON), and c8's yargs-free outputReport() is the
  // CLI's own report path. .c8rc.json still holds all:true + include/exclude
  // (the keys the CLI would have read); we steer output per shard with
  // reports-dir / temp-directory, exactly as the old --flags did.
  // POVRAYER_COVERAGE makes the browser drivers dump V8 into
  // POVRAYER_COVERAGE_DIR.
  const tempDir = resolve(nodeDir, '.v8');
  await mkdir(tempDir, { recursive: true });
  const run = spawnSync(cmd[0], cmd.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_V8_COVERAGE: tempDir,
      POVRAYER_COVERAGE: '1',
      POVRAYER_COVERAGE_DIR: browserDir,
    },
  });
  const c8rc = JSON.parse(await readFile(resolve(repoRoot, '.c8rc.json'), 'utf8'));
  // Mirrors lib/commands/report.js's argv contract; the literals are the CLI
  // defaults .c8rc.json relied on (extension list, omit-relative, resolve).
  await outputReport({
    include: c8rc.include,
    exclude: c8rc.exclude,
    extension: defaultExtension,
    excludeAfterRemap: false,
    reporter: c8rc.reporter,
    'reports-dir': nodeDir,
    tempDirectory: tempDir,
    resolve: '',
    omitRelative: true,
    wrapperLength: 0,
    all: c8rc.all,
    allowExternal: false,
    src: c8rc.src,
    skipFull: false,
    excludeNodeModules: c8rc.excludeNodeModules,
    mergeAsync: false,
  });
  return run.status ?? 1;
}

// CLI: node tools/coverage/collect.mjs <shard>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shard = process.argv[2];
  if (!shard) {
    console.error(`usage: collect.mjs <${Object.keys(SHARDS).join('|')}>`);
    process.exit(2);
  }
  console.log(`coverage: collecting raw coverage for shard '${shard}'...`);
  const status = await collectRaw(shard);
  if (status !== 0) {
    console.error(`\ncoverage: shard '${shard}' exited ${status} (broken suite).`);
  }
  process.exit(status);
}
