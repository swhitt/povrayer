import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../../dist/index.js';
import { EXAMPLES } from '../../web/examples.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');
const outDir = resolve(repoRoot, 'web/example-thumbnails');

mkdirSync(outDir, { recursive: true });

// Full quality + antialiasing for every thumbnail, regardless of the example's
// render tier: the tiers protect interactive latency, but thumbnails are
// generated offline where only the result matters. At gallery-card size the
// q9 ray features and AA are exactly what keeps them from looking like mush.
for (const ex of EXAMPLES) {
  const png = await render(ex.source, {
    width: 160,
    height: 120,
    antialias: 0.3,
    quality: 9,
  });
  writeFileSync(resolve(outDir, `${ex.name}.png`), png);
  process.stdout.write(`wrote web/example-thumbnails/${ex.name}.png\n`);
}
