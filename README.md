# povrayer

POV-Ray 3.8 compiled to WebAssembly. One build that runs in Node and the
browser: pthreads for multithreaded rendering, the standard include library
embedded in the binary, PNG output. Distributed as a Docker image on GHCR,
with the raw wasm bundle extractable as a build artifact.

## Render with docker

Mounted form (local `.inc` files and textures next to the scene resolve):

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" ghcr.io/swhitt/povrayer scene.pov
```

The `--user` flag matters on Linux hosts: without it the container runs as
root and the output PNG lands root-owned in your directory.

Streaming form (no mount; scene on stdin, PNG on stdout, logs on stderr):

```sh
cat scene.pov | docker run --rm -i ghcr.io/swhitt/povrayer - -o - > out.png
```

Stdin mode can't resolve local includes (there's no scene directory to
stage), so scenes that need them should use the mounted form. The standard
include library (`colors.inc`, `textures.inc`, ...) works in both modes.

Common options: `-w N` / `-h N` (size), `-o FILE` (output, `-` for stdout),
`-q N` (quality 0..11), `-a [T]` (antialias, optional threshold), `--threads N`,
and `--` to pass raw POV-Ray switches through verbatim. `--help` has the full
list.

If the GHCR image isn't pullable (package not public yet, or you're on a
fork), build it locally with `make image` (or `docker buildx build --target
runtime -t povrayer .`) and use `povrayer` in place of
`ghcr.io/swhitt/povrayer` above.

## Get the wasm bundle

The artifact stage exports the whole bundle:

```sh
docker buildx build --target artifact --output type=local,dest=dist .
```

`dist/` then contains `povray.mjs`, `povray.wasm`, `index.js`, `index.d.ts`,
and `package.json`. No `.data` sidecar and no separate worker file: the
include library is embedded in the wasm.

## Wrapper API

`render()` is the only public API. It takes POV-Ray SDL source and resolves
to the PNG bytes as a fresh `Uint8Array` (never a view into wasm memory):

```js
import { render } from './dist/index.js';

const png = await render(source, {
  width: 800,
  height: 600,
  antialias: 0.3,
  files: { 'shapes.inc': myInclude },        // extra inputs, staged next to the scene
  onProgress: (line) => console.error(line), // POV-Ray's log, line by line
});
```

On failure it rejects with `PovrayError`, which carries the `exitCode` and
the full captured log on `.log`. An `AbortSignal` via `signal` cancels a
running render; `args` passes raw POV-Ray switches through.

### Node

Works as-is from `dist/` (Node 20+). Each `render()` call gets a fresh
module instance, and the runtime exits when the render does, so processes
don't hang on leaked worker threads.

### Browser

Same import:

```html
<script type="module">
  import { render } from '/dist/index.js';
  if (!crossOriginIsolated) throw new Error('serve with COOP/COEP headers');
  const png = await render(source, { width: 320, height: 240 });
  imgEl.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
</script>
```

Two hard requirements:

1. **Cross-origin isolation.** Threads need `SharedArrayBuffer`, so the page
   must be served with `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp`. Check
   `crossOriginIsolated === true` before calling `render()`; if it's false,
   the headers are missing and the wasm won't start.

2. **Don't bundle `povray.mjs`.** Serve `povray.mjs` and `povray.wasm` as
   plain static assets, side by side, names unchanged. The pthread workers
   re-import the module via `new URL(import.meta.url)` and ignore
   `locateFile`, so bundling, renaming, or inlining it breaks worker spawn.
   Mark it external in your bundler and copy both files through untouched.
   (`index.js` itself is safe to bundle.)

## Try it in the browser

Live, no install: <https://swhitt.github.io/povrayer/> (scene editor) and
<https://swhitt.github.io/povrayer/repl.html> (an SDL REPL: each entry
appends to the scene and auto-renders; a failed entry rolls back).

REPL commands: `:help`, `:reset`, `:list`, `:undo`, `:del N`, `:size WxH`,
`:q N`, `:aa [threshold|off]`, `:threads N`, `:render`, `:example [name]`.

GitHub Pages can't send COOP/COEP headers, so the pages use a vendored
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) to get
cross-origin isolation; the first visit reloads once while the worker
installs.

Locally: `make web` builds `dist/` if needed and serves the same pages at
<http://localhost:8080/> with real COOP/COEP headers (no service worker
involved).

## Memory

The build declares a 4GB shared-memory maximum (it starts at 256MB and
grows; on Chrome and Firefox the max is mostly address-space reservation).
Safari and iOS can refuse to instantiate a growable shared memory with a
4GB max. If you need those targets, rebuild with a lower ceiling:

```sh
docker buildx build --build-arg WASM_MAX_MEMORY=2GB --target artifact --output type=local,dest=dist .
```

## License

The image and the wasm artifact embed POV-Ray 3.8, which is licensed
AGPL-3.0-or-later, so the artifact is too. This repository is the complete
corresponding source for that build: the Dockerfile plus the pinned POV-Ray
commit (`c3ce13e5bb51892d8f59c1148b5f905a01ef82f3`) reproduce the artifact
exactly. POV-Ray itself lives at <https://github.com/POV-Ray/povray>.
