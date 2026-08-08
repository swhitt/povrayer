// Compile web/'s TypeScript modules to the plain ESM everything else consumes.
//
// web/ is mid-migration: some modules are .ts, the rest are still JSDoc-typed
// .js. Nothing that loads them can read .ts, though. The browser can't, and
// neither can Node 20 (`--experimental-strip-types` does not exist there and a
// .ts import is ERR_UNKNOWN_FILE_EXTENSION), which the node-20-compat CI lane
// still gates on. So the .ts modules are compiled to _build/web/<name>.js under
// tsconfig.build.json and three consumers read that directory:
//
//   tools/assemble-site.mjs   overlays it into _site for the Vercel deploy
//   test/browser/serve.mjs    serves it ahead of web/ for the browser tests
//   test/node/*.test.mjs      import the compiled module for the converted ones
//
// INVARIANT: _build/web holds exactly one .js (plus its .d.ts) per web/**/*.ts
// and nothing else. tsc necessarily emits the .js modules it pulled in through
// `import` as well (there is no "emit only the files I listed" flag), so those are
// pruned back out here. Everything still written in JavaScript therefore ships
// from web/ byte-identical, which keeps the untouched 93KB examples.js off the
// inline-sourcemap tax and, more importantly, means there is never a second copy
// of a module for the overlay order to pick wrong.
//
// The .d.ts files are build-time only (see tsconfig.build.json for why they
// exist); tools/assemble-site.mjs ships only the .js.
//
// STALENESS: every consumer above calls buildWeb() itself rather than trusting
// that someone else remembered, and buildWeb() VERIFIES the output against the
// sources before deciding it has nothing to do. So there is no code path that
// serves or ships _build/web without having just confirmed it matches web/. A
// bare mtime *test* would have been the weaker choice: it reports staleness to
// whoever runs the suite and leaves `node test/browser/serve.mjs` free to serve
// last week's ui.js to a browser.
//
// The freshness check is not just an optimization, it is what makes the call
// SAFE TO REPEAT. An unconditional wipe-and-rebuild broke `npm run test:node`:
// node --test runs the files concurrently, test/node/serve.test.mjs starts the
// server (and so builds), and _build/web vanished out from under the sibling
// tests importing modules from it. Confirming instead of clobbering means the
// common case touches nothing at all.
//
// MIGRATION ORDER: this split puts a real constraint on what can convert next.
// A module may only become .ts once nothing that Node loads OUT OF web/ imports
// it, because the compiled copy lives in a different directory and the importer's
// `./foo.js` would no longer resolve. That is why web/{gif,apng,anim-export}.js
// are still JavaScript: web/player.js imports them and a Node test loads
// player.js from web/. Convert the importer in the same pass, or wait.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
export const WEB_SRC = join(repoRoot, 'web');
export const WEB_OUT = join(repoRoot, '_build', 'web');

// Anything that changes what tsc emits, beyond the sources themselves. The build
// config and the base config it extends both set emit-visible options, so editing
// either has to invalidate the output the same way editing a module does.
const CONFIG_INPUTS = ['tsconfig.build.json', 'tsconfig.checkjs.json'];

/** Every path under `dir`, recursively, relative to it. Files only. */
function walk(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** The TypeScript modules in web/, relative to web/ (e.g. `flags.ts`). */
export function tsSources() {
  return walk(WEB_SRC)
    .filter((rel) => rel.endsWith('.ts') && !rel.endsWith('.d.ts'))
    .sort();
}

/** `flags.ts` -> `flags.js`, the artifact the browser and the Node tests load. */
const modulePath = (rel) => rel.replace(/\.ts$/, '.js');

/** `flags.ts` -> `flags.d.ts`, the build-time declaration tsc resolves imports to. */
const declPath = (rel) => rel.replace(/\.ts$/, '.d.ts');

/** The full expected contents of _build/web for a given source list. */
function expectedOutputs(sources) {
  return new Set(sources.flatMap((rel) => [modulePath(rel), declPath(rel)]));
}

/**
 * True when _build/web is exactly what these sources should have produced and no
 * older than any of them. Orphans count as stale: a module renamed back to .js
 * leaves an output behind that serve.mjs would happily keep serving.
 */
function isFresh(sources, wanted) {
  const present = walk(WEB_OUT).sort();
  if (present.length !== wanted.size || present.some((rel) => !wanted.has(rel))) return false;

  const newestInput = Math.max(
    ...sources.map((rel) => statSync(join(WEB_SRC, rel)).mtimeMs),
    ...CONFIG_INPUTS.map((rel) => statSync(join(repoRoot, rel)).mtimeMs)
  );
  return present.every((rel) => statSync(join(WEB_OUT, rel)).mtimeMs >= newestInput);
}

/**
 * Bring _build/web in line with web/**\/*.ts, compiling only when it is not
 * already. Returns the runnable module paths relative to _build/web, sorted.
 * Throws if tsc reports a diagnostic, so a module that does not compile can never
 * reach the served output.
 */
export function buildWeb() {
  const sources = tsSources();
  const wanted = expectedOutputs(sources);

  // Nothing converted yet (or everything reverted): tsc would abort with "No
  // inputs were found in config file", which is not an error worth failing a
  // deploy over. An empty overlay dir is the correct answer.
  if (!sources.length) {
    rmSync(WEB_OUT, { recursive: true, force: true });
    mkdirSync(WEB_OUT, { recursive: true });
    return [];
  }

  if (isFresh(sources, wanted)) return sources.map(modulePath);

  rmSync(WEB_OUT, { recursive: true, force: true });
  mkdirSync(WEB_OUT, { recursive: true });

  // Invoke the compiler through its own bin script rather than `npx tsc` so the
  // pinned local typescript is the one that runs, with no network path and no
  // shell.
  const run = spawnSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (run.status !== 0) {
    throw new Error(`build-web: tsc -p tsconfig.build.json exited ${run.status ?? 'on a signal'}`);
  }

  // Prune to the invariant: drop every emitted file whose source is not a .ts
  // module. That is the pulled-in .js closure tsc had to compile in order to
  // type-check the modules we actually asked for.
  for (const rel of walk(WEB_OUT)) {
    if (!wanted.has(rel)) rmSync(join(WEB_OUT, rel), { force: true });
  }

  const present = new Set(walk(WEB_OUT));
  const missing = [...wanted].filter((rel) => !present.has(rel)).sort();
  if (missing.length) {
    throw new Error(`build-web: tsc emitted nothing for ${missing.join(', ')}`);
  }
  // Only the runnable modules are reported: the .d.ts files exist for tsc alone
  // and are never served or shipped.
  return sources.map(modulePath);
}

/* c8 ignore start -- CLI entrypoint guard: only runs via `node tools/build-web.mjs`, never when imported */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const emitted = buildWeb();
  const where = relative(repoRoot, WEB_OUT);
  console.log(
    emitted.length
      ? `build-web: ${emitted.length} module(s) current in ${where}/ (${emitted.join(', ')})`
      : `build-web: no web/**/*.ts yet, ${where}/ is empty`
  );
}
/* c8 ignore stop -- end CLI entrypoint guard */
