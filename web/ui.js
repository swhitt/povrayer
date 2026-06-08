// UI page controller: editor + controls -> render via render-client, output pane.
// Side-effect module, no exports. All rendering goes through ./render-client.js.
import {
  renderScene,
  renderAnimation,
  isBusy,
  isAbortError,
  formatError,
  parseStats,
  PovrayError,
} from './render-client.js';
import { EXAMPLES, getExample } from './examples.js';

const isoWarning = document.getElementById('iso-warning');
if (crossOriginIsolated) {
  sessionStorage.removeItem('coi-retry');
  /* c8 ignore start -- COI service-worker fallback: the test harness is always cross-origin isolated, and the SW controllerchange/reload race is non-deterministic */
} else {
  isoWarning.hidden = false;
  // coi-serviceworker first-visit race: on a fast load the SW can install,
  // activate, and claim() the page before the script's reload branches run,
  // leaving the page controlled but not isolated and never self-reloading.
  // A controlled page does get the injected headers on its next load, so
  // reload as soon as the SW takes (or already has) control; the
  // sessionStorage guard stops a loop when isolation fails for some other
  // reason.
  const coiRetry = () => {
    if (sessionStorage.getItem('coi-retry')) return;
    sessionStorage.setItem('coi-retry', '1');
    location.reload();
  };
  if (navigator.serviceWorker?.controller) coiRetry();
  else navigator.serviceWorker?.addEventListener('controllerchange', coiRetry);
}
/* c8 ignore stop -- closes the ignore block opened above */

const examplesSelect = document.getElementById('examples');
const editor = document.getElementById('editor');
const gutter = document.getElementById('gutter');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const qualitySelect = document.getElementById('quality');
const antialiasSelect = document.getElementById('antialias');
const threadsInput = document.getElementById('threads');
const renderBtn = document.getElementById('render-btn');
const cancelBtn = document.getElementById('cancel-btn');
const status = document.getElementById('status');
const errorBox = document.getElementById('error');
const output = document.getElementById('output');
const downloadBtn = document.getElementById('download-btn');
const log = document.getElementById('log');
const logDetails = document.getElementById('log-details');
const logSummary = document.getElementById('log-summary');
const progressBar = document.getElementById('progress');
const plateHint = document.querySelector('#output-plate .hint');
const zoomBtn = document.querySelector('#output-pane .zoom-toggle');

// Animate-mode controls + the inline frame player.
const modeStillBtn = document.getElementById('mode-still');
const modeAnimateBtn = document.getElementById('mode-animate');
const framesInput = document.getElementById('frames');
const fpsInput = document.getElementById('fps');
const playerCanvas = document.getElementById('player-canvas');
const playerControls = document.getElementById('player-controls');
const playBtn = document.getElementById('play-btn');
const scrubber = document.getElementById('scrubber');
const frameReadout = document.getElementById('frame-readout');
const fpsReadout = document.getElementById('fps-readout');
const loopBtn = document.getElementById('loop-btn');
const exportBtn = document.getElementById('export-btn');

const STORAGE_KEY = 'povrayer.ui.v1';
const STASH_KEY = 'povrayer.ui.stash';

// 'still' renders a single frame; 'animate' drives POV-Ray's clock loop and
// plays the frames back in #player-canvas. Restored from saved state below.
let mode = 'still';
// True once a still render has produced an image: lets a mode switch back to
// 'still' re-show that image instead of the empty-state hint.
let hasStillImage = false;

// ---- examples + persisted state ----

for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.name;
  opt.textContent = `${ex.name} - ${ex.title}`;
  examplesSelect.appendChild(opt);
}

/* c8 ignore next -- 'chrome-sky' is not in EXAMPLES, so the preferred-default arm is dead; the EXAMPLES[0] fallback is the live path */
const DEFAULT_EXAMPLE = getExample('chrome-sky') !== undefined ? 'chrome-sky' : EXAMPLES[0]?.name;

function hasOption(select, value) {
  return Array.from(select.options).some((o) => o.value === value);
}

function readSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        source: editor.value,
        width: widthInput.value,
        height: heightInput.value,
        quality: qualitySelect.value,
        antialias: antialiasSelect.value,
        threads: threadsInput.value,
        example: examplesSelect.value,
        mode,
        frames: framesInput.value,
        fps: fpsInput.value,
      })
    );
  } catch {
    // Storage blocked or full: persistence is best-effort.
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
}
window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  saveState();
});

// lastLoadedSource is the pristine text of the last loaded example; the
// dirty-guard on example switch compares against it.
let lastLoadedSource = '';

{
  const saved = readSavedState();
  const example =
    saved && typeof saved.example === 'string' && hasOption(examplesSelect, saved.example)
      ? saved.example
      : DEFAULT_EXAMPLE;
  examplesSelect.value = example;
  /* c8 ignore next -- example is always a real EXAMPLES entry (hasOption-validated or DEFAULT_EXAMPLE), so getExample never returns undefined here */
  lastLoadedSource = getExample(example) ?? '';
  editor.value = saved && typeof saved.source === 'string' ? saved.source : lastLoadedSource;
  if (saved) {
    if (typeof saved.width === 'string' && saved.width) widthInput.value = saved.width;
    if (typeof saved.height === 'string' && saved.height) heightInput.value = saved.height;
    if (typeof saved.quality === 'string' && hasOption(qualitySelect, saved.quality)) {
      qualitySelect.value = saved.quality;
    }
    if (typeof saved.antialias === 'string' && hasOption(antialiasSelect, saved.antialias)) {
      antialiasSelect.value = saved.antialias;
    }
    if (typeof saved.threads === 'string') threadsInput.value = saved.threads;
    if (saved.mode === 'still' || saved.mode === 'animate') mode = saved.mode;
    const savedFrames = parseInt(saved.frames, 10);
    if (Number.isInteger(savedFrames) && savedFrames >= 1 && savedFrames <= 240) {
      framesInput.value = String(savedFrames);
    }
    const savedFps = parseInt(saved.fps, 10);
    if (Number.isInteger(savedFps) && savedFps >= 1 && savedFps <= 60) {
      fpsInput.value = String(savedFps);
    }
  }
}

// Selecting an example replaces the editor content. Edits are guarded by a
// confirm(); the replaced text is stashed (one recovery copy).
let currentExample = examplesSelect.value;
examplesSelect.addEventListener('change', () => {
  const source = getExample(examplesSelect.value);
  if (source === undefined) {
    examplesSelect.value = currentExample;
    return;
  }
  if (editor.value !== lastLoadedSource) {
    if (!confirm('Replace your edited scene?')) {
      examplesSelect.value = currentExample;
      return;
    }
    try {
      localStorage.setItem(STASH_KEY, editor.value);
    } catch {
      // best-effort stash
    }
  }
  currentExample = examplesSelect.value;
  editor.value = source;
  lastLoadedSource = source;
  renderGutter();
  scheduleSave();
});

// ---- editor gutter (line numbers) ----
// Correct only because the textarea has wrap="off": one source line is one
// visual row, so number N always sits beside line N.

let gutterLines = 0;
function renderGutter() {
  const n = editor.value.split('\n').length;
  if (n !== gutterLines) {
    gutterLines = n;
    let text = '';
    for (let i = 1; i <= n; i++) text += i + '\n';
    gutter.textContent = text;
  }
  gutter.scrollTop = editor.scrollTop;
}
editor.addEventListener('scroll', () => {
  gutter.scrollTop = editor.scrollTop;
});
editor.addEventListener('input', () => {
  renderGutter();
  scheduleSave();
});
renderGutter();

// ---- editor Tab handling (Esc then Tab moves focus, per the title hint) ----
// setRangeText keeps the native undo stack intact.

function indentSelection() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (s === e || !value.slice(s, e).includes('\n')) {
    editor.setRangeText('  ', s, e, 'end');
    return;
  }
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const block = value.slice(lineStart, e);
  editor.setRangeText(block.replace(/^/gm, '  '), lineStart, e, 'select');
}

function outdentSelection() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const end = Math.max(e, lineStart);
  const block = value.slice(lineStart, end);
  const out = block.replace(/^ {1,2}/gm, '');
  if (out === block) return;
  editor.setRangeText(out, lineStart, end, block.includes('\n') ? 'select' : 'preserve');
}

let escapePrimed = false;
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Primes the keyboard-trap escape hatch; also bubbles to the
    // document-level handler that aborts an in-flight render.
    escapePrimed = true;
    return;
  }
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (escapePrimed) {
      escapePrimed = false;
      return; // let the browser move focus
    }
    e.preventDefault();
    if (e.shiftKey) outdentSelection();
    else indentSelection();
    renderGutter();
    scheduleSave();
    return;
  }
  if (e.key !== 'Shift') escapePrimed = false;
});
editor.addEventListener('blur', () => {
  escapePrimed = false;
});

// ---- controls ----

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Read the controls into render options, writing clamped dims back into the
// inputs so the UI always shows the values actually used.
function collectOptions() {
  let width = parseInt(widthInput.value, 10);
  if (Number.isNaN(width)) width = 512;
  width = clamp(width, 8, 2048);
  widthInput.value = String(width);

  let height = parseInt(heightInput.value, 10);
  if (Number.isNaN(height)) height = 384;
  height = clamp(height, 8, 2048);
  heightInput.value = String(height);

  const quality = qualitySelect.value === '' ? undefined : Number(qualitySelect.value);
  const antialias = antialiasSelect.value === 'off' ? false : Number(antialiasSelect.value);

  let threads;
  const threadsRaw = parseInt(threadsInput.value, 10);
  if (!Number.isNaN(threadsRaw)) threads = clamp(threadsRaw, 1, 32);

  return { width, height, quality, antialias, threads };
}

for (const el of [
  widthInput,
  heightInput,
  qualitySelect,
  antialiasSelect,
  threadsInput,
  framesInput,
  fpsInput,
]) {
  el.addEventListener('change', scheduleSave);
}

// fps is a playback control, not a render setting: changing it retunes the
// player live (no re-render needed). Only valid in-range values apply; an
// out-of-range or mid-typing value is left alone until render clamps it.
fpsInput.addEventListener('input', () => {
  const n = parseInt(fpsInput.value, 10);
  if (Number.isInteger(n) && n >= 1 && n <= 60) player.setFps(n);
});

// Empty-state plate: an aspect-ratio box matching the current w/h inputs.
function updateHintAspect() {
  const w = parseInt(widthInput.value, 10);
  const h = parseInt(heightInput.value, 10);
  if (w > 0 && h > 0) plateHint.style.aspectRatio = `${w} / ${h}`;
}
widthInput.addEventListener('input', updateHintAspect);
heightInput.addEventListener('input', updateHintAspect);
updateHintAspect();

// ---- status line (role=status live region) ----
// Busy-phase text updates are throttled to one per second (live-region
// hygiene); terminal states flush immediately and cancel any pending update.

let statusTimer = null;
let statusLastAt = 0;
let statusPending = null;

function setStatus(text, state) {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  statusPending = null;
  status.textContent = text;
  status.dataset.state = state;
  statusLastAt = performance.now();
}

function setBusyStatus(text) {
  status.dataset.state = 'busy';
  const now = performance.now();
  if (now - statusLastAt >= 1000) {
    status.textContent = text;
    statusLastAt = now;
    return;
  }
  statusPending = text;
  if (!statusTimer) {
    statusTimer = setTimeout(
      () => {
        statusTimer = null;
        if (statusPending !== null) {
          status.textContent = statusPending;
          statusPending = null;
          statusLastAt = performance.now();
        }
      },
      1000 - (now - statusLastAt)
    );
  }
}

// ---- progress bar ----
// Indeterminate sweep from render start. The bar only leaves the sweep once
// percent events are actually streaming: a single early percent (radiosity
// scenes flush one pretrace, 0% or 1%) would otherwise pin a frozen sliver for
// the whole trace, which reads as hung, worse than the honest sweep. So the
// first percent only primes; the second (and beyond) drives the determinate
// width. Percents from interleaved render threads regress, hence the monotonic
// clamp. With the current dist artifact percent arrives in one burst at trace
// completion, so most renders sweep the whole way and never go determinate.

let progressPct = -1; // last confirmed percent; -1 until streaming is confirmed
let progressPrimed = false; // a first percent event has arrived this render

function progressStart() {
  progressPct = -1;
  progressPrimed = false;
  progressBar.classList.add('indeterminate');
  progressBar.classList.remove('determinate');
  progressBar.style.removeProperty('--pct');
  progressBar.hidden = false;
}

function progressPercent(p) {
  if (!progressPrimed) {
    progressPrimed = true;
    return; // one lone percent never leaves the sweep; wait for a second
  }
  /* c8 ignore start -- the dist normally emits one progress burst per render, so a second percent (the determinate path) is not reliably reachable; ignored to keep the gate deterministic */
  if (!(p > progressPct)) return; // monotonic within a render
  progressPct = p;
  progressBar.classList.remove('indeterminate');
  progressBar.classList.add('determinate');
  progressBar.style.setProperty('--pct', String(p));
  /* c8 ignore stop -- closes the ignore block opened above */
}

function progressStop() {
  progressBar.hidden = true;
  progressBar.classList.remove('indeterminate', 'determinate');
  progressBar.style.removeProperty('--pct');
  progressPct = -1;
  progressPrimed = false;
}

// ---- log: committed lines plus one overwritable trailing progress line ----
// The trailing line emulates the terminal \r-overwrite: hundreds of percent
// segments collapse into a single visible line, zero information loss.

// Two text nodes: committed lines grow append-only (appendData preserves the
// reader's scroll position and text selection), and the trailing progress
// line is the only node whose data gets replaced. Autoscroll follows the
// tail only while the reader is already pinned at the bottom; scrolling up
// to read detaches it until they scroll back down.
const logCommittedNode = document.createTextNode('');
const logProgressNode = document.createTextNode('');
log.append(logCommittedNode, logProgressNode);
let logHasProgressLine = false;

function logPinned() {
  return log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
}

function refreshLogScroll(wasPinned) {
  if (wasPinned) log.scrollTop = log.scrollHeight;
  if (logDetails.hidden) logDetails.hidden = false;
}

function appendLogLine(text) {
  const pinned = logPinned();
  if (logHasProgressLine) {
    logCommittedNode.appendData(logProgressNode.data + '\n');
    logProgressNode.data = '';
    logHasProgressLine = false;
  }
  logCommittedNode.appendData(text + '\n');
  refreshLogScroll(pinned);
}

function setProgressLine(text) {
  const pinned = logPinned();
  logProgressNode.data = text;
  logHasProgressLine = true;
  refreshLogScroll(pinned);
}

function commitProgressLine() {
  /* c8 ignore start -- the shipped dist always emits render-statistics lines after the final progress event, so appendLogLine commits the pending progress line first; this standalone commit never sees one pending */
  if (logHasProgressLine) {
    const pinned = logPinned();
    logCommittedNode.appendData(logProgressNode.data + '\n');
    logProgressNode.data = '';
    logHasProgressLine = false;
    refreshLogScroll(pinned);
  }
  /* c8 ignore stop -- closes the ignore block opened above */
}

function resetLog() {
  logCommittedNode.data = '';
  logProgressNode.data = '';
  logHasProgressLine = false;
  logSummary.textContent = 'render log';
  // #log-details stays visible once shown (re-hiding would shift layout);
  // it unhides on the first line of the first render. Open/closed state is
  // never forced.
}

function logLineCount() {
  const text = log.textContent;
  return text ? text.replace(/\n+$/, '').split('\n').length : 0;
}

function summaryWithCount(prefix) {
  const n = logLineCount();
  return n ? `${prefix} (${n} lines)` : prefix;
}

// ---- image zoom (fit / 1:1) ----
// The meta-row button is the accessible path; clicking the image is the
// bonus pointer shortcut. .zoom-1x styling (max-width: none, pixelated,
// plate overflow) lives in styles.css.

let zoom1x = false;

function updateZoomLabel() {
  if (output.hidden || !output.naturalWidth) {
    zoomBtn.hidden = true;
    return;
  }
  zoomBtn.hidden = false;
  // aria-pressed exposes the toggle state (1:1 engaged) beyond the visible
  // label, which only some AT surfaces read aloud.
  zoomBtn.setAttribute('aria-pressed', String(zoom1x));
  if (zoom1x) {
    zoomBtn.textContent = '1:1';
  } else {
    const pct = Math.round((output.clientWidth / output.naturalWidth) * 100) || 100;
    zoomBtn.textContent = `fit (${pct}%)`;
  }
}

function toggleZoom() {
  zoom1x = !zoom1x;
  output.classList.toggle('zoom-1x', zoom1x);
  updateZoomLabel();
}

zoomBtn.addEventListener('click', toggleZoom);
output.addEventListener('click', () => {
  if (!output.hidden) toggleZoom();
});
output.addEventListener('load', () => requestAnimationFrame(updateZoomLabel));
window.addEventListener('resize', updateZoomLabel);

// ---- error -> editor line jump ----

function selectEditorLine(n) {
  const lines = editor.value.split('\n');
  if (!(n >= 1 && n <= lines.length)) return;
  let start = 0;
  for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  editor.setSelectionRange(start, start + lines[n - 1].length);
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 19;
  editor.scrollTop = Math.max(0, (n - 3) * lineHeight);
  gutter.scrollTop = editor.scrollTop;
}

// ---- render ----

function downloadName(opts) {
  let name = `render-${opts.width}x${opts.height}`;
  if (opts.quality !== undefined) name += `-q${opts.quality}`;
  if (opts.antialias !== false && opts.antialias !== undefined) {
    name += `-a${String(opts.antialias).replace('.', '')}`;
  }
  return `${name}.png`;
}

function sceneName() {
  return editor.value === lastLoadedSource ? examplesSelect.value : 'edited scene';
}

// done in 0.92s · 512×384 · trace 0.04s · 554,341 rays · 15 threads
// Falls back to the short form when the stats regexes miss.
function doneLine(elapsedMs, opts, rawLog) {
  const base = `done in ${(elapsedMs / 1000).toFixed(2)}s · ${opts.width}×${opts.height}`;
  let stats;
  try {
    stats = rawLog ? parseStats(rawLog) : null;
    /* c8 ignore next 3 -- parseStats never throws on a string log; the catch is defensive */
  } catch {
    return base;
  }
  /* c8 ignore next 3 -- the shipped dist always prints Trace Time/Rays/threads, so parseStats never returns partial; this fallback is defensive */
  if (!stats || stats.traceSeconds == null || stats.rays == null || stats.threads == null) {
    return base;
  }
  return (
    base +
    ` · trace ${Number(stats.traceSeconds).toFixed(2)}s` +
    ` · ${Number(stats.rays).toLocaleString('en-US')} rays` +
    ` · ${stats.threads} thread${stats.threads === 1 ? '' : 's'}`
  );
}

let abortCtl = null;
let lastUrl = null;
// True once any engine output has ever arrived this session: the first
// render's silence is wasm startup, later renders go straight to parsing.
let engineSeen = false;

async function startRender() {
  // Bail while busy or non-isolated (first-visit SW install window: the
  // banner is visible and the page will reload itself once installed).
  if (abortCtl || isBusy()) return;
  if (!crossOriginIsolated) {
    isoWarning.hidden = false;
    return;
  }

  // Animate mode drives a different engine entry point and playback target; it
  // owns the same abortCtl/cancel/progress/status plumbing so cancel and the
  // busy guards keep working across both paths.
  if (mode === 'animate') {
    runAnimateRender();
    return;
  }

  const opts = collectOptions();
  resetLog();
  errorBox.hidden = true;
  errorBox.textContent = '';
  output.classList.add('stale');
  downloadBtn.classList.add('stale');
  progressStart();
  setStatus(engineSeen ? 'rendering… parsing' : 'rendering… loading engine', 'busy');

  // Focus handoff: capture before disabling Render (disabling the focused
  // element would drop focus to <body>).
  const focusFromRender = document.activeElement === renderBtn;
  renderBtn.disabled = true;
  cancelBtn.hidden = false;
  if (focusFromRender) cancelBtn.focus();

  abortCtl = new AbortController();
  const ctl = abortCtl;
  let sawLine = engineSeen;
  let tracing = false;

  try {
    const {
      blobUrl,
      elapsedMs,
      log: rawLog,
    } = await renderScene(editor.value, {
      ...opts,
      signal: ctl.signal,
      onEvent: (ev) => {
        if (ctl.signal.aborted) return; // never overwrite 'cancelled'
        engineSeen = true;
        if (ev.kind === 'progress') {
          progressPercent(ev.percent);
          setProgressLine(ev.text);
          if (progressPct >= 0) setBusyStatus(`rendering… ${progressPct}%`);
        } else if (ev.kind === 'line') {
          if (!tracing && /^==== \[Rendering/.test(ev.text)) {
            tracing = true;
            // No trailing ellipsis: the busy-state ::after owns the animated
            // one, so "rendering…" here would render a double "rendering……".
            setBusyStatus('rendering');
          } else if (!tracing && !sawLine) {
            sawLine = true;
            setBusyStatus('rendering… parsing');
          }
          appendLogLine(ev.text);
        }
      },
    });
    commitProgressLine();

    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = blobUrl;
    output.src = blobUrl;
    output.hidden = false;
    playerCanvas.hidden = true;
    hasStillImage = true;
    output.alt = `render output, ${sceneName()}, ${opts.width}×${opts.height}`;
    output.classList.remove('stale');
    plateHint.hidden = true;
    downloadBtn.href = blobUrl;
    downloadBtn.download = downloadName(opts);
    downloadBtn.hidden = false;
    downloadBtn.classList.remove('stale');

    setStatus(doneLine(elapsedMs, opts, rawLog), 'done');
    logSummary.textContent = summaryWithCount('render log');
    if (!matchMedia('(min-width: 900px)').matches) {
      // Wait for the intrinsic size: block:'nearest' measures the box, and an
      // undecoded blob img is still 0px tall, which reads as "already in
      // view" and turns the scroll into a no-op.
      output
        .decode()
        .catch(() => {})
        .then(() => output.scrollIntoView({ block: 'nearest' }));
    }
  } catch (err) {
    commitProgressLine();
    // Error and cancel both keep the previous image and download link.
    if (isAbortError(err)) {
      // The kept image is the legitimate last result; don't leave it stale.
      output.classList.remove('stale');
      downloadBtn.classList.remove('stale');
      setStatus('cancelled', 'cancelled');
    } else {
      setStatus('error', 'error');
      const message = formatError(err);
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      const lineMatch = /^line (\d+)\b/.exec(message);
      if (lineMatch) selectEditorLine(Number(lineMatch[1]));
      logSummary.textContent =
        err instanceof PovrayError
          ? summaryWithCount(`render log · exit ${err.exitCode}`)
          : summaryWithCount('render log');
    }
  } finally {
    abortCtl = null;
    progressStop();
    renderBtn.disabled = false;
    // Return focus before hiding Cancel (hiding the focused element drops
    // focus to <body>).
    if (document.activeElement === cancelBtn) renderBtn.focus();
    cancelBtn.hidden = true;
  }
}

// ---- animate mode ----

// Read + clamp the animate-only controls, writing the clamped values back so
// the UI always reflects what was used (mirrors collectOptions).
function collectAnimOptions() {
  let frames = parseInt(framesInput.value, 10);
  if (Number.isNaN(frames)) frames = 24;
  frames = clamp(frames, 1, 240);
  framesInput.value = String(frames);

  let fps = parseInt(fpsInput.value, 10);
  if (Number.isNaN(fps)) fps = 12;
  fps = clamp(fps, 1, 60);
  fpsInput.value = String(fps);

  return { frames, fps };
}

// done in 1.84s · 256×192 · 12 frames
function animDoneLine(elapsedMs, opts, frameCount) {
  return `done in ${(elapsedMs / 1000).toFixed(2)}s · ${opts.width}×${opts.height} · ${frameCount} frames`;
}

// Drive the bar as a determinate fraction (used for per-frame progress in
// animate mode, where completed frames are the meaningful unit).
function progressDeterminate(pct) {
  progressBar.classList.remove('indeterminate');
  progressBar.classList.add('determinate');
  progressBar.style.setProperty('--pct', String(pct));
}

async function runAnimateRender() {
  const opts = collectOptions();
  const { frames, fps } = collectAnimOptions();
  resetLog();
  errorBox.hidden = true;
  errorBox.textContent = '';
  progressStart();
  setStatus(engineSeen ? 'rendering… parsing' : 'rendering… loading engine', 'busy');

  // Same focus handoff as the still path: capture before disabling Render.
  const focusFromRender = document.activeElement === renderBtn;
  renderBtn.disabled = true;
  cancelBtn.hidden = false;
  if (focusFromRender) cancelBtn.focus();

  abortCtl = new AbortController();
  const ctl = abortCtl;
  let sawLine = engineSeen;
  let tracing = false;

  try {
    const result = await renderAnimation(editor.value, {
      ...opts,
      frames,
      initialClock: 0,
      finalClock: 1,
      signal: ctl.signal,
      onEvent: (ev) => {
        if (ctl.signal.aborted) return; // never overwrite 'cancelled'
        engineSeen = true;
        if (ev.kind === 'frame') {
          // The frame counter is the headline progress signal: the bar steps
          // 1/N..N/N and the status reads "frame i/N".
          progressDeterminate(Math.round((ev.index / ev.total) * 100));
          setBusyStatus(`rendering… frame ${ev.index}/${ev.total}`);
        } else if (ev.kind === 'progress') {
          setProgressLine(ev.text);
        } else if (ev.kind === 'line') {
          if (!tracing && /^==== \[Rendering/.test(ev.text)) {
            tracing = true;
            setBusyStatus('rendering');
          } else if (!tracing && !sawLine) {
            sawLine = true;
            setBusyStatus('rendering… parsing');
          }
          appendLogLine(ev.text);
        }
      },
    });
    commitProgressLine();

    player.load(result, fps);
    refreshPlate();
    setStatus(animDoneLine(result.elapsedMs, opts, frames), 'done');
    logSummary.textContent = summaryWithCount('render log');
    if (!matchMedia('(min-width: 900px)').matches) {
      playerCanvas.scrollIntoView({ block: 'nearest' });
    }
  } catch (err) {
    commitProgressLine();
    if (isAbortError(err)) {
      setStatus('cancelled', 'cancelled');
    } else {
      setStatus('error', 'error');
      const message = formatError(err);
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      const lineMatch = /^line (\d+)\b/.exec(message);
      if (lineMatch) selectEditorLine(Number(lineMatch[1]));
      logSummary.textContent =
        err instanceof PovrayError
          ? summaryWithCount(`render log · exit ${err.exitCode}`)
          : summaryWithCount('render log');
    }
  } finally {
    abortCtl = null;
    progressStop();
    renderBtn.disabled = false;
    if (document.activeElement === cancelBtn) renderBtn.focus();
    cancelBtn.hidden = true;
  }
}

// ---- inline frame player ----
// Page-agnostic-ish playback over the bitmaps render-client hands back: a
// canvas, scrubber, play/pause, loop, fps, and WebM/PNG export. It owns the
// playback assets and frees them (revoke blobUrls, close bitmaps) on the next
// load().
function createPlayer() {
  const ctx = playerCanvas.getContext('2d');
  let bitmaps = [];
  let urls = [];
  let idx = 0;
  let fps = 12;
  let loop = true;
  let playing = false;
  let rafHandle = null;
  let lastAdvance = 0;

  function draw(i) {
    idx = i;
    ctx.drawImage(bitmaps[i], 0, 0);
    scrubber.value = String(i);
    frameReadout.textContent = `${i + 1} / ${bitmaps.length}`;
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
    if (now - lastAdvance >= 1000 / fps) {
      lastAdvance = now;
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
    fpsReadout.textContent = `${n} fps`;
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
  }

  function load(result, playbackFps) {
    destroy();
    bitmaps = result.bitmaps;
    urls = result.blobUrls;
    idx = 0;
    setFps(playbackFps);
    playerCanvas.width = bitmaps[0].width;
    playerCanvas.height = bitmaps[0].height;
    scrubber.max = String(bitmaps.length - 1);
    scrubber.value = '0';
    draw(0);
    playerControls.hidden = false;
    // Autoplay only when motion is welcome; otherwise wait for the play button.
    if (matchMedia('(prefers-reduced-motion: no-preference)').matches) play();
    else setPlayLabel();
  }

  function triggerDownload(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // No MediaRecorder/codec: fall back to saving the frames as sequential PNGs.
  function downloadFramesAsPng() {
    urls.forEach((url, i) => {
      triggerDownload(url, `frame${String(i + 1).padStart(3, '0')}.png`);
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

  function pickMime() {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? null;
  }

  async function exportVideo() {
    if (!bitmaps.length) return;
    const mime = pickMime();
    if (!mime) {
      downloadFramesAsPng();
      return;
    }
    pause();
    const stream = playerCanvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start();
    await playOnce();
    recorder.stop();
    await stopped;
    const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
    triggerDownload(url, 'animation.webm');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function hasFrames() {
    return bitmaps.length > 0;
  }

  return { load, toggle, play, pause, seek, setFps, setLoop, exportVideo, destroy, hasFrames };
}
const player = createPlayer();

// ---- mode toggle + plate routing ----

function setMode(next) {
  if (next === mode) return;
  if (abortCtl || isBusy()) return; // don't switch mid-render
  mode = next;
  applyMode();
  scheduleSave();
}

function applyMode() {
  document.body.dataset.mode = mode;
  modeStillBtn.setAttribute('aria-pressed', String(mode === 'still'));
  modeAnimateBtn.setAttribute('aria-pressed', String(mode === 'animate'));
  if (mode === 'still') player.pause();
  refreshPlate();
}

// Show the right thing in #output-plate for the current mode: the player
// canvas (animate, once frames exist), the still image (still, once rendered),
// or the empty-state hint.
function refreshPlate() {
  if (mode === 'animate') {
    output.hidden = true;
    const showPlayer = player.hasFrames();
    playerCanvas.hidden = !showPlayer;
    plateHint.hidden = showPlayer;
  } else {
    playerCanvas.hidden = true;
    output.hidden = !hasStillImage;
    plateHint.hidden = hasStillImage;
  }
  updateZoomLabel();
}

modeStillBtn.addEventListener('click', () => setMode('still'));
modeAnimateBtn.addEventListener('click', () => setMode('animate'));
playBtn.addEventListener('click', () => player.toggle());
scrubber.addEventListener('input', () => player.seek(Number(scrubber.value)));
loopBtn.addEventListener('click', () => {
  player.setLoop(loopBtn.getAttribute('aria-pressed') !== 'true');
});
exportBtn.addEventListener('click', () => player.exportVideo());

// Seed the player fps from the (restored) input and route the plate for the
// restored mode.
player.setFps(Number(fpsInput.value));
applyMode();

renderBtn.addEventListener('click', startRender);
cancelBtn.addEventListener('click', () => abortCtl?.abort());

// Document-level shortcuts: Ctrl/Cmd+Enter renders from anywhere (startRender
// guards on busy), Escape aborts an in-flight render.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    startRender();
  } else if (e.key === 'Escape') {
    abortCtl?.abort();
  }
});

// Plain Enter inside the number inputs renders too.
for (const el of [widthInput, heightInput, threadsInput, framesInput, fpsInput]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      startRender();
    }
  });
}
