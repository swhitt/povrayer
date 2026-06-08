// Shared render layer for the UI page and the REPL. This is the only module
// that imports the wasm wrapper; page scripts render exclusively through it.
//
// `./index.js` is the dist/ wrapper. It does NOT live next to this file in the
// repo: the deployed Pages site (and the local dev server) assemble dist/ and
// web/ flat into one root, so the relative import only resolves in the
// served/assembled site, never from web/ on disk.

import { render, PovrayError } from './index.js';

export { PovrayError };

let busy = false;

/** True while a render is in flight. */
export function isBusy() {
  return busy;
}

/**
 * Wraps render(). Throws synchronously if a render is already in flight
 * (callers gate on isBusy(), this is the backstop).
 *
 * opts: { width, height, quality, antialias, threads, onProgress, signal },
 * passed straight through to the wrapper.
 *
 * Resolves { bytes: Uint8Array, blobUrl: string, elapsedMs: number }.
 * The caller owns blobUrl and must revoke it when replacing the image.
 */
export async function renderScene(source, opts = {}) {
  if (busy) throw new Error('render already in progress');
  busy = true;
  try {
    const start = performance.now();
    const bytes = await render(source, opts);
    const elapsedMs = performance.now() - start;
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    return { bytes, blobUrl, elapsedMs };
  } finally {
    busy = false;
  }
}

/** True for an abort rejection (DOMException named 'AbortError'). */
export function isAbortError(err) {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Human-readable message for a failed render.
 *
 * For PovrayError, trims the (often huge) log down to the relevant lines:
 * POV-Ray prints the offending source excerpt and `File '...' line N`
 * immediately BEFORE the `Parse Error:` line, hence the 6-line window on
 * each side of the first error-looking line.
 */
export function formatError(err) {
  if (err instanceof PovrayError) {
    const lines = err.log.split('\n');
    const i = lines.findIndex((l) => /parse error|^fatal|error:/i.test(l));
    const relevant =
      i >= 0 ? lines.slice(Math.max(0, i - 6), i + 6) : lines.slice(-12);
    return (`exit ${err.exitCode}\n` + relevant.join('\n')).trimEnd();
  }
  if (isAbortError(err)) return 'render cancelled';
  return String(err.message ?? err);
}
