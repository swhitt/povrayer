// UI page controller: editor + controls -> render via render-client, output pane.
// Side-effect module, no exports. All rendering goes through ./render-client.js.
import { renderScene, isBusy, isAbortError, formatError, PovrayError } from './render-client.js';
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

for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.name;
  opt.textContent = `${ex.name} - ${ex.title}`;
  examplesSelect.appendChild(opt);
}
examplesSelect.value = 'checker-sphere';
editor.value = getExample('checker-sphere');

// Selecting an example replaces the editor content (no dirty-check in v1;
// the four sources are one select away).
examplesSelect.addEventListener('change', () => {
  const source = getExample(examplesSelect.value);
  if (source !== undefined) editor.value = source;
});

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

function appendLog(text) {
  log.textContent += text;
  log.scrollTop = log.scrollHeight;
}

let abortCtl = null;
let lastUrl = null;

async function startRender() {
  // Bail while busy or non-isolated (first-visit SW install window: the
  // banner is visible and the page will reload itself once installed).
  if (abortCtl || isBusy()) return;
  if (!crossOriginIsolated) {
    isoWarning.hidden = false;
    return;
  }

  const opts = collectOptions();
  log.textContent = '';
  errorBox.hidden = true;
  errorBox.textContent = '';
  status.classList.remove('error');
  status.textContent = 'rendering...';
  renderBtn.disabled = true;
  cancelBtn.disabled = false;
  abortCtl = new AbortController();

  try {
    const { blobUrl, elapsedMs } = await renderScene(editor.value, {
      ...opts,
      signal: abortCtl.signal,
      onProgress: (line) => appendLog(line + '\n'),
    });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = blobUrl;
    output.src = blobUrl;
    output.hidden = false;
    downloadBtn.href = blobUrl;
    downloadBtn.hidden = false;
    status.textContent =
      `done in ${(elapsedMs / 1000).toFixed(2)}s · ${opts.width}x${opts.height}`;
  } catch (err) {
    // Error and cancel both keep the previous image and download link.
    if (isAbortError(err)) {
      status.textContent = 'cancelled';
    } else {
      status.textContent =
        err instanceof PovrayError ? `error (exit ${err.exitCode})` : 'error';
      status.classList.add('error');
      // The full stream is already in #log via onProgress; show the trimmed,
      // readable version in its own red box instead of burying a duplicate
      // at the bottom of the log.
      errorBox.textContent = formatError(err);
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
    }
  } finally {
    abortCtl = null;
    renderBtn.disabled = false;
    cancelBtn.disabled = true;
  }
}

renderBtn.addEventListener('click', startRender);
cancelBtn.addEventListener('click', () => abortCtl?.abort());
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    startRender();
  }
});
