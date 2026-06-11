import { encodeGif } from './gif.js';
import { encodeApng } from './apng.js';
import {
  pickWebmMime,
  triggerDownload,
  downloadPngFrames,
  recordCanvasWebm,
} from './anim-export.js';

/**
 * @typedef {object} AnimationResult
 * @property {ImageBitmap[]} bitmaps
 * @property {string[]} blobUrls
 * @property {Uint8Array[]} frames
 */

/**
 * @typedef {object} PlayerElements
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLElement} controls
 * @property {HTMLButtonElement} playButton
 * @property {HTMLInputElement} scrubber
 * @property {HTMLElement} frameReadout
 * @property {HTMLButtonElement} loopButton
 * @property {HTMLButtonElement} exportButton
 * @property {HTMLSelectElement} exportFormat
 */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Page-agnostic playback over the bitmaps render-client hands back: a canvas,
 * scrubber, play/pause, loop, fps, and WebM/PNG/GIF/APNG export. It owns the
 * playback assets and frees them (revoke blobUrls, close bitmaps) on load().
 *
 * @param {PlayerElements} elements
 */
export function createPlayer(elements) {
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
  const ctx = playerCanvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  /** @type {ImageBitmap[]} */
  let bitmaps = [];
  let urls = [];
  // The raw per-frame PNG bytes, kept for the lossless APNG export (which repacks
  // their already-compressed pixel data; no canvas round-trip, alpha preserved).
  /** @type {Uint8Array[]} */
  let pngFrames = [];
  // A detached canvas reused to read RGBA back out of the bitmaps for the GIF
  // encoder (the visible playerCanvas stays untouched mid-playback).
  /** @type {HTMLCanvasElement | null} */
  let exportCanvas = null;
  let idx = 0;
  let fps = 12;
  let loop = true;
  let playing = false;
  /** @type {number | null} */
  let rafHandle = null;
  let lastAdvance = 0;

  // One merged readout ("7 / 24 · 12 fps"): frame position and playback rate
  // share the span (the status line's · convention) so the two values can't
  // run together as one garbled number string.
  function updateReadout() {
    frameReadout.textContent = `${bitmaps.length ? idx + 1 : 0} / ${bitmaps.length} · ${fps} fps`;
  }

  function draw(i) {
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

  function tick(now) {
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

  function seek(i) {
    if (!bitmaps.length) return;
    pause();
    draw(clamp(i, 0, bitmaps.length - 1));
  }

  function setFps(n) {
    fps = n;
    updateReadout();
  }

  function setLoop(on) {
    loop = on;
    loopBtn.setAttribute('aria-pressed', String(on));
  }

  function destroy() {
    pause();
    for (const u of urls) URL.revokeObjectURL(u);
    for (const b of bitmaps) b.close();
    urls = [];
    bitmaps = [];
    pngFrames = [];
  }

  /** @param {AnimationResult} result @param {number} playbackFps */
  function load(result, playbackFps) {
    destroy();
    bitmaps = result.bitmaps;
    urls = result.blobUrls;
    pngFrames = result.frames;
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
  }

  // Wrap encoder output bytes in a Blob and trigger a download, revoking the URL
  // after a grace window (the click navigates synchronously; the timeout frees it).
  /** @param {Uint8Array} bytes @param {string} mime @param {string} name */
  function saveBytes(bytes, mime, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    triggerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Read every frame's RGBA back out of the bitmaps via a detached canvas, for
  // the GIF encoder. Each getImageData call allocates a fresh buffer, so the
  // per-frame Uint8Array views never alias each other.
  /** @returns {{ data: Uint8Array }[]} */
  function frameRgba() {
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
  function playOnce() {
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
  /** @param {string} mime */
  async function exportWebm(mime) {
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
  async function exportApng() {
    await new Promise((r) => requestAnimationFrame(r));
    const bytes = encodeApng(pngFrames, {
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
  /** @param {string} format gif | apng | webm | png */
  async function exportAs(format) {
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
