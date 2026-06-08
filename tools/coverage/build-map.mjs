// Merges the two coverage sources into one istanbul coverage map:
//   1. Node istanbul JSON from c8 (wrapper, cli, serve, examples).
//   2. Browser raw V8 dumps from Playwright, converted per web module with
//      v8-to-istanbul (the same converter c8 uses, so web/examples.js lines
//      up byte-for-byte with the Node map and the hit counts add).
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import v8toIstanbul from 'v8-to-istanbul';
import { NODE_FINAL, BROWSER_V8_DIR, WEB_FILES } from './paths.mjs';

export async function buildMergedMap() {
  const map = libCoverage.createCoverageMap({});

  if (existsSync(NODE_FINAL)) {
    map.merge(JSON.parse(await readFile(NODE_FINAL, 'utf8')));
  }

  if (existsSync(BROWSER_V8_DIR)) {
    for (const file of await readdir(BROWSER_V8_DIR)) {
      if (!file.endsWith('.json')) continue;
      const entries = JSON.parse(await readFile(join(BROWSER_V8_DIR, file), 'utf8'));
      for (const entry of entries) {
        if (!entry.url || !entry.source) continue;
        // url is the served URL (http://127.0.0.1:PORT/ui.js); key by basename.
        const name = basename(new URL(entry.url, 'http://localhost').pathname);
        const filePath = WEB_FILES[name];
        if (!filePath) continue; // wrapper / povray.mjs / SW: not measured here
        const converter = v8toIstanbul(filePath, 0, { source: entry.source });
        await converter.load();
        converter.applyCoverage(entry.functions);
        map.merge(converter.toIstanbul());
      }
    }
  }

  return map;
}
