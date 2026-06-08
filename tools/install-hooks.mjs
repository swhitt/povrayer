// Wires git to the committed hooks in .githooks/. Runs from npm's `prepare`
// lifecycle (fresh clone + `npm i`) and from `make hooks`. A no-op outside a
// git work tree (e.g. the Docker build's `npm ci`, or a tarball install), so
// it never fails an install where there is no .git to configure.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  // Not a git work tree (CI tarball, Docker layer): nothing to wire up.
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  process.stdout.write('git hooks wired to .githooks/ (pre-commit, pre-push)\n');
} catch (err) {
  // Don't fail the install just because hooks could not be configured.
  process.stderr.write(`install-hooks: could not set core.hooksPath (${err.message})\n`);
}
