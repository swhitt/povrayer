// povrayer REPL: each submitted SDL entry appends to an accumulating scene
// and auto-renders; failed entries roll back automatically. ':' commands
// inspect or mutate the scene and render settings. See :help.
import {
  renderScene,
  renderAnimation,
  isAbortError,
  formatError,
  parseStats,
  prewarm,
} from './render-client.js';
import { EXAMPLES, getExample } from './examples.js';
import { highlight } from './highlight.js';
import { stripCommentsAndStrings } from './sdl-strip.js';
import { assembleReplScene } from './repl-scene.js';
import { encodeState } from './permalink.js';
import { buildPool, complete, applyCompletion, tokenAt } from './complete.js';
import {
  pickWebmMime,
  triggerDownload,
  downloadPngFrames,
  recordCanvasWebm,
} from './anim-export.js';
import { ensureCrossOriginIsolation } from './coi.js';

const isoWarning = document.getElementById('iso-warning');
ensureCrossOriginIsolation({ warningEl: isoWarning });

const scrollback = document.getElementById('scrollback');
const form = document.getElementById('input-form');
// `input` is the <textarea> in repl.html; the cast lets checkJs see .value /
// .readOnly / .selectionStart and flags misuse on the other (untyped) elements.
const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
const statusEl = document.getElementById('repl-status');
const progressEl = document.getElementById('repl-progress');
const cancelBtn = document.getElementById('cancel-render');
const sourceToggle = document.getElementById('source-toggle');
const sourcePanel = document.getElementById('repl-source');
const sourceCode = document.getElementById('source-code');
const sourceClose = document.getElementById('source-close');
const editorLink = document.getElementById('open-in-editor');

// --- state -----------------------------------------------------------------

/**
 * Mutable render/scene settings. Spelled out so checkJs widens past the frozen
 * defaults' literal types (`antialias` is really `boolean|number`, not `false`),
 * which is what lets `:size`, `:q`, and `:aa` reassign them.
 * @typedef {object} ReplSettings
 * @property {number} width
 * @property {number} height
 * @property {number} [quality]
 * @property {boolean|number} antialias
 * @property {number} [threads]
 * @property {string} [args] raw POV-Ray switches as one string, e.g. '+UA +AM2'
 */

const DEFAULT_SETTINGS = Object.freeze({
  width: 320,
  height: 240,
  quality: undefined,
  antialias: false,
  threads: undefined,
  args: undefined, // raw POV-Ray switches as one string, e.g. '+UA +AM2'
});

// Antialias threshold ceiling, mirroring the wasm wrapper exactly: its
// validateRenderOptions throws `RangeError: antialias must be false, true, or a
// finite threshold from 0 to 1` for anything outside 0..1 (measured against the
// shipped dist: +A0 and +A1 both render a PNG, +A2 throws). One constant because
// three places enforce it (the :aa guard, the persisted-settings validator, and
// the usage/help strings) and a value the REPL accepts but the wrapper rejects
// is unusually expensive: settings persist, so it fails every later render and
// survives reloads, leaving the REPL bricked with no hint but :reset.
const AA_MAX = 1;

const STORAGE_KEY = 'povrayer.repl.v1';

// rgb literal, not a named color: the assembled scene scaffold never injects
// `#include "colors.inc"`, so `color Red` would fail with an undeclared
// identifier. The suggested first-contact snippet has to render as-is.
const TRY_LINE = 'sphere { <0,1,0>, 1 pigment { color rgb <1,0,0> } }';

// Scene entries, in scene order. Positional by design: every consumer (scene
// assembly, :list, :del/:edit, the assembled-line -> entry mapping, the rollback
// pop) addresses an entry by its 1-based position, so entries deliberately carry
// no id. Adding one would advertise an identity that survives :del/:undo, and
// nothing here renumbers or tracks anything to back that up.
const entries = []; // [{ source }]
let history = []; // submitted raw inputs (commands included), newest last
/** @type {ReplSettings} */
const settings = { ...DEFAULT_SETTINGS };
let abortCtl = null; // AbortController for the in-flight render, else null

let renderCounter = 0; // "render #N" per-session counter
const HISTORY_MAX = 100;
let historyIndex = 0; // === history.length means "not recalling"
let draft = ''; // unsubmitted input stashed while recalling history
let recallFilter = ''; // prefix the active recall walk is limited to ('' = every entry)
const SCROLLBACK_CAP = 300;

// :anim N renders N frames over clock 0..1 and plays them inline. N is clamped
// to this ceiling; the inline player starts at this many frames per second.
const ANIM_FRAMES_MAX = 240;
const ANIM_FPS_DEFAULT = 12;

let lastLog = ''; // raw unfiltered log of the last render (success or failure), for :log
let renderPct = -1; // last confirmed percent of the in-flight render (-1 = none yet)
let renderPrimed = false; // a first percent event has arrived this render
let statusStamp = 0; // last live-region text update, for the 1/s throttle
let hintTimer = null; // transient busy-hint restore timer
let sourceOpen = false; // scene-source slide-out open state (persisted)

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
        sourceOpen,
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
        entries.push({ source: e.source });
      }
    }
  }
  const s = data.settings;
  if (s && typeof s === 'object') {
    if (Number.isInteger(s.width) && s.width >= 8 && s.width <= 2048) settings.width = s.width;
    if (Number.isInteger(s.height) && s.height >= 8 && s.height <= 2048) settings.height = s.height;
    if (Number.isInteger(s.quality) && s.quality >= 0 && s.quality <= 11)
      settings.quality = s.quality;
    if (
      s.antialias === true ||
      (typeof s.antialias === 'number' && s.antialias >= 0 && s.antialias <= AA_MAX)
    ) {
      settings.antialias = s.antialias;
    }
    if (Number.isInteger(s.threads) && s.threads >= 1 && s.threads <= 32)
      settings.threads = s.threads;
    if (typeof s.args === 'string' && s.args.trim()) settings.args = s.args;
  }
  if (Array.isArray(data.history)) {
    history = data.history.filter((h) => typeof h === 'string').slice(-HISTORY_MAX);
    historyIndex = history.length;
  }
  if (typeof data.sourceOpen === 'boolean') sourceOpen = data.sourceOpen;
  return entries.length;
}

// --- scene assembly ----------------------------------------------------------

// Last renderer/editor handoff assembly. Kept in the DOM module so the pure
// assembler has no hidden mutable state, while errors still map against the
// exact attempted scene even after a failed entry has been rolled back.
let lastAssembly = assembleReplScene(entries);

function assembleScene() {
  lastAssembly = assembleReplScene(entries);
  return lastAssembly.source;
}

function formatAssembledLine(n) {
  const loc = lastAssembly.mapLine(n);
  return loc ? `line ${n} (entry ${loc.entry}, line ${loc.line})` : `line ${n}`;
}

// Mirror the assembled scene into the slide-out panel, but only while it's open
// (closed, this is a no-op so we never pay for highlight() on every entry
// mutation with the panel parked off-screen). assembleScene() refreshes
// lastAssembly, but describeError runs over the attempted render assembly before
// the finally-refresh derives the settled scene after rollback.
function refreshSource() {
  if (!sourceOpen) return;
  // An empty scene has nothing to graduate, so the editor handoff link hides
  // alongside the placeholder text.
  editorLink.hidden = !entries.length;
  if (entries.length) sourceCode.innerHTML = highlight(assembleScene());
  else sourceCode.textContent = 'scene empty · type scene code to begin';
}

// --- scrollback DOM ----------------------------------------------------------

function appendNode(node) {
  scrollback.appendChild(node);
  // Cap scrollback size; revoke blob URLs in evicted children so old renders
  // don't pin their PNGs in memory forever.
  while (scrollback.children.length > SCROLLBACK_CAP) {
    // The eviction hook (__animDestroy) is stamped onto the player wrapper by the
    // inline animation mount; it isn't part of the DOM element type.
    const oldest = /** @type {Element & { __animDestroy?: () => void }} */ (
      scrollback.firstElementChild
    );
    const previews = /** @type {NodeListOf<HTMLImageElement>} */ (
      oldest.querySelectorAll('img.preview')
    );
    for (const img of previews) URL.revokeObjectURL(img.src);
    // Inline animation players hold ImageBitmaps + blob URLs that live outside
    // any <img>, so they expose a destroy hook for the eviction path to free.
    oldest.__animDestroy?.();
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
function replaceWithNode(fig, node) {
  fig.replaceWith(node);
  scrollback.scrollTop = scrollback.scrollHeight;
}

function replaceWithBlock(fig, cls, text) {
  replaceWithNode(fig, makeBlock(cls, text));
}

// The try-snippet as a one-click affordance (link-styled button; accent on
// links is sanctioned): the click only fills + focuses the input, Enter stays
// the user's, so the first render is still theirs.
function makeTryButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'linkish';
  btn.textContent = TRY_LINE;
  btn.addEventListener('click', () => {
    setInputValue(TRY_LINE);
    input.focus();
  });
  return btn;
}

function buildGreeting() {
  const pre = makeBlock('info', '');
  pre.append(
    'type POV-Ray scene code, get an image · try: ',
    makeTryButton(),
    ' · :example for scenes, :help for commands'
  );
  return pre;
}

// Pending placeholder: the layout shift happens at submit time, sized
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
  // No trailing ellipsis: the .pending figcaption ::after owns the animated
  // one, so "rendering…" here would render a double "rendering……".
  cap.textContent = 'rendering';
  fig.append(box, cap);
  appendNode(fig);
  return fig;
}

function aaLabel() {
  if (settings.antialias === true) return '0.3';
  return String(settings.antialias);
}

// render-512x384-q9-a03.png, from the options actually used.
function downloadName(w, h) {
  let name = `render-${w}x${h}`;
  if (settings.quality !== undefined) name += `-q${settings.quality}`;
  if (settings.antialias !== false) name += `-a${aaLabel().replace('.', '')}`;
  return `${name}.png`;
}

// Swaps the finished image into the pending figure. Figcaption:
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
      /* c8 ignore start -- parseStats never throws on a string log; the catch is defensive */
    } catch {
      stats = null; // fall back to the short caption
    }
    /* c8 ignore stop -- closes the ignore block opened above */
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

// Prints only non-defaults: `idle · 320×240`, gaining `· q 9 · aa 0.3 ·
// threads 4 · args +UA` only when set. Busy: `rendering… · 320×240`, with a
// percent suffix only once a percent event has arrived (rare today; the TTY
// flushes percent lines at trace completion).
function updateStatus() {
  statusStamp = performance.now();
  const busy = abortCtl !== null;
  // Bare head carries no trailing ellipsis: the busy-state ::after owns the
  // animated one, so "rendering…" would render a double "rendering……".
  /* c8 ignore next -- renderPct only reaches >=0 after a second progress event; the dist emits one progress burst per render, so the determinate percent in the head is unreachable */
  const head = busy ? (renderPct >= 0 ? `rendering ${renderPct}%` : 'rendering') : 'idle';
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
// .determinate switches to width: calc(var(--pct) * 1%). The bar only leaves
// the sweep once percents are actually streaming: a single early percent
// (radiosity scenes flush one pretrace, 0% or 1%) would otherwise freeze a thin
// sliver for the whole trace, reading as hung. So the first percent only
// primes; the second (and beyond) drives the determinate width. Percents are
// clamped monotonic because render threads interleave their status lines.
function startProgress() {
  renderPct = -1;
  renderPrimed = false;
  progressEl.classList.remove('determinate');
  progressEl.style.removeProperty('--pct');
  progressEl.hidden = false;
}

function stopProgress() {
  progressEl.hidden = true;
  progressEl.classList.remove('determinate');
  progressEl.style.removeProperty('--pct');
  renderPct = -1;
  renderPrimed = false;
}

function handleRenderEvent(ev) {
  if (ev.kind !== 'progress' || typeof ev.percent !== 'number') return;
  if (!renderPrimed) {
    renderPrimed = true;
    return; // one lone percent never leaves the sweep; wait for a second
  }
  /* c8 ignore start -- the dist emits one progress burst per render, so the second-percent determinate path never runs */
  if (ev.percent <= renderPct) return; // monotonic clamp
  renderPct = ev.percent;
  progressEl.classList.add('determinate');
  progressEl.style.setProperty('--pct', String(renderPct));
  // Live-region hygiene: the bar moves freely, the text at most once per second.
  if (performance.now() - statusStamp >= 1000) updateStatus();
  /* c8 ignore stop -- closes the ignore block opened above */
}

// --- SDL vocabulary (completion pool + include manifest) -----------------------

// Keyword/builtin Tab completion works from first paint; the include library's
// symbols (and the name -> include-file map the undeclared-identifier tip
// reads) arrive when the manifest fetch lands. A slow or failed fetch costs
// only those two affordances, never the REPL itself.
let completePool = buildPool();
/** @type {Map<string, string>} */
let includeFileFor = new Map();
fetch('./includes-manifest.json')
  .then((r) => r.json())
  .then((data) => {
    completePool = buildPool(data.symbols);
    includeFileFor = new Map(data.symbols.map((s) => [s.name, s.file]));
    // Readiness signal for tests (mirrors the editor's data-complete-ready).
    input.setAttribute('data-complete-ready', '');
  })
  /* c8 ignore next -- manifest fetch failure leaves keyword-only completion; the offline test harness always serves the file */
  .catch(() => {});

// --- error presentation --------------------------------------------------------

// render-client's formatError is the single error voice; this layer only adds
// REPL context: the assembled-scene line number is mapped back through the
// entry spans (`line 8 (entry 3, line 2) · …`). The leading `exit N` and
// trailing `Render failed` trims are defensive no-ops once formatError drops
// them itself.
function describeError(err) {
  const formatted = formatError(err, { mapLine: formatAssembledLine });
  let lines = formatted.split('\n');
  if (/^exit \d+$/.test(lines[0])) lines = lines.slice(1);
  while (lines.length && /^(Render failed\.?|\s*)$/.test(lines[lines.length - 1])) lines.pop();
  if (!lines.length) return formatted;
  return lines.join('\n');
}

// The fix for an "undeclared identifier" rollback is almost always one missing
// #include: scan the failed entry's identifiers (comment/string-stripped, so a
// name inside a string or comment never triggers) for one the shipped include
// library declares whose file no surviving entry #includes yet. SDL keywords
// can't false-positive (the manifest holds only library symbols); a #declare
// shadowing a library name at worst yields an advisory tip.
/**
 * @param {string} source the rolled-back entry's raw text
 * @returns {{ name: string, file: string } | null}
 */
function findMissingInclude(source) {
  for (const [name] of stripCommentsAndStrings(source).matchAll(/\b[A-Za-z_]\w*/g)) {
    const file = includeFileFor.get(name);
    if (file && !entries.some((e) => e.source.includes(`#include "${file}"`))) {
      return { name, file };
    }
  }
  return null;
}

// The clickable half of the include tip: prepends the missing #include as entry
// 1 (includes must precede first use), puts the rolled-back entry back after it,
// and re-renders. Re-pushing the entry is load-bearing, not belt-and-braces: the
// rollback pops it before the tip is even built, so an include-only fix renders
// whatever survived (often nothing but the include, i.e. a blank plate), captions
// that as a successful render, and leaves :list without the entry being fixed.
// One-shot (disabled after use); ignored while a render is in flight (renders are
// single-flight). Like :render it passes no rollback: the user asked for this
// state, so a still-failing render keeps it and shows the error (:undo backs it
// out).
/**
 * @param {string} file the include file the missing identifier ships in
 * @param {string} entrySource the rolled-back entry's raw text, restored after the include
 */
function makeIncludeButton(file, entrySource) {
  const line = `#include "${file}"`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'linkish';
  btn.textContent = line;
  btn.addEventListener('click', () => {
    if (input.readOnly) return;
    btn.disabled = true;
    entries.unshift({ source: line });
    entries.push({ source: entrySource });
    saveState();
    appendBlock(
      'info',
      `${line} added as entry 1 · rolled-back entry restored as entry ${entries.length}`
    );
    runRender();
  });
  return btn;
}

// --- rendering ---------------------------------------------------------------

// Renders the assembled scene. `rollback` (if given) runs on any failure,
// including cancellation; it exists only for fresh SDL entries (echoNode is
// that entry's echo, entrySource its raw text for the no-brace tip). Renders
// triggered by :undo/:del/:edit/:render/:example pass no rollback: the user
// asked for that state explicitly, so a failure shows the error and keeps the
// state.
/**
 * @param {{ rollback?: () => void, echoNode?: Element, entrySource?: string }} [opts]
 *   `rollback` undoes a fresh SDL entry on any failure; `echoNode` is that
 *   entry's echo (marked rolled-back); `entrySource` its raw text for the tip.
 */
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
      keepBytes: false,
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
        const block = makeBlock('error', 'entry rolled back\n' + describeError(err));
        if (entrySource && !entrySource.includes('{')) {
          block.append('\ntip: input is POV-Ray scene code, not English. try: ', makeTryButton());
        } else if (entrySource && /undeclared identifier/i.test(block.textContent)) {
          // The rollback already popped the entry, so the include scan runs
          // against the surviving scene only.
          const fix = findMissingInclude(entrySource);
          if (fix) {
            block.append(
              `\ntip: '${fix.name}' ships in ${fix.file} · add an entry: `,
              makeIncludeButton(fix.file, entrySource)
            );
          }
        }
        replaceWithNode(fig, block);
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
    // Single refresh covering submit-success append, rollback pop, :render,
    // :example, and :edit-resubmit. Reflects the SETTLED scene, so the panel
    // never shows a rolled-back entry. (:anim mutates no entries, so it isn't a
    // refresh site.)
    refreshSource();
    input.focus();
  }
}

// --- animation (:anim) -------------------------------------------------------

// Mirrors runRender for the multi-frame path: same busy/cancel/progress/status
// machinery, but drives render-client's renderAnimation and, on success, mounts
// an inline player (canvas + transport) instead of a single image. Like :render
// it keeps scene state on failure, so it takes no rollback hook.
async function runAnimRender(frames) {
  abortCtl = new AbortController();
  input.readOnly = true; // readOnly, not disabled: focus and caret survive
  cancelBtn.hidden = false;
  startProgress();
  updateStatus();
  const w = settings.width;
  const h = settings.height;
  const fig = appendPending(w, h);
  // Live per-frame counter in the pending caption; the .pending ::after still
  // owns the animated ellipsis, so this reads "rendering frame 2/4…".
  const pendingCap = fig.querySelector('figcaption');
  try {
    const opts = {
      width: w,
      height: h,
      antialias: settings.antialias,
      frames,
      initialClock: 0,
      finalClock: 1,
      signal: abortCtl.signal,
      keepFrames: false,
      onEvent: (ev) => {
        if (ev.kind === 'frame') pendingCap.textContent = `rendering frame ${ev.index}/${ev.total}`;
        else handleRenderEvent(ev);
      },
    };
    if (settings.quality !== undefined) opts.quality = settings.quality;
    if (settings.threads !== undefined) opts.threads = settings.threads;
    if (settings.args !== undefined) opts.args = settings.args.split(/\s+/).filter(Boolean);
    const result = await renderAnimation(assembleScene(), opts);
    lastLog = typeof result.log === 'string' ? result.log : '';
    completeAnimResult(fig, result, w, h);
  } catch (err) {
    if (typeof err?.log === 'string') lastLog = err.log; // PovrayError keeps the raw log
    // describeError maps AbortError to 'render cancelled'.
    replaceWithBlock(fig, isAbortError(err) ? 'info' : 'error', describeError(err));
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

function clampFps(value) {
  if (!Number.isFinite(value)) return ANIM_FPS_DEFAULT;
  return Math.min(60, Math.max(1, Math.round(value)));
}

const animDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Swaps the pending figure for the inline animation player: a canvas hero plus
// a transport row (play/pause · scrubber · frame counter · loop · fps ·
// export). Caption mirrors the still figcaption voice:
// `anim #K · W×H · N frames · Xs`.
function completeAnimResult(fig, result, w, h) {
  renderCounter += 1;
  const { bitmaps, blobUrls } = result;
  const total = bitmaps.length;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.setAttribute('aria-label', `animation #${renderCounter}, ${w}×${h}, ${total} frames`);
  // Small-plate treatment matching figure.result img.preview (mat + hairline).
  Object.assign(canvas.style, {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
    padding: '6px',
    border: '1px solid var(--border)',
    background: 'var(--mat) 0 0 / 16px 16px',
  });
  const ctx = canvas.getContext('2d');

  const controls = document.createElement('div');
  Object.assign(controls.style, {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
  });

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = 'play';
  playBtn.setAttribute('aria-pressed', 'false');

  const scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.className = 'scrubber'; // square grey thumb / 2px track, no OS-blue accent
  scrubber.min = '0';
  scrubber.max = String(total - 1);
  scrubber.step = '1';
  scrubber.value = '0';
  scrubber.setAttribute('aria-label', 'frame');
  scrubber.setAttribute('aria-valuetext', `frame 1 of ${total}`);
  Object.assign(scrubber.style, { flex: '1', minWidth: '80px' });

  const frameLabel = document.createElement('span');
  Object.assign(frameLabel.style, {
    color: 'var(--dim)',
    fontSize: 'var(--fs-out)',
    minWidth: '4.5ch',
  });
  frameLabel.textContent = `1/${total}`;

  const loopLabel = document.createElement('label');
  Object.assign(loopLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px' });
  const loopBox = document.createElement('input');
  loopBox.type = 'checkbox';
  loopBox.checked = true;
  // Undo the global form-control sizing so this renders as a native checkbox,
  // and pin accent-color to a neutral token so the checked state paints grey
  // instead of leaking the OS-blue second accent (optical-bench identity rule).
  Object.assign(loopBox.style, {
    height: 'auto',
    minHeight: '0',
    width: 'auto',
    padding: '0',
    margin: '0',
    accentColor: 'var(--border-strong)',
  });
  loopLabel.append(loopBox, document.createTextNode('loop'));

  const fpsLabel = document.createElement('label');
  Object.assign(fpsLabel.style, { display: 'inline-flex', alignItems: 'center', gap: '6px' });
  const fpsBox = document.createElement('input');
  fpsBox.type = 'number';
  fpsBox.min = '1';
  fpsBox.max = '60';
  fpsBox.value = String(ANIM_FPS_DEFAULT);
  fpsBox.style.width = '4.5em';
  fpsLabel.append(document.createTextNode('fps'), fpsBox);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'export webm';

  controls.append(playBtn, scrubber, frameLabel, loopLabel, fpsLabel, exportBtn);

  // --- player state + transport ---
  let index = 0;
  let playing = false;
  let looping = true;
  let fps = ANIM_FPS_DEFAULT;
  let rafId = 0;
  let destroyed = false;

  const draw = (i) => {
    index = i;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmaps[i], 0, 0);
    scrubber.value = String(i);
    // 1-based "frame 2 of 4" for screen readers, matching the visible label
    // instead of the raw 0-indexed slider value.
    scrubber.setAttribute('aria-valuetext', `frame ${i + 1} of ${total}`);
    frameLabel.textContent = `${i + 1}/${total}`;
  };

  const pause = () => {
    if (!playing) return;
    playing = false;
    playBtn.textContent = 'play';
    playBtn.setAttribute('aria-pressed', 'false');
    cancelAnimationFrame(rafId);
  };

  // rAF loop ticking once per 1000/fps ms; loop wraps at the end, else parks on
  // the last frame. A single-frame anim has nothing to play.
  const play = () => {
    if (playing || total < 2) return;
    playing = true;
    playBtn.textContent = 'pause';
    playBtn.setAttribute('aria-pressed', 'true');
    let last = performance.now();
    const tick = (now) => {
      if (!playing) return;
      const interval = 1000 / fps;
      if (now - last >= interval) {
        // Accumulate the interval rather than snapping to `now`, so the average
        // cadence matches the target fps (snapping rounds each step up to the
        // next rAF tick, biasing playback slow and drifting from the export).
        // Resync after a long stall instead of replaying the backlog.
        last += interval;
        if (now - last >= interval) last = now;
        let next = index + 1;
        if (next >= total) {
          if (!looping) {
            pause();
            return;
          }
          next = 0;
        }
        draw(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  // Best-effort WebM via MediaRecorder; PNG-per-frame fallback when unavailable.
  async function exportAnim() {
    const mime = pickWebmMime();
    if (!mime) {
      downloadPngFrames(blobUrls);
      return;
    }
    pause();
    exportBtn.disabled = true;
    const prevLabel = exportBtn.textContent;
    exportBtn.textContent = 'exporting…';
    try {
      const url = await recordCanvasWebm(canvas, fps, mime, async () => {
        for (let i = 0; i < total; i++) {
          draw(i);
          await animDelay(1000 / fps);
        }
      });
      triggerDownload(url, `anim-${w}x${h}.webm`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = prevLabel;
    }
  }

  playBtn.addEventListener('click', () => {
    if (playing) {
      pause();
      return;
    }
    if (index >= total - 1) draw(0); // replay from the top when parked on the last frame
    play();
  });
  scrubber.addEventListener('input', () => {
    pause();
    draw(Number(scrubber.value));
  });
  loopBox.addEventListener('change', () => {
    looping = loopBox.checked;
  });
  fpsBox.addEventListener('change', () => {
    fps = clampFps(Number(fpsBox.value));
    fpsBox.value = String(fps);
  });
  exportBtn.addEventListener('click', () => {
    exportAnim();
  });

  // Eviction hook (appendNode): stop the loop and free the GPU/blob assets the
  // caller owns. Idempotent so a double-free can't blow up.
  fig.__animDestroy = () => {
    if (destroyed) return;
    destroyed = true;
    pause();
    for (const url of blobUrls) URL.revokeObjectURL(url);
    for (const bmp of bitmaps) bmp.close();
  };

  const cap = document.createElement('figcaption');
  cap.textContent = `anim #${renderCounter} · ${w}×${h} · ${total} frames · ${(result.elapsedMs / 1000).toFixed(1)}s`;

  fig.replaceChildren(canvas, controls, cap);
  fig.classList.remove('pending');

  draw(0);
  // Playback is user-driven; autoplay-on-complete only when motion is welcome.
  if (total > 1 && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) play();

  scrollback.scrollTop = scrollback.scrollHeight;
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
  {
    name: 'anim',
    usage: ':anim N',
    desc: 'render the current scene as N frames and play them inline',
  },
  { name: 'editor', usage: ':editor', desc: 'open the assembled scene in the full editor' },
  { name: 'size', usage: ':size WxH', desc: 'render size (each 8..2048)' },
  { name: 'q', usage: ':q N', desc: 'quality 0..11 (default 9)' },
  {
    name: 'aa',
    usage: ':aa [threshold|off]',
    desc: `antialias, threshold 0..${AA_MAX} (no arg = 0.3)`,
  },
  { name: 'threads', usage: ':threads N', desc: 'worker threads 1..32' },
  { name: 'args', usage: ':args [switches]', desc: 'raw POV-Ray switches (:args alone clears)' },
  {
    name: 'log',
    usage: ':log [full]',
    desc: "last render's stats and warnings, 'full' for the raw log",
  },
  { name: 'reset', usage: ':reset', desc: 'clear scene, settings, and saved state' },
];

// :help as structured DOM: aligned usage/description grid per section instead
// of a flowed text wall (the dl grid keeps descriptions in a single scannable
// column regardless of usage-string length).
const HELP_KEYS = [
  ['Enter / run', 'submit'],
  ['Shift+Enter', 'insert a newline'],
  ['Esc / cancel', 'stop a render (fresh entries roll back)'],
  ['ArrowUp / ArrowDown', 'recall input history (typed text recalls by prefix)'],
  ['Tab', 'complete :commands and scene words (an ambiguous Tab lists the matches)'],
  ['click an old entry', 'copy it back into the input'],
];

const HELP_NOTES = [
  'anything that is not a :command is POV-Ray scene code; each entry re-renders the whole scene.',
  'a fresh entry that fails or is cancelled rolls back automatically; :undo/:del/:edit/:render/:example keep their state on failure.',
  'the assembled scene always starts with #version 3.8; missing global_settings/camera/light_source/background are injected with defaults. error line numbers refer to the assembled scene (:source shows it).',
  'settings (:size/:q/:aa/:threads/:args) take effect on the next render.',
  'an :anim N render plays inline; drag the scrubber, play/pause, loop, or export webm (falls back to PNG frames).',
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
  refreshSource(); // covers :undo/:del/:edit (both the re-render and empty-scene arms)
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
      refreshSource(); // empty scene -> the panel shows the placeholder
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
      // Guard the empty scene first, matching the rest of the REPL's voice
      // (:undo 'nothing to undo', :render 'scene empty, add…'); a bare
      // 'usage: :del N (1..0)' with max below min reads as a bug.
      if (!entries.length) {
        appendBlock('error', 'scene empty, nothing to delete');
        break;
      }
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
      if (!entries.length) {
        appendBlock('error', 'scene empty, nothing to edit');
        break;
      }
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
        if (!Number.isFinite(t) || t < 0 || t > AA_MAX) {
          appendBlock('error', `usage: :aa [threshold|off] (threshold 0..${AA_MAX})`);
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
      let stats;
      try {
        stats = parseStats(lastLog);
        /* c8 ignore start -- parseStats never throws on a string log; the catch is defensive */
      } catch {
        stats = null;
      }
      /* c8 ignore stop -- closes the ignore block opened above */
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

    case 'editor':
      if (!entries.length) appendBlock('error', 'scene empty, add something first');
      else openInEditor();
      break;

    case 'anim': {
      const n = parseIntStrict(arg);
      if (!Number.isInteger(n) || n < 1 || n > ANIM_FRAMES_MAX) {
        appendBlock('error', `usage: :anim N (1..${ANIM_FRAMES_MAX})`);
        break;
      }
      if (!entries.length) {
        appendBlock('error', 'scene empty, add something first');
        break;
      }
      runAnimRender(n);
      break;
    }

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
      entries.push({ source: src });
      saveState();
      appendBlock(
        'info',
        `loaded '${arg}' (${src.trimEnd().split('\n').length} lines) · :source to view`
      );
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
  entries.push({ source: text });
  saveState();
  runRender({ rollback: () => entries.pop(), echoNode, entrySource: text });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitInput();
});

cancelBtn.addEventListener('click', () => abortCtl?.abort());

// Scene-source slide-out: a disclosure panel mirroring the assembled scene.
// aria-expanded on the toggle is the single source of truth; the panel mirrors
// it via aria-hidden + the body.source-open class that drives the CSS slide.
// Escape is deliberately NOT bound here: the document-level Escape handler
// aborts an in-flight render and must not be stolen.
function toggleSource(open) {
  sourceOpen = open;
  sourceToggle.setAttribute('aria-expanded', String(open));
  sourcePanel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('source-open', open);
  if (open) refreshSource();
  saveState();
}
sourceToggle.addEventListener('click', () => toggleSource(!sourceOpen));
sourceClose.addEventListener('click', () => toggleSource(false));

// PermalinkState for the editor handoff. The source is the ASSEMBLED scene
// (scaffold included), so the editor renders the same image the REPL did.
// Control fields use the editor's raw-string conventions (empty string =
// control default); antialias false maps to 'off' (the editor select's option
// value; '' would be dropped by its hydration). Out-of-menu :q / :aa values
// degrade to the editor defaults via its tolerant select coercion. frames/fps
// mirror the editor's own control defaults; the REPL has no animation
// settings to carry.
/** @returns {import('./permalink.js').PermalinkState} */
function captureEditorState() {
  return {
    source: assembleScene(),
    width: String(settings.width),
    height: String(settings.height),
    quality: settings.quality === undefined ? '' : String(settings.quality),
    antialias: settings.antialias === false ? 'off' : aaLabel(),
    threads: settings.threads === undefined ? '' : String(settings.threads),
    flags: settings.args ?? '',
    mode: 'still',
    frames: '24',
    fps: '12',
    // See the same stamp in web/turbo.html: the editor labels this "from the
    // REPL" rather than reusing the recipient's last example name.
    origin: 'repl',
  };
}

// Graduate the sketch to the full editor (sliders, animation export,
// permalinks) through the same self-contained #hash payload the editor's
// shareable links use; it hydrates from location.hash on load. encodeState
// never throws for a well-formed state.
async function openInEditor() {
  location.href = './index.html#' + (await encodeState(captureEditorState()));
}

editorLink.addEventListener('click', (e) => {
  // The static href is a bare ./index.html fallback (middle-click/copy still
  // reach the editor); a normal click encodes the scene first, then navigates.
  e.preventDefault();
  openInEditor();
});

// Tap/click an echoed entry to copy it back into the input (the touch path to
// history). Skipped while the user is selecting text to copy.
scrollback.addEventListener('click', (e) => {
  const target = /** @type {Element} */ (e.target);
  if (target.closest('a')) return;
  const entry = target.closest('.entry');
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

// Tab inside a leading ':' token completes the command instead of dropping focus
// to the next control: a unique match fills in (plus a trailing space), several
// matches extend to the longest common prefix, and a Tab that can make no
// progress prints the candidates into the transcript, the same bash semantics the
// SDL arm below uses. The listing arm is what makes short prefixes usable at all:
// `:s`, `:e`, `:a` and `:l` cover 10 of the 17 commands and each has a common
// prefix no longer than the single letter typed, so without it Tab rewrites the
// input to itself and reads as a dead key. Candidates keep COMMANDS order so the
// listing scans like :help rather than alphabetized noise. Returns true when Tab
// was consumed.
function completeCommand() {
  if (input.readOnly) return false;
  const m = /^:(\S*)/.exec(input.value);
  if (!m || input.selectionStart > m[0].length) return false;
  const partial = m[1].toLowerCase();
  const names = COMMANDS.map((c) => c.name).filter((n) => n.startsWith(partial));
  if (names.length) {
    const completion = names.length === 1 ? names[0] : commonPrefix(names);
    if (names.length > 1 && completion.length <= partial.length) {
      appendBlock('info', names.map((n) => ':' + n).join('  '));
    } else {
      const rest = input.value.slice(m[0].length);
      const suffix = names.length === 1 && !rest ? ' ' : '';
      input.value = ':' + completion + suffix + rest;
      input.selectionStart = input.selectionEnd = 1 + completion.length + suffix.length;
      autoGrow();
    }
  }
  return true;
}

// Shell-style Tab completion for scene code (the non-:command arm). The lookup
// runs against assembled-scene + input text, so the scene's own #declares and
// #macros complete alongside the language vocabulary and the include library.
// Bash semantics, no popup: a unique match inserts in place (macros gain call
// parens, caret inside), several matches extend to the longest common prefix,
// and a Tab that can make no progress prints the candidates into the
// transcript like a shell. Prefix matches only (case-sensitive), so the
// common-prefix math means what it says. Returns true when Tab was consumed;
// with no token under the caret Tab falls through, so keyboard focus can
// still leave the input.
function completeSdl() {
  if (input.readOnly) return false;
  if (input.selectionStart !== input.selectionEnd) return false;
  const scenePrefix = assembleScene() + '\n';
  const text = scenePrefix + input.value;
  const caret = scenePrefix.length + input.selectionStart;
  const tok = tokenAt(text, caret);
  if (!tok.word) return false;
  const offer = complete(text, caret, completePool, { limit: Infinity });
  const names = offer
    ? offer.items.filter((c) => c.name.startsWith(tok.word)).map((c) => c.name)
    : [];
  if (!names.length) return true; // nothing to offer (bash would beep)
  const from = tok.start - scenePrefix.length;
  const to = tok.end - scenePrefix.length;
  if (names.length === 1) {
    const chosen = offer.items.find((c) => c.name === names[0]);
    const r = applyCompletion(input.value, { from, to }, chosen);
    input.value = r.text;
    input.selectionStart = input.selectionEnd = r.caret;
  } else {
    const prefix = commonPrefix(names);
    if (prefix.length > tok.word.length) {
      input.value = input.value.slice(0, from) + prefix + input.value.slice(to);
      input.selectionStart = input.selectionEnd = from + prefix.length;
    } else {
      appendBlock('info', [...new Set(names)].sort().join('  '));
    }
  }
  autoGrow();
  return true;
}

// Nearest history index in `dir` (-1 = older, +1 = newer) whose entry starts
// with the active recall filter. Returns history.length when the walk runs
// off the newest end (back at the draft) and -1 when nothing older matches.
function recallStep(dir) {
  let i = historyIndex + dir;
  while (i >= 0 && i < history.length && !history[i].startsWith(recallFilter)) i += dir;
  return i;
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
    // Enter and Ctrl/Cmd+Enter submit; Shift+Enter inserts a newline.
    e.preventDefault();
    submitInput();
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (completeCommand() || completeSdl()) e.preventDefault();
    return;
  }
  if (e.key === 'ArrowUp' && caretOnFirstLine() && historyIndex > 0) {
    if (historyIndex === history.length) {
      draft = input.value;
      // Bash-style prefix recall: typed text limits the walk to entries that
      // start with it; an empty input recalls linearly. Captured once, when
      // the walk leaves the draft, so editing a recalled entry mid-walk
      // doesn't re-filter the rest of the walk.
      recallFilter = draft;
    }
    const i = recallStep(-1);
    if (i >= 0) {
      historyIndex = i;
      setInputValue(history[i]);
      e.preventDefault();
    }
  } else if (e.key === 'ArrowDown' && caretOnLastLine() && historyIndex < history.length) {
    historyIndex = recallStep(1);
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
appendNode(buildGreeting());
if (restoredCount) {
  appendBlock(
    'info',
    `restored ${restoredCount} ${restoredCount === 1 ? 'entry' : 'entries'} · :render to re-render · :reset to clear`
  );
}
updateStatus();
// Apply the restored slide-out state to the DOM (a reload with the panel open
// returns open + populated), then refresh it (a no-op when restored closed).
sourceToggle.setAttribute('aria-expanded', String(sourceOpen));
sourcePanel.setAttribute('aria-hidden', String(!sourceOpen));
document.body.classList.toggle('source-open', sourceOpen);
refreshSource();
// Warm the renderer (glue module + wasm fetch/compile) so the first entry's
// auto-render doesn't pay the whole startup cost.
prewarm();
