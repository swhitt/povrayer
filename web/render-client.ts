// Shared render layer for the UI page and the REPL. This is the only module
// that imports the wasm wrapper; page scripts render exclusively through it.
//
// `./index.js` is the dist/ wrapper. It does NOT live next to this file in the
// repo: the deployed Pages site (and the local dev server) assemble dist/ and
// web/ flat into one root, so the relative import only resolves in the
// served/assembled site, never from web/ on disk.

import { render, renderAnimation as wrapperRenderAnimation, PovrayError, warmup } from './index.js';
import type { RenderOptions, AnimationOptions } from './index.js';
// Type-only, so tsc emits no import for it and this module keeps its "the only
// thing I pull in is the wrapper" property. RenderStats is declared next to the
// formatter that consumes it (web/stats.ts) so the producer and the consumer
// cannot drift into two copies of the same shape.
import type { RenderStats } from './stats.js';

export { PovrayError };

let busy = false;

/**
 * The normalized events a page consumes instead of raw wrapper output lines.
 * See emitEvents for how one wrapper line becomes these.
 */
export type RenderEvent =
  { kind: 'progress'; percent: number; text: string } | { kind: 'line'; text: string };

/** renderAnimation adds a frame channel on top of the still-render events. */
export type AnimationEvent = RenderEvent | { kind: 'frame'; index: number; total: number };

/** Everything the wrapper takes, plus this layer's two additions. */
export interface RenderSceneOptions extends RenderOptions {
  /** Receives the normalized progress/line events described at emitEvents. */
  onEvent?: (event: RenderEvent) => void;
  /**
   * Keep the raw PNG bytes on the result. Defaults true for direct callers; app
   * surfaces set it false when they only need the blob URL.
   */
  keepBytes?: boolean;
}

export interface RenderSceneResult {
  bytes?: Uint8Array<ArrayBuffer>;
  blobUrl: string;
  elapsedMs: number;
  /** The raw, UNFILTERED output text (the config-noise filter is events-only). */
  log: string;
}

/** Everything the wrapper's animation entry takes, plus this layer's additions. */
export interface RenderAnimationOptions extends AnimationOptions {
  /** The same events as renderScene, plus one 'frame' per completed frame. */
  onEvent?: (event: AnimationEvent) => void;
  /**
   * Keep the raw per-frame PNG bytes on the result. Defaults true for direct
   * callers; app surfaces set it false because blobUrls/bitmaps are enough for
   * playback and export.
   */
  keepFrames?: boolean;
}

export interface RenderAnimationResult {
  /** The raw PNG bytes, one per frame, when keepFrames is on. */
  frames?: Uint8Array<ArrayBuffer>[];
  blobUrls: string[];
  bitmaps: ImageBitmap[];
  elapsedMs: number;
  log: string;
}

// Animation peak memory is substantially larger than the final PNG payload:
// while playback assets are prepared the page can hold the encoded PNG, a Blob,
// and a decoded RGBA ImageBitmap for every frame. Budget eight bytes per pixel
// (encoded+decoded, deliberately conservative) and reject before starting wasm
// when the requested sweep would exceed a tab-safe 256 MiB.
export const ANIMATION_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
const ANIMATION_BYTES_PER_PIXEL = 8;
const BITMAP_DECODE_CONCURRENCY = 2;

/** Estimated peak bytes while animation PNGs become playback assets. */
export function estimateAnimationMemoryBytes(
  width: number,
  height: number,
  frames: number
): number {
  return Math.ceil(Number(width) * Number(height) * Number(frames) * ANIMATION_BYTES_PER_PIXEL);
}

/**
 * Decode frame Blobs with a small fixed worker pool. A failure waits for the
 * already-started decodes, closes every successful bitmap, then rejects; no
 * partially-owned GPU resources escape to the caller.
 */
export async function decodeAnimationBitmaps(blobs: readonly Blob[]): Promise<ImageBitmap[]> {
  // Holes until every worker has filled its slots, and a failed decode leaves
  // one behind permanently, which is exactly why the cleanup pass below
  // optional-chains .close(). The type says so rather than pretending the array
  // is dense from the first line.
  const decoded: (ImageBitmap | undefined)[] = new Array(blobs.length);
  const errors: unknown[] = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.min(BITMAP_DECODE_CONCURRENCY, blobs.length) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= blobs.length) return;
        try {
          decoded[index] = await createImageBitmap(blobs[index]);
        } catch (err) {
          errors.push(err);
        }
      }
    }
  );
  await Promise.all(workers);
  if (errors.length > 0) {
    for (const bitmap of decoded) bitmap?.close();
    throw errors[0];
  }
  // Past the error check every slot is filled: the only way a slot stays empty
  // is a decode that threw, and that pushed onto `errors`.
  return decoded as ImageBitmap[];
}

/** True while a render is in flight. */
export function isBusy(): boolean {
  return busy;
}

// Without this the first render pays the whole startup bill at click time:
// fetch+parse of the wrapper's glue module, then fetch+compile of the ~4 MB
// povray.wasm. Pages call it once at boot: warmup() fills the wrapper's factory
// cache, and compileStreaming primes the HTTP cache (and Chromium's compiled-
// code cache) for the wasm every instantiation re-fetches. Fire-and-forget: it
// can never start a render, and failures stay silent here because the first
// real render reports them properly.
export function prewarm(): void {
  /* c8 ignore next -- rejecting needs a transient glue-module import failure that can't be provoked deterministically */
  warmup().catch(() => {});
  /* c8 ignore next -- rejecting needs a wasm fetch/MIME failure the test server can't produce */
  WebAssembly.compileStreaming(fetch(new URL('./povray.wasm', import.meta.url))).catch(() => {});
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
function emitEvents(line: string, onEvent: (event: RenderEvent) => void): void {
  const segments = line.split('\r');
  let progress: RenderEvent | null = null;
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
 * Everything except onEvent/keepBytes passes straight through to the wrapper.
 * onProgress keeps the old contract (every raw output line); onEvent receives
 * the normalized progress/line events described at emitEvents.
 *
 * `log` on the result is the raw, unfiltered output text: the config-noise
 * filter only applies to events, and the REPL's `:log full` needs the real
 * thing. The caller owns blobUrl and must revoke it when replacing the image.
 */
export async function renderScene(
  source: string,
  opts: RenderSceneOptions = {}
): Promise<RenderSceneResult> {
  if (busy) throw new Error('render already in progress');
  busy = true;
  const { onEvent, onProgress, keepBytes = true, ...rest } = opts;
  const rawLines: string[] = [];
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
    return {
      ...(keepBytes ? { bytes } : {}),
      blobUrl,
      elapsedMs,
      log: rawLines.join('\n'),
    };
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
 * The render options pass straight through to the wrapper. onProgress keeps the
 * raw-line contract; onEvent receives the same normalized progress/line events
 * as renderScene PLUS a frame channel: { kind: 'frame', index, total } fired
 * once per completed frame. onFrame(index, total) is forwarded too. Per-frame
 * percent resets each frame, so a consumer driving an overall bar computes
 * overall = (completedFrames + framePercent / 100) / total.
 *
 * `frames` on the result is the raw PNG bytes; `blobUrls`/`bitmaps` are
 * ready-to-play assets, one per frame, in frame order. `log` is the raw,
 * unfiltered output. THE CALLER OWNS the playback assets: revoke every blobUrl
 * (URL.revokeObjectURL) and close every bitmap (ImageBitmap.close) when done.
 *
 * `opts` is REQUIRED (renderScene's is not) because the frame count has no
 * sensible default: the memory estimate below is computed from it, so an omitted
 * options object used to sail past the budget check on a NaN comparison.
 */
export async function renderAnimation(
  source: string,
  opts: RenderAnimationOptions
): Promise<RenderAnimationResult> {
  if (busy) throw new Error('render already in progress');
  const {
    onEvent,
    onProgress,
    onFrame,
    frames,
    initialClock,
    finalClock,
    keepFrames = true,
    ...rest
  } = opts;

  // Match the wrapper's defaults without changing the options forwarded to it.
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  const estimatedBytes = estimateAnimationMemoryBytes(width, height, frames);
  if (estimatedBytes > ANIMATION_MEMORY_BUDGET_BYTES) {
    const need = Math.ceil(estimatedBytes / (1024 * 1024));
    const limit = Math.floor(ANIMATION_MEMORY_BUDGET_BYTES / (1024 * 1024));
    throw new Error(
      `animation needs about ${need} MiB of playback memory (safety limit ${limit} MiB); reduce the frame count or resolution`
    );
  }

  busy = true;
  const rawLines: string[] = [];
  try {
    const start = performance.now();
    let pngs = await wrapperRenderAnimation(source, {
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
    const frameBytes = keepFrames ? pngs : undefined;
    if (!keepFrames) pngs = [];
    const blobUrls: string[] = [];
    try {
      for (const blob of blobs) blobUrls.push(URL.createObjectURL(blob));
      const bitmaps = await decodeAnimationBitmaps(blobs);
      return {
        ...(frameBytes ? { frames: frameBytes } : {}),
        blobUrls,
        bitmaps,
        elapsedMs,
        log: rawLines.join('\n'),
      };
    } catch (err) {
      for (const u of blobUrls) URL.revokeObjectURL(u);
      throw err;
    }
  } finally {
    busy = false;
  }
}

/** True for an abort rejection (DOMException named 'AbortError'). */
export function isAbortError(err: unknown): boolean {
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
 */
export function parseStats(log: string): RenderStats {
  const trace = /Trace Time:[^(]*\(([\d.]+) seconds\)/.exec(log);
  const parse = /Parse Time:[^(]*\(([\d.]+) seconds\)/.exec(log);
  const rays = /^Rays:\s+(\d+)/m.exec(log);
  let threads: number | undefined;
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
export function errorHeadline(
  log: string,
  mapLine: (line: number) => string = (n) => `line ${n}`
): string | null {
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
 * @param err The thrown value (PovrayError, AbortError, or anything else).
 */
export function formatError(
  err: unknown,
  { mapLine }: { mapLine?: (line: number) => string } = {}
): string {
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
  // The tail case is deliberately "anything at all": a thrown non-Error still has
  // to produce a line for the error box. The cast is what lets `.message` be read
  // off an `unknown` while leaving the existing `??` to handle its absence; no
  // `?.` is added, because that would be a second branch the gate would owe a
  // test for, and a thrown null would have blown up here before too.
  return String((err as { message?: unknown }).message ?? err);
}
