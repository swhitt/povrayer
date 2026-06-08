// UI page controller: editor + controls -> render via render-client, output pane.
// Side-effect module, no exports. All rendering goes through ./render-client.js.
import {
  renderScene,
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

const STORAGE_KEY = 'povrayer.ui.v1';
const STASH_KEY = 'povrayer.ui.stash';

// ---- examples + persisted state ----

for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.name;
  opt.textContent = `${ex.name} - ${ex.title}`;
  examplesSelect.appendChild(opt);
}

const DEFAULT_EXAMPLE =
  getExample('chrome-sky') !== undefined ? 'chrome-sky' : EXAMPLES[0]?.name;

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
  lastLoadedSource = getExample(example) ?? '';
  editor.value =
    saved && typeof saved.source === 'string' ? saved.source : lastLoadedSource;
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

for (const el of [widthInput, heightInput, qualitySelect, antialiasSelect, threadsInput]) {
  el.addEventListener('change', scheduleSave);
}

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
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (statusPending !== null) {
        status.textContent = statusPending;
        statusPending = null;
        statusLastAt = performance.now();
      }
    }, 1000 - (now - statusLastAt));
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
  if (!(p > progressPct)) return; // monotonic within a render
  progressPct = p;
  progressBar.classList.remove('indeterminate');
  progressBar.classList.add('determinate');
  progressBar.style.setProperty('--pct', String(p));
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
  if (logHasProgressLine) {
    const pinned = logPinned();
    logCommittedNode.appendData(logProgressNode.data + '\n');
    logProgressNode.data = '';
    logHasProgressLine = false;
    refreshLogScroll(pinned);
  }
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
  let stats = null;
  try {
    stats = rawLog ? parseStats(rawLog) : null;
  } catch {
    return base;
  }
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
    const { blobUrl, elapsedMs, log: rawLog } = await renderScene(editor.value, {
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
for (const el of [widthInput, heightInput, threadsInput]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      startRender();
    }
  });
}
