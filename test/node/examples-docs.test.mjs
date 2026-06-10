import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('docs/examples.md is generated from EXAMPLES', () => {
  execFileSync('node', ['tools/examples-docs/generate.mjs', '--check'], { stdio: 'inherit' });
});
