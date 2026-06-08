// povrayer REPL: each submitted SDL entry appends to an accumulating scene
// and auto-renders; failed entries roll back automatically. ':' commands
// inspect or mutate the scene and render settings. See :help.
import { renderScene, isAbortError, formatError } from './render-client.js';
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

const scrollback = document.getElementById('scrollback');
const form = document.getElementById('input-form');
const input = document.getElementById('input');
const statusEl = document.getElementById('repl-status');

// --- state -----------------------------------------------------------------

const DEFAULT_SETTINGS = Object.freeze({
  width: 320,
  height: 240,
  quality: undefined,
  antialias: false,
  threads: undefined,
});

const entries = []; // [{ id, source }], order = scene order; ids increase from 1
let history = []; // submitted raw inputs (commands included), newest last
const settings = { ...DEFAULT_SETTINGS };
let abortCtl = null; // AbortController for the in-flight render, else null

let nextId = 1;
let renderCounter = 0; // "render #N" per-session counter
const HISTORY_MAX = 100;
let historyIndex = 0; // === history.length means "not recalling"
let draft = ''; // unsubmitted input stashed while recalling history
const SCROLLBACK_CAP = 300;

// --- scene assembly ----------------------------------------------------------

// Each scaffold line is injected only when its keyword test fails against the
// accumulated source (word-boundary regex; false positives in string literals
// are an accepted v1 tradeoff), so a user-supplied camera never collides with
// the default one (POV-Ray errors on duplicate cameras).
const SCAFFOLD = [
  [/^\s*#version\b/m, '#version 3.8;'],
  [/\bglobal_settings\b/, 'global_settings { assumed_gamma 1.0 }'],
  [/\bcamera\b/, 'camera { location <0, 2, -5> look_at <0, 0.5, 0> }'],
  [/\blight_source\b/, 'light_source { <5, 10, -5> color rgb 1 }'],
  [/\bbackground\b/, 'background { color rgb <0.15, 0.15, 0.18> }'],
];

// Comments must not satisfy a scaffold test: "// fix camera later" would
// otherwise suppress the camera scaffold and silently render black from
// POV-Ray's fallback origin camera, so the keyword probes run against a
// comment-stripped copy.
function stripComments(sdl) {
  return sdl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

function assembleScene() {
  const body = entries.map((e) => e.source).join('\n');
  const probe = stripComments(body);
  const injected = SCAFFOLD.filter(([re]) => !re.test(probe)).map(([, line]) => line);
  return injected.length ? injected.join('\n') + '\n\n' + body : body;
}

// --- scrollback DOM ----------------------------------------------------------

function appendNode(node) {
  scrollback.appendChild(node);
  // Cap scrollback size; revoke blob URLs in evicted children so old renders
  // don't pin their PNGs in memory forever.
  while (scrollback.children.length > SCROLLBACK_CAP) {
    const oldest = scrollback.firstElementChild;
    for (const img of oldest.querySelectorAll('img.preview')) URL.revokeObjectURL(img.src);
    oldest.remove();
  }
  scrollback.scrollTop = scrollback.scrollHeight;
}

function appendEcho(text) {
  const div = document.createElement('div');
  div.className = 'entry';
  const prompt = document.createElement('span');
  prompt.className = 'prompt';
  prompt.textContent = 'pov>';
  const pre = document.createElement('pre');
  pre.className = 'src';
  pre.textContent = text;
  div.append(prompt, pre);
  appendNode(div);
}

function appendBlock(cls, text) {
  const pre = document.createElement('pre');
  pre.className = cls;
  pre.textContent = text;
  appendNode(pre);
}

function appendResult(blobUrl, w, h, elapsedMs) {
  renderCounter += 1;
  const fig = document.createElement('figure');
  fig.className = 'result';
  const img = document.createElement('img');
  img.className = 'preview';
  img.alt = `render ${renderCounter}`;
  img.width = w;
  img.height = h;
  img.src = blobUrl;
  const cap = document.createElement('figcaption');
  cap.textContent = `render #${renderCounter} · ${w}x${h} · ${(elapsedMs / 1000).toFixed(1)}s`;
  fig.append(img, cap);
  appendNode(fig);
}

// --- status footer -----------------------------------------------------------

function aaLabel() {
  if (settings.antialias === false) return 'off';
  if (settings.antialias === true) return '0.3';
  return String(settings.antialias);
}

function updateStatus() {
  const parts = [abortCtl ? 'rendering...' : 'idle', `${settings.width}x${settings.height}`];
  if (settings.quality !== undefined) parts.push(`q ${settings.quality}`);
  parts.push(`aa ${aaLabel()}`);
  if (settings.threads !== undefined) parts.push(`${settings.threads} threads`);
  statusEl.textContent = parts.join(' · ');
}

// --- rendering ---------------------------------------------------------------

// Renders the assembled scene. `rollback` (if given) runs on any failure,
// including cancellation; it exists only for fresh SDL entries. Renders
// triggered by :undo/:del/:render/:example pass no rollback: the user asked
// for that state explicitly, so a failure shows the error and keeps the state.
async function runRender(rollback) {
  abortCtl = new AbortController();
  input.disabled = true;
  updateStatus();
  const w = settings.width;
  const h = settings.height;
  try {
    const opts = { width: w, height: h, antialias: settings.antialias, signal: abortCtl.signal };
    if (settings.quality !== undefined) opts.quality = settings.quality;
    if (settings.threads !== undefined) opts.threads = settings.threads;
    const { blobUrl, elapsedMs } = await renderScene(assembleScene(), opts);
    appendResult(blobUrl, w, h, elapsedMs);
  } catch (err) {
    if (rollback) {
      rollback();
      if (isAbortError(err)) appendBlock('info', 'render cancelled, entry rolled back');
      else appendBlock('error', 'entry rolled back\n' + formatError(err));
    } else {
      // formatError maps AbortError to 'render cancelled'.
      appendBlock(isAbortError(err) ? 'info' : 'error', formatError(err));
    }
  } finally {
    abortCtl = null;
    input.disabled = false;
    updateStatus();
    input.focus();
  }
}

// --- commands ----------------------------------------------------------------

const HELP_TEXT = `commands:
  :help                this text
  :reset               clear scene, restore default settings
  :list                numbered scene entries
  :source              assembled scene as POV-Ray parses it (with line numbers)
  :undo                remove last entry, re-render
  :del N               remove entry N, re-render
  :size WxH            render size (each 8..2048)
  :q N                 quality 0..11
  :aa [threshold|off]  antialias (no arg = 0.3)
  :threads N           worker threads 1..32
  :render              re-render the current scene
  :example [name]      list examples / replace scene with one

settings (:size/:q/:aa/:threads) take effect on the next render.
anything else is SDL appended to the scene; each entry auto-renders.
Shift+Enter inserts a newline; ArrowUp/ArrowDown walk input history.
missing #version/global_settings/camera/light_source/background are
injected with defaults (a #version in a later entry parses after the
scaffold; POV-Ray warns but renders). error line numbers refer to the
assembled scene; :source shows it.
a fresh entry that fails (or is cancelled with Escape) rolls back
automatically; :undo/:del/:render/:example keep their state on failure.
while rendering, input is disabled and Escape cancels.`;

function listEntries() {
  if (!entries.length) return 'scene empty';
  return entries
    .map((e, i) => {
      const lines = e.source.split('\n');
      return [`${i + 1}: ${lines[0]}`, ...lines.slice(1).map((l) => '   ' + l)].join('\n');
    })
    .join('\n');
}

function removeEntry(index1) {
  entries.splice(index1 - 1, 1);
  if (entries.length) {
    appendBlock('info', `removed entry ${index1}`);
    runRender();
  } else {
    appendBlock('info', `removed entry ${index1}\nscene empty`);
  }
}

function parseIntStrict(s) {
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

function dispatchCommand(text) {
  const m = /^:(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) {
    appendBlock('error', `unknown command ${text} (try :help)`);
    return;
  }
  const name = m[1];
  const arg = (m[2] ?? '').trim();

  switch (name) {
    case 'help':
      appendBlock('info', HELP_TEXT);
      break;

    case 'reset':
      entries.length = 0;
      Object.assign(settings, DEFAULT_SETTINGS);
      appendBlock('info', 'scene and settings reset');
      updateStatus();
      break;

    case 'list':
      appendBlock('info', listEntries());
      break;

    // The scene POV-Ray actually parses (scaffold + entries), numbered so
    // "File '/work/scene.pov' line N" in errors maps to something visible.
    case 'source': {
      if (!entries.length) {
        appendBlock('info', 'scene empty');
        break;
      }
      const numbered = assembleScene()
        .split('\n')
        .map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)
        .join('\n');
      appendBlock('info', numbered);
      break;
    }

    case 'undo':
      if (!entries.length) appendBlock('error', 'nothing to undo');
      else removeEntry(entries.length);
      break;

    case 'del': {
      const n = parseIntStrict(arg);
      if (!Number.isInteger(n) || n < 1 || n > entries.length) {
        appendBlock('error', `usage: :del N (1..${entries.length})`);
        break;
      }
      removeEntry(n);
      break;
    }

    case 'size': {
      const sm = /^(\d+)\s*[x]\s*(\d+)$/i.exec(arg);
      const w = sm ? parseInt(sm[1], 10) : NaN;
      const h = sm ? parseInt(sm[2], 10) : NaN;
      if (!sm || w < 8 || w > 2048 || h < 8 || h > 2048) {
        appendBlock('error', 'usage: :size WxH (each 8..2048)');
        break;
      }
      settings.width = w;
      settings.height = h;
      appendBlock('info', `size -> ${w}x${h}`);
      updateStatus();
      break;
    }

    case 'q': {
      const n = parseIntStrict(arg);
      if (!Number.isInteger(n) || n < 0 || n > 11) {
        appendBlock('error', 'usage: :q N (0..11)');
        break;
      }
      settings.quality = n;
      appendBlock('info', `quality -> ${n}`);
      updateStatus();
      break;
    }

    case 'aa': {
      if (!arg) {
        settings.antialias = true;
        appendBlock('info', 'aa -> 0.3');
      } else if (arg.toLowerCase() === 'off') {
        settings.antialias = false;
        appendBlock('info', 'aa -> off');
      } else {
        const t = Number(arg);
        if (!Number.isFinite(t) || t <= 0 || t > 3) {
          appendBlock('error', 'usage: :aa [threshold|off]');
          break;
        }
        settings.antialias = t;
        appendBlock('info', `aa -> ${t}`);
      }
      updateStatus();
      break;
    }

    case 'threads': {
      const n = parseIntStrict(arg);
      if (!Number.isInteger(n) || n < 1 || n > 32) {
        appendBlock('error', 'usage: :threads N (1..32)');
        break;
      }
      settings.threads = n;
      appendBlock('info', `threads -> ${n}`);
      updateStatus();
      break;
    }

    case 'render':
      if (!entries.length) appendBlock('error', 'scene empty, add something first');
      else runRender();
      break;

    case 'example': {
      if (!arg) {
        appendBlock('info', EXAMPLES.map((e) => `${e.name} - ${e.title}`).join('\n'));
        break;
      }
      const src = getExample(arg);
      if (src === undefined) {
        appendBlock('error', `no example '${arg}' (try :example)`);
        break;
      }
      entries.length = 0;
      entries.push({ id: nextId++, source: src });
      runRender();
      break;
    }

    default:
      appendBlock('error', `unknown command :${name} (try :help)`);
  }
}

// --- input handling ----------------------------------------------------------

function pushHistory(text) {
  history.push(text);
  if (history.length > HISTORY_MAX) history.shift();
  historyIndex = history.length;
  draft = '';
}

function submitInput() {
  if (input.disabled) return; // busy: input is rejected, not queued
  const raw = input.value;
  const text = raw.trim();
  if (!text) return;
  if (!crossOriginIsolated) {
    // First-visit SW install window (or an embedding that strips headers):
    // bail with the banner visible rather than letting the render fail.
    isoWarning.hidden = false;
    return;
  }
  input.value = '';
  pushHistory(raw);
  appendEcho(raw);
  if (text.startsWith(':')) {
    dispatchCommand(text);
    return;
  }
  entries.push({ id: nextId++, source: text });
  runRender(() => entries.pop());
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitInput();
});

// History recall only triggers when the caret can't move further within the
// textarea in that direction (first line for up, last line for down), so
// arrow keys still navigate multi-line drafts normally.
function caretOnFirstLine() {
  return !input.value.slice(0, input.selectionStart).includes('\n');
}

function caretOnLastLine() {
  return !input.value.slice(input.selectionEnd).includes('\n');
}

function setInputValue(value) {
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
    // Enter and Ctrl/Cmd+Enter submit; Shift+Enter inserts a newline.
    e.preventDefault();
    submitInput();
    return;
  }
  if (e.key === 'ArrowUp' && caretOnFirstLine() && historyIndex > 0) {
    if (historyIndex === history.length) draft = input.value;
    historyIndex -= 1;
    setInputValue(history[historyIndex]);
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && caretOnLastLine() && historyIndex < history.length) {
    historyIndex += 1;
    setInputValue(historyIndex === history.length ? draft : history[historyIndex]);
    e.preventDefault();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && abortCtl) abortCtl.abort();
});

// --- boot ----------------------------------------------------------------------

appendBlock('info', 'povrayer repl: SDL in, renders out. :help for commands, :example for scenes.');
updateStatus();
