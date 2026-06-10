import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { CATEGORIES, DIFFICULTIES, EXAMPLES, RENDER_TIERS } from '../../web/examples.js';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');
const outPath = resolve(repoRoot, 'docs/examples.md');

const categoryLabels = new Map(CATEGORIES.map((c) => [c.key, c.label]));
const difficultyLabels = new Map(DIFFICULTIES.map((d) => [d.key, d.label]));
const tierLabels = new Map(RENDER_TIERS.map((t) => [t.key, t.label]));

function md(text) {
  return String(text).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function sourceCell(ex) {
  if (!ex.sourceUrl) return 'Bundled original';
  return `[Source](${ex.sourceUrl})`;
}

function renderedDoc() {
  const rows = EXAMPLES.map((ex) =>
    [
      md(ex.title),
      md(categoryLabels.get(ex.category)),
      ex.animated ? 'Animated' : 'Still',
      md(difficultyLabels.get(ex.difficulty)),
      md(tierLabels.get(ex.renderTier)),
      md(ex.license),
      md(ex.author),
      sourceCell(ex),
    ].join(' | ')
  );

  return [
    '# POV-Ray Examples',
    '',
    'Generated from `web/examples.js`. Do not edit by hand; run `npm run gen:examples`.',
    '',
    '| Example | Category | Type | Level | Render Cost | License | Author | Source |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
  ].join('\n');
}

const next = await format(renderedDoc(), { parser: 'markdown' });
if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8');
  if (current !== next) {
    throw new Error('docs/examples.md is stale; run `npm run gen:examples`');
  }
  process.stdout.write('docs/examples.md is current\n');
} else {
  writeFileSync(outPath, next);
  process.stdout.write('wrote docs/examples.md\n');
}
