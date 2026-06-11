// Shared render layer for the UI page and the REPL. This is the only module
// that imports the wasm wrapper; page scripts render exclusively through it.
//
// `./index.js` is the dist/ wrapper. It does NOT live next to this file in the
// repo: the deployed Pages site (and the local dev server) assemble dist/ and
// web/ flat into one root, so the relative import only resolves in the
// served/assembled site, never from web/ on disk.

import { render, renderAnimation as wrapperRenderAnimation, PovrayError } from './index.js';

export { PovrayError };

let busy = false;

/** True while a render is in flight. */
export function isBusy() {
  return busy;
}

// --- output normalization ----------------------------------------------------
//
// POV-Ray's status writer emits percent updates as `\r`-terminated segments
// and the emscripten TTY flushes only on `\n`, so with the current dist the
// whole percent history of a trace arrives as ONE `\r`-joined wrapper line
// (with a trailing `\r`) only after tracing completes. The normalizer below
// splits each wrapper line on `\r` and coalesces the percent segments into a
// single `progress` event, so pages never see the raw burst; if a future dist
// flushes on `\r`, percent events simply start arriving live with no page
// changes.

const PROGRESS_SEGMENT = /^Rendered \d+ of \d+ pixels \((\d+)%\)/;

// Harmless config-probe chatter (system conf, user conf, INI) that makes
// every successful render look half-broken; dropped from `line` events but
// retained in the raw log. "povray: I/O restrictions are disabled" and the
// license/credit banner are deliberately kept.
const CONFIG_NOISE = /^povray: cannot open (the (system|user) configuration|an INI) file/;

/**
 * Splits one wrapper output line into structured page events:
 *
 *   { kind: 'progress', percent: 43, text: 'Rendered 84992 of 196608 pixels (43%)' }
 *   { kind: 'line', text: '==== [Rendering...] ...' }
 *
 * All percent segments in a line collapse into ONE progress event carrying
 * the LAST matching segment: segment percents are not monotonic (render
 * threads interleave), so consumers that drive a bar clamp on their side.
 */
function emitEvents(line, onEvent) {
  const segments = line.split('\r');
  let progress = null;
  for (const segment of segments) {
    const m = PROGRESS_SEGMENT.exec(segment);
    if (m) {
      progress = { kind: 'progress', percent: Number(m[1]), text: segment };
      continue;
    }
    // A trailing `\r` leaves an empty final segment; drop those artifacts but
    // keep genuinely blank lines (they separate the log's sections).
    if (segment === '' && segments.length > 1) continue;
    if (CONFIG_NOISE.test(segment)) continue;
    onEvent({ kind: 'line', text: segment });
  }
  if (progress) onEvent(progress);
}

/**
 * Wraps render(). Throws synchronously if a render is already in flight
 * (callers gate on isBusy(), this is the backstop).
 *
 * opts: { width, height, quality, antialias, threads, files, args,
 * onProgress, onEvent, signal }. Everything except onEvent passes straight
 * through to the wrapper. onProgress keeps the old contract (every raw
 * output line); onEvent receives the normalized progress/line events
 * described at emitEvents.
 *
 * Resolves { bytes: Uint8Array, blobUrl: string, elapsedMs: number, log }.
 * `log` is the raw, unfiltered output text: the config-noise filter only
 * applies to events, and the REPL's `:log full` needs the real thing. The
 * caller owns blobUrl and must revoke it when replacing the image.
 */
export async function renderScene(source, opts = {}) {
  if (busy) throw new Error('render already in progress');
  busy = true;
  const { onEvent, onProgress, ...rest } = opts;
  const rawLines = [];
  try {
    const start = performance.now();
    const bytes = await render(source, {
      ...rest,
      onProgress: (line) => {
        rawLines.push(line);
        onProgress?.(line);
        if (onEvent) emitEvents(line, onEvent);
      },
    });
    const elapsedMs = performance.now() - start;
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    return { bytes, blobUrl, elapsedMs, log: rawLines.join('\n') };
  } finally {
    busy = false;
  }
}

/**
 * Wraps the wrapper's renderAnimation() for the page. Like renderScene it is
 * the only animation entry point, shares the same `busy` singleton + backstop
 * (still and animated renders never overlap), and stays DOM-free: it produces
 * playback assets but mounts nothing.
 *
 * opts: { width, height, quality, antialias, threads, files, args, signal,
 * frames, initialClock, finalClock, onProgress, onEvent, onFrame }. The render
 * options pass straight through to the wrapper. onProgress keeps the raw-line
 * contract; onEvent receives the same normalized progress/line events as
 * renderScene PLUS a frame channel: { kind: 'frame', index, total } fired once
 * per completed frame. onFrame(index, total) is forwarded too. Per-frame
 * percent resets each frame, so a consumer driving an overall bar computes
 * overall = (completedFrames + framePercent / 100) / total.
 *
 * Resolves { frames: Uint8Array[], blobUrls: string[], bitmaps: ImageBitmap[],
 * elapsedMs, log }. `frames` is the raw PNG bytes; `blobUrls`/`bitmaps` are
 * ready-to-play assets, one per frame, in frame order. `log` is the raw,
 * unfiltered output. THE CALLER OWNS the playback assets: revoke every blobUrl
 * (URL.revokeObjectURL) and close every bitmap (ImageBitmap.close) when done.
 */
export async function renderAnimation(source, opts = {}) {
  if (busy) throw new Error('render already in progress');
  busy = true;
  const { onEvent, onProgress, onFrame, frames, initialClock, finalClock, ...rest } = opts;
  const rawLines = [];
  try {
    const start = performance.now();
    const pngs = await wrapperRenderAnimation(source, {
      ...rest,
      frames,
      initialClock,
      finalClock,
      onProgress: (line) => {
        rawLines.push(line);
        onProgress?.(line);
        if (onEvent) emitEvents(line, onEvent);
      },
      onFrame: (index, total) => {
        onEvent?.({ kind: 'frame', index, total });
        onFrame?.(index, total);
      },
    });
    const elapsedMs = performance.now() - start;
    const blobs = pngs.map((bytes) => new Blob([bytes], { type: 'image/png' }));
    const blobUrls = blobs.map((blob) => URL.createObjectURL(blob));
    const bitmapResults = await Promise.allSettled(
      blobs.map((blob) => Promise.resolve().then(() => createImageBitmap(blob)))
    );
    const bitmapFailure = bitmapResults.find((result) => result.status === 'rejected');
    if (bitmapFailure) {
      for (const u of blobUrls) URL.revokeObjectURL(u);
      for (const result of bitmapResults) {
        if (result.status === 'fulfilled') result.value.close();
      }
      throw bitmapFailure.reason;
    }
    const bitmaps = bitmapResults.map((result) => {
      if (result.status !== 'fulfilled') throw new Error('unreachable bitmap result');
      return result.value;
    });
    return { frames: pngs, blobUrls, bitmaps, elapsedMs, log: rawLines.join('\n') };
  } finally {
    busy = false;
  }
}

/** True for an abort rejection (DOMException named 'AbortError'). */
export function isAbortError(err) {
  return err instanceof DOMException && err.name === 'AbortError';
}

// --- stats distillation --------------------------------------------------------

/**
 * Distills the headline numbers from a full render log. All regexes verified
 * against the shipped dist's output format: "Trace Time: ... ( N seconds)",
 * "Rays:" anchored at column 0, and "using N thread(s)" printed once per
 * timed phase (parse, bounding, trace) so the LAST match is the trace-phase
 * thread count. Missing values come back undefined; `warnings` is always a
 * count (the "Warning Stream to console" banner has no colon and can never
 * inflate it).
 *
 * Returns { traceSeconds, parseSeconds, rays, threads, warnings }.
 */
export function parseStats(log) {
  const trace = /Trace Time:[^(]*\(([\d.]+) seconds\)/.exec(log);
  const parse = /Parse Time:[^(]*\(([\d.]+) seconds\)/.exec(log);
  const rays = /^Rays:\s+(\d+)/m.exec(log);
  let threads;
  for (const m of log.matchAll(/using (\d+) thread\(s\)/g)) threads = Number(m[1]);
  const warnings = (log.match(/Warning:/g) ?? []).length;
  return {
    traceSeconds: trace ? Number(trace[1]) : undefined,
    parseSeconds: parse ? Number(parse[1]) : undefined,
    rays: rays ? Number(rays[1]) : undefined,
    threads,
    warnings,
  };
}

// --- error presentation ----------------------------------------------------------

// First error-looking line in a failure log; POV-Ray prints the offending
// source excerpt and the `File '...' line N` reference at (or immediately
// before) it.
const ERROR_LINE = /parse error|^fatal|error:|worker sent an error/i;

// Option-summary banner noise that lands in the error window when parsing
// fails early: "  Warning Stream to console.......On " lines and the
// "==== [Parsing...] ====" section markers right before the first error.
const BANNER_NOISE = /Streams? to console\.+\s*O(n|ff)\s*$|^==== \[/;

const FILE_LINE = /File '[^']*' line (\d+):\s*(.*)/;

/**
 * Synthesized plain-language head line for a failed render log:
 *
 *   `line 6 · Possible Parse Error: Unmatched {`
 *
 * Returns null when the log carries no usable line reference (e.g. a render
 * thread crash). `mapLine` rewrites the line-reference text; the REPL feeds
 * its entry offsets in here to map assembled-scene lines back to entry
 * coordinates, producing heads like `line 8 (entry 3, line 2) · ...`.
 */
export function errorHeadline(log, mapLine = (n) => `line ${n}`) {
  const lines = log.split('\n');
  const i = lines.findIndex((l) => ERROR_LINE.test(l));
  if (i < 0) return null;
  // This build puts the reference on the error line itself ("File 'x' line
  // N: Parse Error: ..."); other POV formats print it on its own line just
  // before, so scan back a couple of lines.
  for (let j = i; j >= Math.max(0, i - 2); j--) {
    const m = FILE_LINE.exec(lines[j]);
    if (!m) continue;
    const message = (j === i && m[2].trim()) || lines[i].trim();
    return `${mapLine(Number(m[1]))} · ${message}`;
  }
  return null;
}

/**
 * Human-readable message for a failed render: one voice for the whole app.
 *
 * For PovrayError, leads with the synthesized errorHeadline (when a line
 * reference exists), then POV-Ray's own excerpt window: the 6 lines on each
 * side of the first error-looking line, minus banner noise and the bare
 * trailing "Render failed" marker. The staged-scene path is rewritten to
 * `scene` (the user never wrote '/work/scene.pov'), and no `exit N` line is
 * emitted: the status line and the log summary carry the exit code.
 *
 * opts.mapLine is forwarded to errorHeadline (the REPL's entry-offset hook).
 *
 * @param {*} err The thrown value (PovrayError, AbortError, or anything else).
 * @param {{ mapLine?: (line: number) => string }} [opts]
 */
export function formatError(err, { mapLine } = {}) {
  if (err instanceof PovrayError) {
    const lines = err.log.split('\n');
    const i = lines.findIndex((l) => ERROR_LINE.test(l));
    const head = errorHeadline(err.log, mapLine);
    const from = i >= 0 ? Math.max(0, i - 6) : Math.max(0, lines.length - 12);
    const excerpt = i >= 0 ? lines.slice(from, i + 6) : lines.slice(from);
    const relevant = excerpt.filter((l, k) => {
      // The synthesized headline already speaks the first error line in the
      // app's cleaner voice ("line N · Parse Error: …"); drop that exact line
      // from the excerpt so the box doesn't restate it as "File scene line N:
      // …" right below. Only drop it when a headline was actually derived.
      if (head !== null && from + k === i) return false;
      return !BANNER_NOISE.test(l) && l.trim() !== 'Render failed';
    });
    const text = (head ? head + '\n' : '') + relevant.join('\n');
    return text.replaceAll("'/work/scene.pov'", 'scene').trimEnd();
  }
  if (isAbortError(err)) return 'render cancelled';
  return String(err.message ?? err);
}
