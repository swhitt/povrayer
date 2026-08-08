// Shared animation-export primitives for the two players: the editor's animate
// mode (ui.js) and the REPL's :anim (repl.js). Both record a <canvas> to WebM via
// MediaRecorder over a captureStream, fall back to per-frame PNGs where WebM has
// no codec, and download through a synthetic anchor. Only the export engine is
// shared here, NOT the playback loop: the editor's rAF clock drives a scrubber +
// GIF/APNG encoders, the REPL's is leaner, so each keeps its own. Browser-only
// (MediaRecorder / canvas / DOM); covered by both players' Playwright export tests.

// WebM mimes in preference order; the first MediaRecorder-supported one wins.
const WEBM_MIMES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

// The best supported WebM mime, or null when MediaRecorder has no WebM codec
// (some Safari). A null result is the signal to fall back to per-frame PNGs.
export function pickWebmMime() {
  return WEBM_MIMES.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) ?? null;
}

// Download a URL as `name` via a synthetic anchor click. The anchor is attached to
// the document before the click (some browsers ignore a click on a detached node)
// and removed immediately after.
/** @param {string} href @param {string} name */
export function triggerDownload(href, name) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Download each frame blob URL as frame001.png, frame002.png, ... Used for the
// editor's explicit "png" export and as the WebM-less fallback in both players.
/** @param {string[]} urls */
export function downloadPngFrames(urls) {
  urls.forEach((url, i) => triggerDownload(url, `frame${String(i + 1).padStart(3, '0')}.png`));
}

// Record `canvas` to a WebM blob URL: start a MediaRecorder over its captureStream,
// run `playFrames` (which must draw each frame in real time so the recorder
// captures them), then stop and wrap the chunks. The caller owns frame timing, the
// mime (from pickWebmMime), the download, and revoking the returned URL.
/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} fps
 * @param {string} mime
 * @param {() => Promise<void>} playFrames
 * @returns {Promise<string>} an object URL for the recorded WebM
 */
export async function recordCanvasWebm(canvas, fps, mime, playFrames) {
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  /** @type {Blob[]} */
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.start();
  await playFrames();
  recorder.stop();
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: mime }));
}
