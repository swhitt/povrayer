import { encodeGif } from './gif.js';
import { encodeApng } from './apng.js';
import {
  pickWebmMime,
  triggerDownload,
  downloadPngFrames,
  recordCanvasWebm,
} from './anim-export.js';

/** The playable assets one animation render hands back. */
export interface AnimationResult {
  bitmaps: ImageBitmap[];
  blobUrls: string[];
  frames?: Uint8Array[];
}

/** The page's player chrome, injected so this module queries no DOM of its own. */
export interface PlayerElements {
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  playButton: HTMLButtonElement;
  scrubber: HTMLInputElement;
  frameReadout: HTMLElement;
  loopButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  exportFormat: HTMLSelectElement;
}

/**
 * Page-agnostic playback over the bitmaps render-client hands back: a canvas,
 * scrubber, play/pause, loop, fps, and WebM/PNG/GIF/APNG export. It owns the
 * playback assets and frees them (revoke blobUrls, close bitmaps) on load().
 */
export function createPlayer(elements: PlayerElements) {
  const {
    canvas: playerCanvas,
    controls: playerControls,
    playButton: playBtn,
    scrubber,
    frameReadout,
    loopButton: loopBtn,
    exportButton: exportBtn,
    exportFormat,
  } = elements;
  const context = playerCanvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  // Re-bound into a separate const so the non-null result survives into `draw`
  // and `frameRgba`. Those are hoisted function DECLARATIONS, and TypeScript
  // drops a narrowing of a mutable-looking outer binding at a function boundary,
  // so the guard above would not reach them. A second runtime guard inside draw()
  // would be a branch no input can take (and one the 100% gate would then owe a
  // test for), which is exactly what this avoids.
  const ctx = context;

  let bitmaps: ImageBitmap[] = [];
  let urls: string[] = [];
  // A detached canvas reused to read RGBA back out of the bitmaps for the GIF
  // encoder (the visible playerCanvas stays untouched mid-playback).
  let exportCanvas: HTMLCanvasElement | null = null;
  let idx = 0;
  let fps = 12;
  let loop = true;
  let playing = false;
  let rafHandle: number | null = null;
  let lastAdvance = 0;

  // One merged readout ("7 / 24 · 12 fps"): frame position and playback rate
  // share the span (the status line's · convention) so the two values can't
  // run together as one garbled number string.
  function updateReadout() {
    frameReadout.textContent = `${bitmaps.length ? idx + 1 : 0} / ${bitmaps.length} · ${fps} fps`;
  }

  function draw(i: number) {
    idx = i;
    ctx.drawImage(bitmaps[i], 0, 0);
    scrubber.value = String(i);
    // aria-valuetext so a screen reader announces the 1-based "frame 2 of 3"
    // that matches the visible readout, not the raw 0-indexed slider value.
    scrubber.setAttribute('aria-valuetext', `frame ${i + 1} of ${bitmaps.length}`);
    updateReadout();
  }

  function setPlayLabel() {
    playBtn.textContent = playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(playing));
  }

  function pause() {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    playing = false;
    setPlayLabel();
  }

  function tick(now: number) {
    if (!playing) return;
    const interval = 1000 / fps;
    if (now - lastAdvance >= interval) {
      // Accumulate the interval instead of snapping lastAdvance to `now`:
      // snapping rounds every step up to the next rAF tick, which biased
      // playback slow (a 24fps target measured ~21.5fps) and made the preview
      // drift behind the exported WebM. After a long stall (backgrounded tab)
      // resync rather than replay the backlog as a burst.
      lastAdvance += interval;
      if (now - lastAdvance >= interval) lastAdvance = now;
      let next = idx + 1;
      if (next >= bitmaps.length) {
        if (!loop) {
          pause();
          return;
        }
        next = 0;
      }
      draw(next);
    }
    rafHandle = requestAnimationFrame(tick);
  }

  function play() {
    if (!bitmaps.length || playing) return;
    // Restart from the top when paused on the last frame of a non-looping clip.
    if (!loop && idx >= bitmaps.length - 1) draw(0);
    playing = true;
    setPlayLabel();
    lastAdvance = performance.now();
    rafHandle = requestAnimationFrame(tick);
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function seek(i: number) {
    if (!bitmaps.length) return;
    pause();
    // Bounded, not trusted: the index arrives either as the scrubber's value (a
    // DOM string this parses) or from a caller of the returned API.
    draw(Math.min(bitmaps.length - 1, Math.max(0, i)));
  }

  function setFps(n: number) {
    fps = n;
    updateReadout();
  }

  function setLoop(on: boolean) {
    loop = on;
    loopBtn.setAttribute('aria-pressed', String(on));
  }

  function releaseAssets(oldUrls: readonly string[], oldBitmaps: readonly ImageBitmap[]) {
    for (const u of oldUrls) URL.revokeObjectURL(u);
    for (const b of oldBitmaps) b.close();
  }

  function destroy() {
    pause();
    // Clear ownership before releasing resources so destroy stays idempotent even
    // if a host callback observes the player during URL revocation/bitmap close.
    const oldUrls = urls;
    const oldBitmaps = bitmaps;
    urls = [];
    bitmaps = [];
    releaseAssets(oldUrls, oldBitmaps);
    idx = 0;
    scrubber.max = '0';
    scrubber.value = '0';
    scrubber.setAttribute('aria-valuetext', 'no animation frames');
    playerControls.hidden = true;
    // Resetting canvas dimensions releases its backing store (which can be many
    // megapixels); do the same for the detached GIF readback canvas.
    playerCanvas.width = 0;
    playerCanvas.height = 0;
    playerCanvas.setAttribute('aria-label', 'animation playback');
    if (exportCanvas) {
      exportCanvas.width = 0;
      exportCanvas.height = 0;
      exportCanvas = null;
    }
    updateReadout();
  }

  function load(result: AnimationResult, playbackFps: number) {
    destroy();
    if (!result.bitmaps.length || result.bitmaps.length !== result.blobUrls.length) {
      releaseAssets(result.blobUrls, result.bitmaps);
      throw new Error('animation playback assets are incomplete');
    }
    bitmaps = result.bitmaps;
    urls = result.blobUrls;
    try {
      idx = 0;
      setFps(playbackFps);
      playerCanvas.width = bitmaps[0].width;
      playerCanvas.height = bitmaps[0].height;
      // Replace the static "animation playback" placeholder with the real shape
      // once frames load, mirroring the REPL inline player's labelling.
      playerCanvas.setAttribute(
        'aria-label',
        `animation, ${bitmaps[0].width}×${bitmaps[0].height}, ${bitmaps.length} frames`
      );
      scrubber.max = String(bitmaps.length - 1);
      scrubber.value = '0';
      draw(0);
      playerControls.hidden = false;
      // Autoplay only when motion is welcome; otherwise wait for the play button.
      if (matchMedia('(prefers-reduced-motion: no-preference)').matches) play();
      else setPlayLabel();
    } catch (err) {
      // Ownership transferred above; any setup failure must release it before
      // surfacing so the render result cannot strand GPU/blob resources.
      destroy();
      throw err;
    }
  }

  // Wrap encoder output bytes in a Blob and trigger a download, revoking the URL
  // after a grace window (the click navigates synchronously; the timeout frees it).
  function saveBytes(bytes: Uint8Array<ArrayBuffer>, mime: string, name: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    triggerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Read every frame's RGBA back out of the bitmaps via a detached canvas, for
  // the GIF encoder. Each getImageData call allocates a fresh buffer, so the
  // per-frame Uint8Array views never alias each other.
  function frameRgba(): { data: Uint8Array }[] {
    const w = bitmaps[0].width;
    const h = bitmaps[0].height;
    if (!exportCanvas) exportCanvas = document.createElement('canvas');
    exportCanvas.width = w;
    exportCanvas.height = h;
    const ectx = exportCanvas.getContext('2d', { willReadFrequently: true });
    if (!ectx) throw new Error('2D export canvas context unavailable');
    return bitmaps.map((bm) => {
      ectx.clearRect(0, 0, w, h);
      ectx.drawImage(bm, 0, 0);
      const { data } = ectx.getImageData(0, 0, w, h);
      return { data: new Uint8Array(data.buffer) };
    });
  }

  // Step through every frame once, holding each for one fps interval, so the
  // captureStream recorder sees real canvas updates over wall-clock time.
  function playOnce(): Promise<void> {
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (i >= bitmaps.length) {
          resolve();
          return;
        }
        draw(i);
        i += 1;
        setTimeout(step, 1000 / fps);
      };
      step();
    });
  }

  function canWebm() {
    return pickWebmMime() !== null;
  }

  // WebM via MediaRecorder over the player canvas: the one lossy/codec path (GIF +
  // APNG are deterministic client-side encodes). recordCanvasWebm runs playOnce in
  // real time so the recorder captures every frame, so it takes ~clip-length.
  async function exportWebm(mime: string) {
    const url = await recordCanvasWebm(playerCanvas, fps, mime, playOnce);
    triggerDownload(url, 'animation.webm');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Animated GIF: a single global palette (median-cut) over the frames' RGBA,
  // looping unless loop is off. The rAF yield lets the 'exporting…' label paint
  // before the synchronous encode blocks the main thread.
  async function exportGif() {
    await new Promise((r) => requestAnimationFrame(r));
    const bytes = encodeGif(frameRgba(), {
      width: bitmaps[0].width,
      height: bitmaps[0].height,
      delayCs: Math.max(1, Math.round(100 / fps)),
      numPlays: loop ? 0 : 1,
    });
    saveBytes(bytes, 'image/gif', 'animation.gif');
  }

  // Lossless animated PNG: repacks the source PNGs' compressed pixel data, so it
  // keeps full color + alpha. Carries a .png extension (APNG is a PNG superset).
  // Frame bytes are loaded from blob URLs only when exporting, so playback does
  // not retain raw PNG arrays in addition to decoded ImageBitmaps.
  async function exportApng() {
    await new Promise((r) => requestAnimationFrame(r));
    const frames = await Promise.all(
      urls.map(async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()))
    );
    const bytes = encodeApng(frames, {
      delayNum: Math.max(1, Math.round(1000 / fps)),
      delayDen: 1000,
      numPlays: loop ? 0 : 1,
    });
    saveBytes(bytes, 'image/apng', 'animation.png');
  }

  let exporting = false;

  // The export entry point: dispatch on the chosen format. PNG frames are
  // synchronous (no relabel needed); WebM with no codec degrades to PNG frames.
  // The heavy paths (webm/gif/apng) share one re-entrancy guard + 'exporting…'
  // relabel so a second click can't start a second encode over the same frames.
  // `string`, not a union of the four names: the value arrives straight off the
  // page's <select>, so pinning it here would only move a cast to the caller.
  async function exportAs(format: string) {
    if (!bitmaps.length || exporting) return;
    const webmMime = format === 'webm' ? pickWebmMime() : null;
    if (format === 'png' || (format === 'webm' && !webmMime)) {
      downloadPngFrames(urls);
      return;
    }
    exporting = true;
    const prevLabel = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'exporting…';
    pause();
    try {
      if (format === 'gif') await exportGif();
      else if (format === 'apng') await exportApng();
      else if (webmMime) await exportWebm(webmMime);
    } finally {
      exporting = false;
      exportBtn.disabled = false;
      exportBtn.textContent = prevLabel;
    }
  }

  function hasFrames() {
    return bitmaps.length > 0;
  }

  playBtn.addEventListener('click', toggle);
  scrubber.addEventListener('input', () => seek(Number(scrubber.value)));
  loopBtn.addEventListener('click', () => {
    setLoop(loopBtn.getAttribute('aria-pressed') !== 'true');
  });
  exportBtn.addEventListener('click', () => exportAs(exportFormat.value));
  // Drop the WebM option where MediaRecorder has no webm codec (e.g. some Safari):
  // GIF/APNG/PNG cover every browser deterministically, so a dead option would
  // just mislead. GIF stays the default (first option) regardless.
  /* c8 ignore next 3 -- Chromium (the only coverage browser) always has a webm codec, so this Safari-only option removal never runs under the gate */
  if (!canWebm()) {
    exportFormat.querySelector('option[value="webm"]')?.remove();
  }

  return {
    load,
    toggle,
    play,
    pause,
    seek,
    setFps,
    setLoop,
    exportAs,
    canWebm,
    destroy,
    hasFrames,
  };
}
