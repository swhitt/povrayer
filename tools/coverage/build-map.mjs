// Merges the two coverage sources into one istanbul coverage map:
//   1. Node istanbul JSON from c8 (wrapper, cli, serve, examples).
//   2. Browser raw V8 dumps from Playwright, converted per web module with
//      v8-to-istanbul (the same converter c8 uses, so web/examples.js lines
//      up byte-for-byte with the Node map and the hit counts add).
//
// Accepts one or more RAW roots (coverage/raw/<shard>). The local full run
// passes a single root; CI passes one per shard. istanbul `map.merge` sums the
// per-statement/branch/function hit counts across roots, so the union of the
// shards is identical to a single full run (each test process is independent).
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import v8toIstanbul from 'v8-to-istanbul';
import { rawNodeFinal, rawBrowserDir, WEB_FILES } from './paths.mjs';

export async function buildMergedMap(roots) {
  const map = libCoverage.createCoverageMap({});

  for (const root of roots) {
    const nodeFinal = rawNodeFinal(root);
    if (existsSync(nodeFinal)) {
      map.merge(JSON.parse(await readFile(nodeFinal, 'utf8')));
    }

    const browserDir = rawBrowserDir(root);
    if (!existsSync(browserDir)) continue;
    for (const file of await readdir(browserDir)) {
      if (!file.endsWith('.json')) continue;
      const entries = JSON.parse(await readFile(join(browserDir, file), 'utf8'));
      for (const entry of entries) {
        if (!entry.url || !entry.source) continue;
        // url is the served URL (http://127.0.0.1:PORT/ui.js); key by basename.
        const name = basename(new URL(entry.url, 'http://localhost').pathname);
        const filePath = WEB_FILES[name];
        // Generated runtimes and Turbo's inline scripts have no standalone web
        // module path. Turbo is exercised behaviorally by turbo.test.mjs; its
        // shared language modules and service worker are measured Node-side.
        if (!filePath) continue;
        const converter = v8toIstanbul(filePath, 0, { source: entry.source });
        await converter.load();
        converter.applyCoverage(entry.functions);
        map.merge(converter.toIstanbul());
      }
    }
  }

  return map;
}
