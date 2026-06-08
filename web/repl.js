// povrayer REPL: each submitted SDL entry appends to an accumulating scene
// and auto-renders; failed entries roll back automatically. ':' commands
// inspect or mutate the scene and render settings. See :help.
import { renderScene, isAbortError, formatError, parseStats } from './render-client.js';
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
const progressEl = document.getElementById('repl-progress');
const cancelBtn = document.getElementById('cancel-render');

// --- state -----------------------------------------------------------------

const DEFAULT_SETTINGS = Object.freeze({
  width: 320,
  height: 240,
  quality: undefined,
  antialias: false,
  threads: undefined,
  args: undefined, // raw POV-Ray switches as one string, e.g. '+UA +AM2'
});

const STORAGE_KEY = 'povrayer.repl.v1';

// rgb literal, not a named color: the assembled scene scaffold never injects
// `#include "colors.inc"`, so `color Red` would fail with an undeclared
// identifier. The suggested first-contact snippet has to render as-is.
const TRY_LINE = 'sphere { <0,1,0>, 1 pigment { color rgb <1,0,0> } }';
const GREETING =
  `type POV-Ray scene code, get an image · try: ${TRY_LINE} · :example for scenes, :help for commands`;

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

let lastLog = ''; // raw unfiltered log of the last render (success or failure), for :log
let renderPct = -1; // last percent event of the in-flight render (-1 = none yet)
let statusStamp = 0; // last live-region text update, for the 1/s throttle
let hintTimer = null; // transient busy-hint restore timer

// --- persistence -------------------------------------------------------------

// Best-effort: private mode / quota failures must never break the REPL.
function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        entries: entries.map((e) => ({ source: e.source })),
        settings,
        history,
      })
    );
  } catch {
    /* persistence is optional */
  }
}

// Restores entries/settings/history from localStorage, validating every field
// against the same ranges the commands enforce (a hand-edited or stale blob
// must not smuggle in out-of-range render options). Returns the entry count.
function loadState() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 0;
  }
  if (!data || typeof data !== 'object') return 0;
  if (Array.isArray(data.entries)) {
    for (const e of data.entries) {
      if (typeof e?.source === 'string' && e.source.trim()) {
        entries.push({ id: nextId++, source: e.source });
      }
    }
  }
  const s = data.settings;
  if (s && typeof s === 'object') {
    if (Number.isInteger(s.width) && s.width >= 8 && s.width <= 2048) settings.width = s.width;
    if (Number.isInteger(s.height) && s.height >= 8 && s.height <= 2048) settings.height = s.height;
    if (Number.isInteger(s.quality) && s.quality >= 0 && s.quality <= 11) settings.quality = s.quality;
    if (s.antialias === true || (typeof s.antialias === 'number' && s.antialias > 0 && s.antialias <= 3)) {
      settings.antialias = s.antialias;
    }
    if (Number.isInteger(s.threads) && s.threads >= 1 && s.threads <= 32) settings.threads = s.threads;
    if (typeof s.args === 'string' && s.args.trim()) settings.args = s.args;
  }
  if (Array.isArray(data.history)) {
    history = data.history.filter((h) => typeof h === 'string').slice(-HISTORY_MAX);
    historyIndex = history.length;
  }
  return entries.length;
}

// --- scene assembly ----------------------------------------------------------

// Each scaffold line is injected only when its keyword test fails against the
// accumulated source (word-boundary regex; false positives in string literals
// are an accepted v1 tradeoff), so a user-supplied camera never collides with
// the default one (POV-Ray errors on duplicate cameras).
const SCAFFOLD = [
  [/\bglobal_settings\b/, 'global_settings { assumed_gamma 1.0 }'],
  [/\bcamera\b/, 'camera { location <0, 2, -5> look_at <0, 0.5, 0> }'],
  [/\blight_source\b/, 'light_source { <5, 10, -5> color rgb 1 }'],
  [/\bbackground\b/, 'background { color rgb <0.15, 0.15, 0.18> }'],
];

// #version is NOT scaffold-conditional: POV-Ray fatals when a scene's first
// #version appears after any other statement, so injected scaffold lines above
// an entry that declares its own #version would break it (every standalone
// example does). A leading #version makes any later in-entry #version a legal
// mid-scene version change, so the assembled scene ALWAYS starts with one.
const VERSION_LINE = '#version 3.8;';

// Comments must not satisfy a scaffold test: "// fix camera later" would
// otherwise suppress the camera scaffold and silently render black from
// POV-Ray's fallback origin camera, so the keyword probes run against a
// comment-stripped copy.
function stripComments(sdl) {
  return sdl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

// Line spans of each entry within the last assembled scene (1-based,
// inclusive), so error line numbers can be mapped back to "entry N, line M".
let lastSpans = [];

function assembleScene() {
  const body = entries.map((e) => e.source).join('\n');
  const probe = stripComments(body);
  const injected = SCAFFOLD.filter(([re]) => !re.test(probe)).map(([, line]) => line);
  const preamble = [VERSION_LINE, ...injected];
  // Span math mirrors the string assembly below: preamble lines, one blank
  // separator, then the entries joined by single newlines.
  let line = preamble.length + 2;
  lastSpans = entries.map((e) => {
    const n = e.source.split('\n').length;
    const span = { start: line, end: line + n - 1 };
    line += n;
    return span;
  });
  return preamble.join('\n') + '\n\n' + body;
}

function mapAssembledLine(n) {
  for (let i = 0; i < lastSpans.length; i++) {
    if (n >= lastSpans[i].start && n <= lastSpans[i].end) {
      return { entry: i + 1, line: n - lastSpans[i].start + 1 };
    }
  }
  return null; // scaffold or out of range
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
  prompt.setAttribute('aria-hidden', 'true');
  prompt.textContent = 'pov>';
  const pre = document.createElement('pre');
  pre.className = 'src';
  pre.textContent = text;
  div.append(prompt, pre);
  appendNode(div);
  return div;
}

function makeBlock(cls, text) {
  const pre = document.createElement('pre');
  pre.className = cls;
  pre.textContent = text;
  if (cls === 'error') pre.setAttribute('role', 'alert');
  return pre;
}

function appendBlock(cls, text) {
  appendNode(makeBlock(cls, text));
}

// Failure/cancel replaces the pending figure with an error/info block in
// place, so the busy signal and its outcome occupy the same spot.
function replaceWithBlock(fig, cls, text) {
  fig.replaceWith(makeBlock(cls, text));
  scrollback.scrollTop = scrollback.scrollHeight;
}

// Pending placeholder (3.2): the layout shift happens at submit time, sized
// from the current settings; .pending styles supply the dashed border and the
// busy-pulse on the caption.
function appendPending(w, h) {
  const fig = document.createElement('figure');
  fig.className = 'result pending';
  const box = document.createElement('div');
  box.style.width = `${w}px`;
  box.style.maxWidth = '100%';
  box.style.aspectRatio = `${w} / ${h}`;
  const cap = document.createElement('figcaption');
  cap.textContent = 'rendering…';
  fig.append(box, cap);
  appendNode(fig);
  return fig;
}

function aaLabel() {
  if (settings.antialias === true) return '0.3';
  return String(settings.antialias);
}

// render-512x384-q9-a03.png, from the options actually used (5.14).
function downloadName(w, h) {
  let name = `render-${w}x${h}`;
  if (settings.quality !== undefined) name += `-q${settings.quality}`;
  if (settings.antialias !== false) name += `-a${aaLabel().replace('.', '')}`;
  return `${name}.png`;
}

// Swaps the finished image into the pending figure. Figcaption per 3.2:
// `render #3 · 320×240 · 0.8s · 554,341 rays [· 2 warnings]` + save png.
function completeResult(fig, blobUrl, w, h, elapsedMs, log) {
  renderCounter += 1;
  const img = document.createElement('img');
  img.className = 'preview';
  img.alt = `render #${renderCounter}, ${w}×${h}`;
  img.width = w;
  img.height = h;
  img.src = blobUrl;
  const cap = document.createElement('figcaption');
  const parts = [`render #${renderCounter}`, `${w}×${h}`, `${(elapsedMs / 1000).toFixed(1)}s`];
  let stats = null;
  if (log) {
    try {
      stats = parseStats(log);
    } catch {
      stats = null; // fall back to the short caption
    }
  }
  if (typeof stats?.rays === 'number' && stats.rays > 0) {
    parts.push(`${stats.rays.toLocaleString('en-US')} rays`);
  }
  if (typeof stats?.warnings === 'number' && stats.warnings > 0) {
    parts.push(`${stats.warnings} warning${stats.warnings === 1 ? '' : 's'}`);
  }
  cap.textContent = parts.join(' · ');
  const save = document.createElement('a');
  save.href = blobUrl;
  save.download = downloadName(w, h);
  save.textContent = 'save png';
  cap.append(' · ', save);
  fig.replaceChildren(img, cap);
  fig.classList.remove('pending');
  scrollback.scrollTop = scrollback.scrollHeight;
}

// Marks the echoed entry so the transcript never lies about scene state.
function markRolledBack(node) {
  node.classList.add('rolled-back');
  const tag = document.createElement('span');
  tag.textContent = '(rolled back)';
  node.append(tag);
}

// --- status footer -----------------------------------------------------------

// Prints only non-defaults (3.2): `idle · 320×240`, gaining `· q 9 · aa 0.3 ·
// threads 4 · args +UA` only when set. Busy: `rendering… · 320×240`, with a
// percent suffix only once a percent event has arrived (rare today; the TTY
// flushes percent lines at trace completion).
function updateStatus() {
  statusStamp = performance.now();
  const busy = abortCtl !== null;
  const head = busy ? (renderPct >= 0 ? `rendering… ${renderPct}%` : 'rendering…') : 'idle';
  const parts = [head, `${settings.width}×${settings.height}`];
  if (settings.quality !== undefined) parts.push(`q ${settings.quality}`);
  if (settings.antialias !== false) parts.push(`aa ${aaLabel()}`);
  if (settings.threads !== undefined) parts.push(`threads ${settings.threads}`);
  if (settings.args !== undefined) parts.push(`args ${settings.args}`);
  statusEl.textContent = parts.join(' · ');
  statusEl.dataset.state = busy ? 'busy' : 'idle';
}

// Transient footer hint (e.g. Enter while a render is in flight); restores
// the regular status line after a beat.
function flashHint(text) {
  statusEl.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hintTimer = null;
    updateStatus();
  }, 2000);
}

// --- progress bar ------------------------------------------------------------

// #repl-progress contract with styles.css: visible = indeterminate sweep;
// .determinate switches to width: calc(var(--pct) * 1%). Percent is clamped
// monotonic because render threads interleave their status lines.
function startProgress() {
  renderPct = -1;
  progressEl.classList.remove('determinate');
  progressEl.style.removeProperty('--pct');
  progressEl.hidden = false;
}

function stopProgress() {
  progressEl.hidden = true;
  progressEl.classList.remove('determinate');
  progressEl.style.removeProperty('--pct');
}

function handleRenderEvent(ev) {
  if (ev.kind !== 'progress' || typeof ev.percent !== 'number') return;
  if (ev.percent <= renderPct) return; // monotonic clamp
  renderPct = ev.percent;
  progressEl.classList.add('determinate');
  progressEl.style.setProperty('--pct', String(renderPct));
  // Live-region hygiene: the bar moves freely, the text at most once per second.
  if (performance.now() - statusStamp >= 1000) updateStatus();
}

// --- error presentation --------------------------------------------------------

// render-client's formatError is the single error voice; this layer only adds
// REPL context: the assembled-scene line number is mapped back through the
// entry spans (`line 8 (entry 3, line 2) · …`). The leading `exit N` and
// trailing `Render failed` trims are defensive no-ops once formatError drops
// them itself.
function describeError(err) {
  const formatted = formatError(err);
  let lines = formatted.split('\n');
  if (/^exit \d+$/.test(lines[0])) lines = lines.slice(1);
  while (lines.length && /^(Render failed\.?|\s*)$/.test(lines[lines.length - 1])) lines.pop();
  if (!lines.length) return formatted;
  return lines.join('\n').replace(/^line (\d+)\b/m, (full, num) => {
    const loc = mapAssembledLine(parseInt(num, 10));
    return loc ? `line ${num} (entry ${loc.entry}, line ${loc.line})` : full;
  });
}

// --- rendering ---------------------------------------------------------------

// Renders the assembled scene. `rollback` (if given) runs on any failure,
// including cancellation; it exists only for fresh SDL entries (echoNode is
// that entry's echo, entrySource its raw text for the no-brace tip). Renders
// triggered by :undo/:del/:edit/:render/:example pass no rollback: the user
// asked for that state explicitly, so a failure shows the error and keeps the
// state.
async function runRender({ rollback, echoNode, entrySource } = {}) {
  abortCtl = new AbortController();
  input.readOnly = true; // readOnly, not disabled: focus and caret survive
  cancelBtn.hidden = false;
  startProgress();
  updateStatus();
  const w = settings.width;
  const h = settings.height;
  const fig = appendPending(w, h);
  try {
    const opts = {
      width: w,
      height: h,
      antialias: settings.antialias,
      signal: abortCtl.signal,
      onEvent: handleRenderEvent,
    };
    if (settings.quality !== undefined) opts.quality = settings.quality;
    if (settings.threads !== undefined) opts.threads = settings.threads;
    if (settings.args !== undefined) opts.args = settings.args.split(/\s+/).filter(Boolean);
    const result = await renderScene(assembleScene(), opts);
    lastLog = typeof result.log === 'string' ? result.log : '';
    completeResult(fig, result.blobUrl, w, h, result.elapsedMs, lastLog);
  } catch (err) {
    if (typeof err?.log === 'string') lastLog = err.log; // PovrayError keeps the raw log
    const cancelled = isAbortError(err);
    if (rollback) {
      rollback();
      if (echoNode) markRolledBack(echoNode);
      if (cancelled) {
        replaceWithBlock(fig, 'info', 'render cancelled, entry rolled back');
      } else {
        let text = 'entry rolled back\n' + describeError(err);
        if (entrySource && !entrySource.includes('{')) {
          text += `\ntip: input is POV-Ray scene code, not English. try: ${TRY_LINE}`;
        }
        replaceWithBlock(fig, 'error', text);
      }
    } else {
      // describeError maps AbortError to 'render cancelled'.
      replaceWithBlock(fig, cancelled ? 'info' : 'error', describeError(err));
    }
  } finally {
    abortCtl = null;
    input.readOnly = false;
    cancelBtn.hidden = true;
    stopProgress();
    clearTimeout(hintTimer);
    hintTimer = null;
    updateStatus();
    saveState();
    input.focus();
  }
}

// --- commands ----------------------------------------------------------------

// One array drives the dispatcher's unknown-command suggestions, the :help
// text, and Tab completion.
const COMMANDS = [
  { name: 'help', usage: ':help', desc: 'this text' },
  { name: 'example', usage: ':example [name]', desc: 'list example scenes, or load one' },
  { name: 'list', usage: ':list', desc: 'numbered scene entries' },
  { name: 'source', usage: ':source', desc: 'assembled scene as POV-Ray parses it' },
  { name: 'edit', usage: ':edit N', desc: 'copy entry N into the input and remove it' },
  { name: 'undo', usage: ':undo', desc: 'remove the last entry' },
  { name: 'del', usage: ':del N', desc: 'remove entry N' },
  { name: 'render', usage: ':render', desc: 're-render the current scene' },
  { name: 'size', usage: ':size WxH', desc: 'render size (each 8..2048)' },
  { name: 'q', usage: ':q N', desc: 'quality 0..11 (default 9)' },
  { name: 'aa', usage: ':aa [threshold|off]', desc: 'antialias (no arg = 0.3)' },
  { name: 'threads', usage: ':threads N', desc: 'worker threads 1..32' },
  { name: 'args', usage: ':args [switches]', desc: 'raw POV-Ray switches (:args alone clears)' },
  { name: 'log', usage: ':log [full]', desc: "last render's stats and warnings, 'full' for the raw log" },
  { name: 'reset', usage: ':reset', desc: 'clear scene, settings, and saved state' },
];

// :help as structured DOM: aligned usage/description grid per section instead
// of a flowed text wall (the dl grid keeps descriptions in a single scannable
// column regardless of usage-string length).
const HELP_KEYS = [
  ['Enter / run', 'submit'],
  ['Shift+Enter', 'insert a newline'],
  ['Esc / cancel', 'stop a render (fresh entries roll back)'],
  ['ArrowUp / ArrowDown', 'recall input history'],
  ['Tab', 'complete :commands'],
  ['click an old entry', 'copy it back into the input'],
];

const HELP_NOTES = [
  'anything that is not a :command is POV-Ray scene code; each entry re-renders the whole scene.',
  'a fresh entry that fails or is cancelled rolls back automatically; :undo/:del/:edit/:render/:example keep their state on failure.',
  'the assembled scene always starts with #version 3.8; missing global_settings/camera/light_source/background are injected with defaults. error line numbers refer to the assembled scene (:source shows it).',
  'settings (:size/:q/:aa/:threads/:args) take effect on the next render.',
  'scene, settings, and history persist in this browser; :reset clears them.',
];

function buildHelpBlock() {
  const block = document.createElement('div');
  block.className = 'info help';

  const addHead = (text) => {
    const h = document.createElement('div');
    h.className = 'help-head';
    // Expose as a heading so screen-reader users can jump between the
    // commands/keys/notes sections by heading navigation.
    h.setAttribute('role', 'heading');
    h.setAttribute('aria-level', '3');
    h.textContent = text;
    block.appendChild(h);
  };
  const addGrid = (pairs) => {
    const dl = document.createElement('dl');
    dl.className = 'help-grid';
    for (const [term, desc] of pairs) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = desc;
      dl.append(dt, dd);
    }
    block.appendChild(dl);
  };

  addHead('commands');
  addGrid(COMMANDS.map((c) => [c.usage, c.desc]));
  addHead('keys');
  addGrid(HELP_KEYS);
  addHead('notes');
  for (const note of HELP_NOTES) {
    const p = document.createElement('p');
    p.className = 'help-note';
    p.textContent = note;
    block.appendChild(p);
  }
  return block;
}

function listEntries() {
  if (!entries.length) return 'scene empty';
  return entries
    .map((e, i) => {
      const lines = e.source.split('\n');
      return [`${i + 1}: ${lines[0]}`, ...lines.slice(1).map((l) => '   ' + l)].join('\n');
    })
    .join('\n');
}

function removeEntry(index1, verb = 'removed') {
  entries.splice(index1 - 1, 1);
  saveState();
  if (entries.length) {
    appendBlock('info', `${verb} entry ${index1}`);
    runRender();
  } else {
    appendBlock('info', `${verb} entry ${index1}\nscene empty`);
  }
}

function parseIntStrict(s) {
  return /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// Nearest match by unique prefix, else smallest edit distance (<= 2). Ties
// prefer a shared first letter, so :sz reaches :size past :q/:aa.
function suggestCommand(name) {
  const names = COMMANDS.map((c) => c.name);
  const prefixed = names.filter((n) => n.startsWith(name));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) return null; // ambiguous: no single suggestion
  let best = null;
  let bestDist = Infinity;
  for (const n of names) {
    const d = editDistance(name, n);
    if (d < bestDist || (d === bestDist && best?.[0] !== name[0] && n[0] === name[0])) {
      best = n;
      bestDist = d;
    }
  }
  return bestDist <= 2 ? best : null;
}

function dispatchCommand(text) {
  const m = /^:(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) {
    appendBlock('error', `unknown command ${text} (try :help)`);
    return;
  }
  const name = m[1].toLowerCase();
  const arg = (m[2] ?? '').trim();

  switch (name) {
    case 'help':
      appendNode(buildHelpBlock());
      break;

    case 'reset':
      entries.length = 0;
      Object.assign(settings, DEFAULT_SETTINGS);
      history = [];
      historyIndex = 0;
      draft = '';
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to clear */
      }
      appendBlock('info', 'scene, settings, and saved state cleared');
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

    // Same removal semantics as :del, but the source lands in the input for
    // editing first; resubmitting appends as a fresh entry with normal
    // rollback.
    case 'edit': {
      const n = parseIntStrict(arg);
      if (!Number.isInteger(n) || n < 1 || n > entries.length) {
        appendBlock('error', `usage: :edit N (1..${entries.length})`);
        break;
      }
      setInputValue(entries[n - 1].source.trimEnd());
      removeEntry(n, 'editing');
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
      appendBlock('info', `size -> ${w}×${h}`);
      updateStatus();
      saveState();
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
      saveState();
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
      saveState();
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
      saveState();
      break;
    }

    // Raw POV-Ray switches, whitespace-split into the wrapper's opts.args
    // pass-through (+UA, +AM2, +K0.5, ...). No arg clears.
    case 'args': {
      if (!arg) {
        settings.args = undefined;
        appendBlock('info', 'args cleared');
      } else {
        settings.args = arg;
        appendBlock('info', `args -> ${arg}`);
      }
      updateStatus();
      saveState();
      break;
    }

    // Distilled stats + warning lines from the last render; `:log full` is
    // the raw retained log (renderScene resolves it; PovrayError carries it
    // on failure).
    case 'log': {
      if (!lastLog) {
        appendBlock('info', 'no render yet');
        break;
      }
      if (arg.toLowerCase() === 'full') {
        appendBlock('info', lastLog.trimEnd());
        break;
      }
      let stats = null;
      try {
        stats = parseStats(lastLog);
      } catch {
        stats = null;
      }
      const parts = [];
      if (typeof stats?.parseSeconds === 'number') parts.push(`parse ${stats.parseSeconds}s`);
      if (typeof stats?.traceSeconds === 'number') parts.push(`trace ${stats.traceSeconds}s`);
      if (typeof stats?.rays === 'number' && stats.rays > 0) {
        parts.push(`${stats.rays.toLocaleString('en-US')} rays`);
      }
      if (typeof stats?.threads === 'number') parts.push(`${stats.threads} threads`);
      const warnCount = typeof stats?.warnings === 'number' ? stats.warnings : 0;
      parts.push(`${warnCount} warning${warnCount === 1 ? '' : 's'}`);
      // Match the error box's path rewrite: the user never wrote
      // '/work/scene.pov', so warning references read `File scene line N`.
      const warnLines = lastLog
        .split('\n')
        .filter((l) => /Warning:/.test(l))
        .map((l) => l.replaceAll("'/work/scene.pov'", 'scene'));
      appendBlock('info', [parts.join(' · '), ...warnLines].join('\n'));
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
      saveState();
      appendBlock('info', `loaded '${arg}' (${src.trimEnd().split('\n').length} lines) · :source to view`);
      runRender();
      break;
    }

    default: {
      const suggestion = suggestCommand(name);
      appendBlock(
        'error',
        suggestion
          ? `unknown command :${name} (did you mean :${suggestion}?)`
          : `unknown command :${name} (try :help)`
      );
    }
  }
}

// --- input handling ----------------------------------------------------------

function pushHistory(text) {
  history.push(text);
  if (history.length > HISTORY_MAX) history.shift();
  historyIndex = history.length;
  draft = '';
  saveState();
}

// rows = min(8, lines): the input grows with multi-line drafts and shrinks
// back when cleared.
function autoGrow() {
  input.rows = Math.min(8, Math.max(1, input.value.split('\n').length));
}

function setInputValue(value) {
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
  autoGrow();
}

function submitInput() {
  if (input.readOnly) {
    // Busy: input is rejected, not queued; say so instead of dying silently.
    flashHint('render in flight · Esc or cancel stops it');
    return;
  }
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
  autoGrow();
  pushHistory(raw);
  const echoNode = appendEcho(raw);
  if (text.startsWith(':')) {
    dispatchCommand(text);
    return;
  }
  entries.push({ id: nextId++, source: text });
  saveState();
  runRender({ rollback: () => entries.pop(), echoNode, entrySource: text });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitInput();
});

cancelBtn.addEventListener('click', () => abortCtl?.abort());

// Tap/click an echoed entry to copy it back into the input (the touch path to
// history). Skipped while the user is selecting text to copy.
scrollback.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const entry = e.target.closest('.entry');
  if (!entry || !scrollback.contains(entry)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  const src = entry.querySelector('pre.src')?.textContent;
  if (src) {
    setInputValue(src);
    input.focus();
  }
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

function commonPrefix(names) {
  let p = names[0];
  for (const n of names.slice(1)) {
    while (!n.startsWith(p)) p = p.slice(0, -1);
  }
  return p;
}

// Tab inside a leading ':' token completes the command (unique match gets a
// trailing space; multiple matches extend to the common prefix) instead of
// dropping focus to the next control. Returns true when Tab was consumed.
function completeCommand() {
  if (input.readOnly) return false;
  const m = /^:(\S*)/.exec(input.value);
  if (!m || input.selectionStart > m[0].length) return false;
  const partial = m[1].toLowerCase();
  const names = COMMANDS.map((c) => c.name).filter((n) => n.startsWith(partial));
  if (names.length) {
    const completion = names.length === 1 ? names[0] : commonPrefix(names);
    const rest = input.value.slice(m[0].length);
    const suffix = names.length === 1 && !rest ? ' ' : '';
    input.value = ':' + completion + suffix + rest;
    input.selectionStart = input.selectionEnd = 1 + completion.length + suffix.length;
    autoGrow();
  }
  return true;
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
    // Enter and Ctrl/Cmd+Enter submit; Shift+Enter inserts a newline.
    e.preventDefault();
    submitInput();
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (completeCommand()) e.preventDefault();
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

input.addEventListener('input', autoGrow);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && abortCtl) abortCtl.abort();
});

// --- boot ----------------------------------------------------------------------

const restoredCount = loadState();
appendBlock('info', GREETING);
if (restoredCount) {
  appendBlock(
    'info',
    `restored ${restoredCount} ${restoredCount === 1 ? 'entry' : 'entries'} · :render to re-render · :reset to clear`
  );
}
updateStatus();
