// CLI testability shim. src/cli.mjs does `import('./index.js')`, but the
// wrapper only exists at dist/index.js (the Docker runtime image puts them
// side by side; the repo does not). To test the CLI from its REAL path,
// src/cli.mjs, so V8 coverage attributes to src/cli.mjs (and the wrapper it
// loads attributes to dist/index.js, the file we already measure), we drop a
// gitignored symlink src/index.js -> ../dist/index.js next to the CLI.
//
// Node resolves the symlink's realpath, so the wrapper's own relative imports
// (./povray.mjs) still resolve inside dist/. Phase-2 CLI tests can then just
// `spawn(node, ['src/cli.mjs', ...])` and inherit NODE_V8_COVERAGE from c8.
//
// Runs from `pretest:node` (so `npm test` and `npm run test:node` both wire it)
// and is best-effort: never throw, never fail the suite.
import { existsSync, lstatSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const target = resolve(root, 'dist/index.js');
const link = resolve(root, 'src/index.js');

try {
  if (!existsSync(target)) {
    // No built wrapper yet (run `make dist`). CLI render tests can't run, but
    // arg-parsing tests still can; don't fail here.
    process.exit(0);
  }
  if (existsSync(link) || isSymlink(link)) rmSync(link, { force: true });
  symlinkSync('../dist/index.js', link); // relative, so it survives a moved repo
} catch (err) {
  process.stderr.write(`link-wrapper: skipped (${err.message})\n`);
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
