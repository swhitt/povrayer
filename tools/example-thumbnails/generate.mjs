import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../../dist/index.js';
import { EXAMPLES, RENDER_TIERS } from '../../web/examples.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');
const outDir = resolve(repoRoot, 'web/example-thumbnails');
const tierQuality = new Map(RENDER_TIERS.map((tier) => [tier.key, Number(tier.quality)]));

const QUALITY_OVERRIDES = new Map([['god-rays', 9]]);

mkdirSync(outDir, { recursive: true });

for (const ex of EXAMPLES) {
  const quality = QUALITY_OVERRIDES.get(ex.name) ?? tierQuality.get(ex.renderTier);
  const png = await render(ex.source, {
    width: 160,
    height: 120,
    antialias: false,
    quality,
  });
  writeFileSync(resolve(outDir, `${ex.name}.png`), png);
  process.stdout.write(`wrote web/example-thumbnails/${ex.name}.png\n`);
}
