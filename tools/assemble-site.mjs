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

// web/ overlays dist/ (web wins on any name clash, though today there are none).
for (const dir of [dist, web]) {
  for (const entry of readdirSync(dir)) {
    cpSync(join(dir, entry), join(out, entry), { recursive: true });
  }
}

// povrayer turbo: the GPU real-time twin, served at /turbo (cleanUrls strips
// the .html). The page is self-contained; the PWA shell (manifest, icons,
// offline service worker) rides along as siblings.
for (const f of [
  'turbo.html',
  'turbo.webmanifest',
  'turbo-sw.js',
  'turbo-icon-192.png',
  'turbo-icon-512.png',
  'turbo-apple-icon.png',
]) {
  cpSync(join(root, 'experiments/sdf-toy', f), join(out, f));
}

console.log(`assemble-site: wrote _site from dist/ + web/ + turbo`);
