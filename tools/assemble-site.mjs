// Assemble the deployable site into ./_site by overlaying the static web/ UI on
// top of the dist/ wasm artifact, flat. This mirrors the layout the app expects
// at runtime: web/render-client.js imports `./index.js` (the dist/ wrapper) as a
// sibling, so dist/ and web/ must land in the same directory. Vercel runs this
// as its buildCommand (outputDirectory = _site); GitHub Actions runs it too
// before `vercel build` for prebuilt deploys.
//
// The wasm in dist/ is produced by the Docker emscripten build (`make dist`),
// which Vercel's cloud builder can't run, so this script assumes dist/ already
// exists and fails loudly if it doesn't.
import { existsSync, rmSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const web = join(root, 'web');
const out = join(root, '_site');

if (!existsSync(join(dist, 'povray.wasm'))) {
  console.error(
    'assemble-site: dist/povray.wasm is missing. Build the wasm artifact first ' +
      '(`make dist`). Vercel cannot build it because it requires the Docker ' +
      'emscripten toolchain.'
  );
  process.exit(1);
}

// Fresh output every time so a removed source file never lingers in _site.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Build-time sources that must NOT ship: tools/gen-turbo.mjs inlines
// web/turbo-app.js into web/turbo.html, so deploying the module too would serve
// ~195KB of a second, byte-identical copy that nothing ever loads (and that would
// go stale the moment someone edited it without regenerating).
const BUILD_ONLY = new Set(['turbo-app.js']);

// web/ overlays dist/ (web wins on any name clash, though today there are none).
// povrayer turbo lives in web/ too (turbo.html + its self-contained PWA shell:
// manifest, icons, offline service worker), so it rides along here and is served
// at /turbo (cleanUrls strips the .html). No special-casing needed.
for (const dir of [dist, web]) {
  for (const entry of readdirSync(dir)) {
    if (dir === web && BUILD_ONLY.has(entry)) continue;
    cpSync(join(dir, entry), join(out, entry), { recursive: true });
  }
}

console.log(`assemble-site: wrote _site from dist/ + web/`);
