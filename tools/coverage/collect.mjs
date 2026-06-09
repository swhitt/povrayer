// Collect RAW (pre-merge) coverage for ONE shard of the suite. Runs that shard's
// test command under c8, writing the Node istanbul map to <root>/node and the
// browser Playwright V8 dumps to <root>/browser-v8 (root = coverage/raw/<shard>).
// Does NOT merge or gate; that is merge.mjs + check.mjs. Each parallel CI shard
// runs this and uploads its root; the local full run goes through here too
// (shard 'full'), so there is exactly ONE collection path and the sharded gate
// can't diverge from the single-process one.
import { rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, rawRoot, rawNodeDir, rawBrowserDir } from './paths.mjs';

// shard -> test command. Single-sourced so CI and local can't drift. The browser
// drivers run standalone (no pretest hook needed); the node shard goes through
// `npm run test:node` so its `pretest:node` link-wrapper still wires src/index.js
// for the CLI tests. 'full' is the local one-shot used by run.mjs.
export const SHARDS = {
  node: ['npm', 'run', 'test:node'],
  browser: ['node', 'test/browser/browser.test.mjs'],
  ui: ['node', 'test/browser/ui.test.mjs'],
  repl: ['node', 'test/browser/repl.test.mjs'],
  full: ['npm', 'test'],
};

export async function collectRaw(shard) {
  const cmd = SHARDS[shard];
  if (!cmd) {
    throw new Error(`collect: unknown shard '${shard}' (have: ${Object.keys(SHARDS).join(', ')})`);
  }
  const root = rawRoot(shard);
  const nodeDir = rawNodeDir(root);
  const browserDir = rawBrowserDir(root);

  // Clean only THIS shard's root so a sibling shard (parallel CI, or a local
  // multi-shard verify) keeps its own raw dumps.
  await rm(root, { recursive: true, force: true });
  await mkdir(nodeDir, { recursive: true });
  await mkdir(browserDir, { recursive: true });

  // c8 reads .c8rc.json (all:true, include/exclude, json reporter) but we steer
  // its output per shard with --reports-dir / --temp-directory. POVRAYER_COVERAGE
  // makes the browser drivers dump V8 into POVRAYER_COVERAGE_DIR.
  const run = spawnSync(
    'npx',
    [
      'c8',
      '--config',
      '.c8rc.json',
      '--reports-dir',
      nodeDir,
      '--temp-directory',
      resolve(nodeDir, '.v8'),
      ...cmd,
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        POVRAYER_COVERAGE: '1',
        POVRAYER_COVERAGE_DIR: browserDir,
      },
    }
  );
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
