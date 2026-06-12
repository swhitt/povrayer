// UI page controller: editor + controls -> render via render-client, output pane.
// Side-effect module, no exports. All rendering goes through ./render-client.js.
import {
  renderScene,
  renderAnimation,
  isBusy,
  isAbortError,
  formatError,
  parseStats,
  prewarm,
  PovrayError,
} from './render-client.js';
import {
  CATEGORIES,
  DIFFICULTIES,
  EXAMPLES,
  RENDER_TIERS,
  getExample,
  getExampleRecord,
  groupByCategory,
} from './examples.js';
import { highlight } from './highlight.js';
import { validateScene } from './sdl-validate.js';
import { encodeState, decodeState } from './permalink.js';
import { parseRenderParams } from './url-params.js';
import { parseFlags } from './flags.js';
import { formatStats } from './stats.js';
import { buildPool, complete, applyCompletion, signatureText } from './complete.js';
import { createAssetDrop } from './asset-drop.js';
import {
  addSnapshot,
  loadSnapshots,
  saveSnapshots,
  snapshotPreview,
  relativeTime,
  lineDelta,
} from './history.js';
import { parseDeclaredNumbers, numberTokenAt, scrubStep, formatScrubbed } from './sliders.js';
import { CONTROL_FIELDS, coerceSaved, coerceParam, coerceHydrate } from './settings.js';
import { triggerDownload } from './anim-export.js';
import { createPlayer } from './player.js';
import { ensureCrossOriginIsolation } from './coi.js';
import { createLiveDraftController } from './live-draft.js';
import {
  exampleSearchText,
  matchesExampleFilters as recordMatchesFilters,
} from './example-filters.js';
import { createRenderFeedback } from './render-feedback.js';

const isoWarning = document.getElementById('iso-warning');
ensureCrossOriginIsolation({ warningEl: isoWarning });

// Page elements. The `/** @type {...} */ (...)` casts pin each lookup to the
// concrete element it is in index.html (verified against the markup) so checkJs
// can flag a `.value` on a div or a `.disabled` on a span. The ids all exist at
// module-eval time, so the cast (which also drops the `| null`) is safe here.
const exampleField = document.getElementById('example-field');
const exampleTrigger = document.getElementById('example-trigger');
const exampleTriggerText = document.getElementById('example-trigger-text');
const galleryBtn = /** @type {HTMLButtonElement} */ (document.getElementById('gallery-btn'));
const exampleBrowser = document.getElementById('example-browser');
const exampleSearch = /** @type {HTMLInputElement} */ (document.getElementById('example-search'));
const exampleClear = /** @type {HTMLButtonElement} */ (document.getElementById('example-clear'));
const exampleType = /** @type {HTMLSelectElement} */ (document.getElementById('example-type'));
const exampleDifficulty = /** @type {HTMLSelectElement} */ (
  document.getElementById('example-difficulty')
);
const exampleTier = /** @type {HTMLSelectElement} */ (document.getElementById('example-tier'));
const exampleLicense = /** @type {HTMLSelectElement} */ (
  document.getElementById('example-license')
);
const exampleListbox = document.getElementById('example-listbox');
const exampleEmpty = document.getElementById('example-empty');
const exampleAttrText = document.querySelector('#example-attribution .ex-attr-text');
const exampleAttrSrc = /** @type {HTMLAnchorElement} */ (
  document.querySelector('#example-attribution .ex-attr-src')
);
const galleryPanel = /** @type {HTMLElement} */ (document.getElementById('gallery'));
const galleryClose = /** @type {HTMLButtonElement} */ (document.getElementById('gallery-close'));
const gallerySearch = /** @type {HTMLInputElement} */ (document.getElementById('gallery-search'));
const galleryType = /** @type {HTMLSelectElement} */ (document.getElementById('gallery-type'));
const galleryDifficulty = /** @type {HTMLSelectElement} */ (
  document.getElementById('gallery-difficulty')
);
const galleryTier = /** @type {HTMLSelectElement} */ (document.getElementById('gallery-tier'));
const galleryLicense = /** @type {HTMLSelectElement} */ (
  document.getElementById('gallery-license')
);
const galleryClear = /** @type {HTMLButtonElement} */ (document.getElementById('gallery-clear'));
const galleryGrid = document.getElementById('gallery-grid');
const galleryEmpty = document.getElementById('gallery-empty');
const sceneDirty = /** @type {HTMLElement} */ (document.getElementById('scene-dirty'));
const resetSceneBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-scene-btn'));
const copySceneBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copy-scene-btn'));
const downloadSceneBtn = /** @type {HTMLButtonElement} */ (
  document.getElementById('download-scene-btn')
);
const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
const editorCode = document.getElementById('editor-code');
const editorStack = document.getElementById('editor-stack');
const findBar = document.getElementById('find-bar');
const findInput = /** @type {HTMLInputElement} */ (document.getElementById('find-input'));
const findCount = document.getElementById('find-count');
const mainEl = /** @type {HTMLElement} */ (document.querySelector('main'));
const splitHandle = document.getElementById('split-handle');
const completeBox = document.getElementById('complete');
const completeStatus = document.getElementById('complete-status');
const slidersPanel = document.getElementById('sliders');
const sceneParams = /** @type {HTMLDetailsElement} */ (document.getElementById('scene-params'));
const sceneParamsCount = document.getElementById('scene-params-count');
const restoreNote = document.getElementById('restore-note');
const restoreBtn = document.getElementById('restore-btn');
const advanced = /** @type {HTMLDetailsElement} */ (document.getElementById('advanced'));
const historyDetails = /** @type {HTMLDetailsElement} */ (document.getElementById('history'));
const historyCount = document.getElementById('history-count');
const historyList = document.getElementById('history-list');
const gutter = document.getElementById('gutter');
const liveToggle = document.getElementById('live-toggle');
const liveToggleState = /** @type {HTMLElement} */ (liveToggle.querySelector('.live-toggle-state'));
const widthInput = /** @type {HTMLInputElement} */ (document.getElementById('width'));
const heightInput = /** @type {HTMLInputElement} */ (document.getElementById('height'));
const qualitySelect = /** @type {HTMLSelectElement} */ (document.getElementById('quality'));
const antialiasSelect = /** @type {HTMLSelectElement} */ (document.getElementById('antialias'));
const draftSelect = /** @type {HTMLSelectElement} */ (document.getElementById('draft-size'));
const threadsInput = /** @type {HTMLInputElement} */ (document.getElementById('threads'));
const flagsInput = /** @type {HTMLInputElement} */ (document.getElementById('flags'));
const statsList = /** @type {HTMLElement} */ (document.getElementById('stats'));
const renderBtn = /** @type {HTMLButtonElement} */ (document.getElementById('render-btn'));
const cancelBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cancel-btn'));
const copyLinkBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copy-link-btn'));
const status = document.getElementById('status');
const statusSpinner = document.getElementById('status-spinner');
const stopBtn = /** @type {HTMLButtonElement} */ (document.getElementById('stop-btn'));
const errorBox = document.getElementById('error');
const errorLineEl = document.getElementById('error-line');
const output = /** @type {HTMLImageElement} */ (document.getElementById('output'));
const downloadBtn = /** @type {HTMLAnchorElement} */ (document.getElementById('download-btn'));
const log = document.getElementById('log');
const logDetails = document.getElementById('log-details');
const logLabel = document.getElementById('log-label');
const logCount = document.getElementById('log-count');
const progressBar = document.getElementById('progress');
const plateHint = /** @type {HTMLElement} */ (document.querySelector('#output-plate .hint'));
const zoomBtn = /** @type {HTMLButtonElement} */ (
  document.querySelector('#output-pane .zoom-toggle')
);

// Animate-mode controls + the inline frame player.
const modeStillBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mode-still'));
const modeAnimateBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mode-animate'));
const framesInput = /** @type {HTMLInputElement} */ (document.getElementById('frames'));
const fpsInput = /** @type {HTMLInputElement} */ (document.getElementById('fps'));
const playerCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('player-canvas'));
const playerControls = /** @type {HTMLElement} */ (document.getElementById('player-controls'));
const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('play-btn'));
const scrubber = /** @type {HTMLInputElement} */ (document.getElementById('scrubber'));
const frameReadout = /** @type {HTMLElement} */ (document.getElementById('frame-readout'));
const loopBtn = /** @type {HTMLButtonElement} */ (document.getElementById('loop-btn'));
const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('export-btn'));
const exportFormat = /** @type {HTMLSelectElement} */ (document.getElementById('export-format'));

const STORAGE_KEY = 'povrayer.ui.v1';
const HISTORY_KEY = 'povrayer.ui.history';
const HISTORY_MAX = 20; // capped + deduped, text-only: keeps localStorage light

// 'still' renders a single frame; 'animate' drives POV-Ray's clock loop and
// plays the frames back in #player-canvas. Restored from saved state below.
/** @type {'still' | 'animate'} */
let mode = 'still';
// True once a still render has produced an image: lets a mode switch back to
// 'still' re-show that image instead of the empty-state hint.
let hasStillImage = false;
// Live-draft auto-render: ON by default, persisted. Drafts fire only in still
// mode; the full machinery lives in the "live draft" section near the bottom.
let liveDraft = true;
// Two-column editor/output split, as the editor pane's fr count against the
// output pane's 1fr (so 1 = 50/50, 1.5 ≈ 60/40); null = the CSS default 50/50.
// Persisted like advancedOpen/liveDraft; the splitter machinery lives in the
// "draggable editor/output split" section.
/** @type {number | null} */
let splitFr = null;
// Drag bounds as pane fractions: the editor pane stays within 20%..80% of the
// row (the grid's minmax(320px, …) floors are the second, hard guard). The fr
// equivalents (f / (1 - f)) bound splitFr itself.
const SPLIT_MIN_FRACTION = 0.2;
const SPLIT_MAX_FRACTION = 0.8;
const SPLIT_MIN_FR = SPLIT_MIN_FRACTION / (1 - SPLIT_MIN_FRACTION); // 0.25
const SPLIT_MAX_FR = SPLIT_MAX_FRACTION / (1 - SPLIT_MAX_FRACTION); // 4

// ---- example browser (editable-combobox popover) + persisted state ----

// The flattened option elements in render order, plus the per-group bookkeeping
// the filter + accordion toggle. Both populated by buildExampleBrowser(); the
// option's lowercased haystack is its filter target. Each group record is
// { key, groupEl, headEl, opts: [{ el, haystack }], collapsed }; collapsed
// drives the disclosure (openBrowser seeds it, the head toggle flips it).
const optionEls = [];
const exampleGroups = [];
const galleryCards = [];
let galleryBuilt = false;
// The roving aria-activedescendant item: a category HEAD or an OPTION, or null.
let activeItem = null;

const labelByKey = (items, key) => items.find((item) => item.key === key).label;
const tierByKey = (key) => RENDER_TIERS.find((tier) => tier.key === key);
const categoryLabelByKey = (key) => CATEGORIES.find((item) => item.key === key).label;

// Render one .ex-group per CATEGORIES entry (in order) and one .ex-option per
// scene. The head is a disclosure toggle (role=button + aria-expanded) carrying
// a caret, the label, and a scene count. No `if (items.length)` guard: the node
// test guarantees every category is non-empty, so an empty group head can't
// happen.
function buildExampleBrowser() {
  for (const group of groupByCategory()) {
    const groupEl = document.createElement('div');
    groupEl.className = 'ex-group';
    groupEl.setAttribute('role', 'group');
    groupEl.setAttribute('aria-labelledby', `exgrp-${group.key}`);

    const head = document.createElement('div');
    head.id = `exgrp-${group.key}`;
    head.className = 'ex-group-head';
    head.setAttribute('role', 'button');
    head.setAttribute('aria-expanded', 'false'); // renderList() reconciles on open

    // Caret (decorative; the glyph/rotation by aria-expanded lives in CSS), the
    // category label, and a grey scene-count chip. All accent-free chrome.
    const caret = document.createElement('span');
    caret.className = 'ex-group-caret';
    caret.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'ex-group-label';
    label.textContent = group.label; // textContent escapes '&' in the label
    const count = document.createElement('span');
    count.className = 'ex-group-count';
    count.textContent = String(group.items.length);
    head.append(caret, label, count);
    groupEl.appendChild(head);

    const opts = [];
    for (const ex of group.items) {
      const opt = document.createElement('div');
      opt.className = 'ex-option';
      opt.id = `ex-opt-${ex.name}`;
      opt.dataset.name = ex.name;
      opt.dataset.category = ex.category;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', 'false');

      const title = document.createElement('span');
      title.className = 'ex-title';
      title.textContent = ex.title;
      const desc = document.createElement('span');
      desc.className = 'ex-desc';
      desc.textContent = ex.description;
      // The byline span always exists (setTriggerLabel reuses it for the
      // quiet `loaded` marker) but hides when it has nothing beyond what the
      // attribution footer already shows.
      const by = document.createElement('span');
      by.className = 'ex-by';
      by.textContent = exByline(ex);
      by.hidden = by.textContent === '';
      const thumb = document.createElement('img');
      thumb.className = 'ex-thumb';
      thumb.src = ex.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.width = 64;
      thumb.height = 48;
      const text = document.createElement('span');
      text.className = 'ex-text';
      text.append(title, desc, by);
      opt.append(thumb, text);

      groupEl.appendChild(opt);
      const haystack = exampleSearchText(ex, {
        categoryLabel: group.label,
        difficultyLabel: labelByKey(DIFFICULTIES, ex.difficulty),
        tierLabel: labelByKey(RENDER_TIERS, ex.renderTier),
      });
      opts.push({ el: opt, ex, haystack });
      optionEls.push(opt);
    }
    exampleListbox.insertBefore(groupEl, exampleEmpty);
    exampleGroups.push({ key: group.key, groupEl, headEl: head, opts, collapsed: true });
  }
}
buildExampleBrowser();

function buildGallery() {
  if (galleryBuilt) return;
  galleryBuilt = true;
  for (const ex of EXAMPLES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card';
    card.dataset.name = ex.name;

    const img = document.createElement('img');
    img.src = ex.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 160;
    img.height = 120;

    const body = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'gallery-title';
    title.textContent = ex.title;
    const meta = document.createElement('span');
    meta.className = 'gallery-meta';
    meta.textContent = [
      categoryLabelByKey(ex.category),
      labelByKey(DIFFICULTIES, ex.difficulty),
      labelByKey(RENDER_TIERS, ex.renderTier),
      ex.animated ? 'Animated' : 'Still',
    ].join(' · ');
    const license = document.createElement('span');
    license.className = 'gallery-license';
    license.textContent = `${ex.license} · ${ex.author}`;
    body.append(title, meta, license);
    card.append(img, body);
    galleryGrid.appendChild(card);

    const haystack = exampleSearchText(ex, {
      categoryLabel: categoryLabelByKey(ex.category),
      difficultyLabel: labelByKey(DIFFICULTIES, ex.difficulty),
      tierLabel: labelByKey(RENDER_TIERS, ex.renderTier),
    });
    galleryCards.push({ el: card, ex, haystack });
  }
  syncLoadedGalleryCard(selectedExample);
}

// EXAMPLES is a static, non-empty module literal, so EXAMPLES[0] is defined.
const DEFAULT_EXAMPLE = EXAMPLES[0].name;
// The loaded scene's name; replaces every old examplesSelect.value read/write.
let selectedExample = DEFAULT_EXAMPLE;

function hasExample(name) {
  return getExampleRecord(name) !== undefined;
}

// Per-row byline for an example option. The popover footer (.ex-attr) already
// shows the active option's author/license, so a row earns a third line only
// when it carries non-default (third-party) credit; for in-house scenes the
// byline would just repeat the footer on every row.
function exByline(ex) {
  return ex.author === 'povrayer' ? '' : `${ex.author} · ${ex.license}`;
}

// Footer attribution. Branch-free: the link's visibility is an assignment off
// sourceUrl, so first-party rows hide the link and sourced rows show it.
function updateAttribution(ex) {
  exampleAttrText.textContent = `by ${ex.author} · ${ex.license}`;
  exampleAttrSrc.href = ex.sourceUrl; // '' is fine; the link stays hidden
  exampleAttrSrc.hidden = !ex.sourceUrl; // assignment, not `if` -> no dead branch
  exampleAttrSrc.setAttribute('aria-label', `source for ${ex.title}`);
}

function syncLoadedGalleryCard(name) {
  for (const { el } of galleryCards) {
    if (el.dataset.name === name) el.dataset.loaded = 'true';
    else delete el.dataset.loaded;
  }
}

// Reflect the loaded scene in the trigger label + data-name, and re-mark the
// loaded option (bold + a quiet `loaded` byline, never aria-selected).
function setTriggerLabel(name) {
  const record = getExampleRecord(name);
  exampleTriggerText.textContent = record.title;
  exampleTrigger.dataset.name = name;
  for (const opt of optionEls) {
    const r = getExampleRecord(opt.dataset.name);
    const loaded = opt.dataset.name === name;
    // The byline carries the (rare) third-party credit and/or the loaded
    // marker; with neither it hides so default rows stay two lines.
    const parts = [exByline(r), loaded ? 'loaded' : ''].filter(Boolean);
    const by = /** @type {HTMLElement} */ (opt.querySelector('.ex-by'));
    by.textContent = parts.join(' · ');
    by.hidden = parts.length === 0;
    if (loaded) opt.dataset.loaded = 'true';
    else delete opt.dataset.loaded;
  }
  syncLoadedGalleryCard(name);
}

// Animated examples ship a suggested frame count + fps; prefill the animate
// inputs so the intended loop runs without guessing. Still examples leave the
// inputs untouched, so a frames/fps the user dialed in survives loading other
// still scenes. After boot, setFps keeps the inline player's cadence in sync;
// during ?example= boot the player does not exist yet and syncs from the input
// once it is constructed.
function applyExampleClock(record, { syncPlayer = true } = {}) {
  if (!record.animated) return; // still scenes: leave the inputs alone
  framesInput.value = String(record.frames);
  fpsInput.value = String(record.fps);
  if (syncPlayer) player.setFps(record.fps);
}

function shouldAutoDraftExample(record) {
  return !record.animated && record.renderTier !== 'heavy';
}

function canAutoDraftCurrentScene() {
  const record = getExampleRecord(selectedExample);
  if (record && sceneIsDirty()) return !record.animated;
  return !record || shouldAutoDraftExample(record);
}

function applyExampleRenderDefaults(record) {
  if (qualitySelect.value !== '') return;
  qualitySelect.value = tierByKey(record.renderTier).quality;
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

// The settings.js control fields wired to their DOM elements. readControls
// snapshots them for persistence; applyControls writes a foreign value set back
// through a per-source coercion, so the validation lives in ONE schema instead of
// drifting across the save / capture / restore / URL-param / hydrate call sites.
const controlEl = {
  width: widthInput,
  height: heightInput,
  quality: qualitySelect,
  antialias: antialiasSelect,
  draft: draftSelect,
  threads: threadsInput,
  flags: flagsInput,
  frames: framesInput,
  fps: fpsInput,
};

// Snapshot every control's current value, keyed by field, for persistence.
function readControls() {
  /** @type {Record<string, string>} */
  const values = {};
  for (const f of CONTROL_FIELDS) values[f.key] = controlEl[f.key].value;
  return values;
}

// Write a foreign value set (keyed by field) into the controls through `coerce`,
// which returns the string to write or null to leave a control untouched.
// selectAllows is the live <option> membership check the select coercions need.
function applyControls(source, coerce) {
  for (const f of CONTROL_FIELDS) {
    const next = coerce(f, source[f.key], (v) => selectAllows(controlEl[f.key], v));
    if (next !== null) controlEl[f.key].value = next;
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        source: editor.value,
        ...readControls(),
        example: selectedExample,
        mode,
        liveDraft,
        advancedOpen: advanced.open,
        split: splitFr,
      })
    );
  } catch {
    // Storage blocked or full: persistence is best-effort.
  }
}

// The current scene + settings as a permalink PermalinkState. Deliberately the
// saveState() key set MINUS `example` and `liveDraft`: a shared link carries the
// literal scene text and render settings, not the sender's example selection or
// their live-draft preference.
/** @returns {import('./permalink.js').PermalinkState} */
function captureState() {
  return /** @type {import('./permalink.js').PermalinkState} */ ({
    source: editor.value,
    ...readControls(),
    mode,
  });
}

// When a ?gist=<id> scene is loaded, that short gist URL stays shareable until
// the scene text is edited. gistId is the loaded id; gistSource is its pristine
// text. The pin breaks the moment editor.value diverges from gistSource.
/** @type {string | null} */
let gistId = null;
/** @type {string | null} */
let gistSource = null;

function baseSceneUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url;
}

function appendShareParams(url) {
  const controls = readControls();
  for (const f of CONTROL_FIELDS) {
    const value = controls[f.key];
    if (value !== '') url.searchParams.set(f.key, value);
  }
  url.searchParams.set('mode', mode);
}

function pinnedGistUrl() {
  if (gistId !== null) {
    if (editor.value === gistSource) {
      const pinned = baseSceneUrl();
      pinned.searchParams.set('gist', gistId);
      return pinned;
    }
    gistId = null;
    gistSource = null;
  }
  return null;
}

function selectedExampleIsPristine() {
  return editor.value === lastLoadedSource && getExample(selectedExample) === lastLoadedSource;
}

function exampleShareUrl() {
  if (!selectedExampleIsPristine()) return null;
  const url = baseSceneUrl();
  url.searchParams.set('example', selectedExample);
  appendShareParams(url);
  return url;
}

// Keep the visible URL honest without making every edit a self-contained scene
// blob. Normal editing clears stale hash/example/gist URLs; explicit Copy Link
// creates the long hash when it is actually needed.
function syncAddressUrl() {
  const pinned = pinnedGistUrl();
  if (pinned) {
    history.replaceState(null, '', pinned);
    return;
  }
  const url = new URL(location.href);
  if (!url.hash && !url.searchParams.has('gist') && !url.searchParams.has('example')) return;
  history.replaceState(null, '', baseSceneUrl());
}

async function shareUrlForCurrentState() {
  const pinned = pinnedGistUrl();
  if (pinned) return pinned;

  const exUrl = exampleShareUrl();
  if (exUrl) return exUrl;

  const url = baseSceneUrl();
  url.hash = await encodeState(captureState());
  return url;
}

function replaceAddress(url) {
  history.replaceState(null, '', url);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState();
    syncAddressUrl();
  }, 300);
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
    saved && typeof saved.example === 'string' && hasExample(saved.example)
      ? saved.example
      : DEFAULT_EXAMPLE;
  selectedExample = example;
  setTriggerLabel(example);
  /* c8 ignore next -- example is always a real EXAMPLES entry (hasExample-validated or DEFAULT_EXAMPLE), so getExample never returns undefined here */
  lastLoadedSource = getExample(example) ?? '';
  editor.value = saved && typeof saved.source === 'string' ? saved.source : lastLoadedSource;
  if (saved) {
    applyControls(saved, coerceSaved);
    if (typeof saved.liveDraft === 'boolean') liveDraft = saved.liveDraft;
    if (typeof saved.advancedOpen === 'boolean') advanced.open = saved.advancedOpen;
    if (saved.mode === 'still' || saved.mode === 'animate') mode = saved.mode;
    // The fr count is re-clamped to the drag's own bounds (a hand-edited blob
    // could otherwise crush a pane); applySplit() in the splitter section
    // writes it onto <main> once the handle wiring is set up.
    if (typeof saved.split === 'number' && Number.isFinite(saved.split) && saved.split > 0) {
      splitFr = clamp(saved.split, SPLIT_MIN_FR, SPLIT_MAX_FR);
    }
  }
}

// URL query params (e.g. ?example=glass&width=1200&q=11&mode=animate) seed the
// catalog scene and controls on load, OVERRIDING the saved/default values. A
// #hash permalink hydrates AFTER this runs and so wins. Combines with ?gist
// (the gist scene rendered at these settings). The numeric clamps live in
// url-params.js; quality/antialias are matched here against the real <select>
// options so an out-of-range value is ignored, not forced.
function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const exampleName = params.get('example');
  if (exampleName && hasExample(exampleName)) {
    const record = getExampleRecord(exampleName);
    selectedExample = exampleName;
    editor.value = record.source;
    lastLoadedSource = record.source;
    applyExampleClock(record, { syncPlayer: false });
    applyExampleRenderDefaults(record);
    setTriggerLabel(exampleName);
  }
  const p = parseRenderParams(location.search);
  applyControls(p, coerceParam);
  if (p.mode === 'still' || p.mode === 'animate') mode = p.mode;
}
applyUrlParams();

// Selecting an example replaces the editor content. Edits are guarded by a
// confirm(); the replaced text is stashed (one recovery copy). The popover only
// ever emits real scene names, so there is no not-found guard here.
function selectExample(name) {
  const record = getExampleRecord(name);
  const source = record.source;
  if (editor.value !== lastLoadedSource) {
    if (!confirm('Replace your edited scene?')) return; // selectedExample unchanged, no load
    stashScene();
  }
  selectedExample = name;
  editor.value = source;
  lastLoadedSource = source;
  applyExampleClock(record); // BEFORE scheduleDraft
  applyExampleRenderDefaults(record);
  setTriggerLabel(name); // trigger text + data-name + re-mark loaded option
  reflectSceneReplaced({ autoDraft: shouldAutoDraftExample(record) });
}

function sceneIsDirty() {
  return editor.value !== lastLoadedSource;
}

function canResetScene() {
  return lastLoadedSource !== '' && sceneIsDirty();
}

function updateSceneActions() {
  const dirty = sceneIsDirty();
  sceneDirty.textContent = dirty ? 'modified' : 'current';
  sceneDirty.dataset.dirty = String(dirty);
  resetSceneBtn.disabled = !canResetScene();
}

// ---- example-browser interaction (open/filter/navigate/select/close) ----

// Visible (non-collapsed, non-filtered-out) options in render order. A collapsed
// category hides its rows, so they drop out here AND out of navItems().
function visibleOptions() {
  return optionEls.filter((el) => !el.hidden);
}

// The roving nav order: each shown category head, immediately followed by that
// category's visible rows. A collapsed head contributes only itself; a category
// filtered out by the search contributes nothing.
function navItems() {
  const items = [];
  for (const g of exampleGroups) {
    if (g.groupEl.hidden) continue;
    items.push(g.headEl);
    for (const { el } of g.opts) if (!el.hidden) items.push(el);
  }
  return items;
}

function isHead(el) {
  return el != null && el.classList.contains('ex-group-head');
}

// The { key, groupEl, headEl, opts, collapsed } record a head/option belongs to.
function groupFor(el) {
  const groupEl = el.closest('.ex-group');
  return exampleGroups.find((g) => g.groupEl === groupEl);
}

// Mark one nav item active (roving aria-activedescendant); null clears it. The
// active item is the ONLY one with .is-active, and the only OPTION with
// aria-selected. A head carries neither aria-selected nor attribution (no
// scene). The loaded option is marked separately (data-loaded), never here.
function setActive(item) {
  if (activeItem) {
    activeItem.classList.remove('is-active');
    if (activeItem.classList.contains('ex-option')) {
      activeItem.setAttribute('aria-selected', 'false');
    }
  }
  activeItem = item;
  if (!item) {
    exampleSearch.setAttribute('aria-activedescendant', '');
    return;
  }
  item.classList.add('is-active');
  if (item.classList.contains('ex-option')) {
    item.setAttribute('aria-selected', 'true');
    updateAttribution(getExampleRecord(item.dataset.name));
  }
  exampleSearch.setAttribute('aria-activedescendant', item.id);
  item.scrollIntoView({ block: 'nearest' });
}

// Recompute visibility from the search box AND the per-category collapse state.
// While searching (query non-empty) collapse is IGNORED: every category with a
// match auto-expands and shows its matching rows. With an empty query a category
// shows its rows only when expanded. A head hides only when a search excludes
// it. #example-empty shows ONLY when a search matches nothing, never merely
// because categories are collapsed.
function hasExampleFilters() {
  return (
    exampleSearch.value.trim() !== '' ||
    exampleType.value !== 'all' ||
    exampleDifficulty.value !== 'all' ||
    exampleTier.value !== 'all' ||
    exampleLicense.value !== 'all'
  );
}

function resetExampleFilters() {
  exampleSearch.value = '';
  exampleType.value = 'all';
  exampleDifficulty.value = 'all';
  exampleTier.value = 'all';
  exampleLicense.value = 'all';
}

function matchesExampleFilters(ex) {
  return recordMatchesFilters(ex, {
    type: exampleType.value,
    difficulty: exampleDifficulty.value,
    tier: exampleTier.value,
    license: exampleLicense.value,
  });
}

function resetGalleryFilters() {
  gallerySearch.value = '';
  galleryType.value = 'all';
  galleryDifficulty.value = 'all';
  galleryTier.value = 'all';
  galleryLicense.value = 'all';
}

function hasGalleryFilters() {
  return (
    gallerySearch.value.trim() !== '' ||
    galleryType.value !== 'all' ||
    galleryDifficulty.value !== 'all' ||
    galleryTier.value !== 'all' ||
    galleryLicense.value !== 'all'
  );
}

function matchesGalleryFilters(ex) {
  return recordMatchesFilters(ex, {
    type: galleryType.value,
    difficulty: galleryDifficulty.value,
    tier: galleryTier.value,
    license: galleryLicense.value,
  });
}

function renderGallery() {
  const q = gallerySearch.value.trim().toLowerCase();
  galleryClear.hidden = !hasGalleryFilters();
  let anyMatch = false;
  for (const { el, ex, haystack } of galleryCards) {
    const match = (q === '' || haystack.includes(q)) && matchesGalleryFilters(ex);
    el.hidden = !match;
    if (match) anyMatch = true;
  }
  galleryEmpty.hidden = anyMatch;
}

function openGallery() {
  closeBrowser(false);
  buildGallery();
  renderGallery();
  galleryPanel.hidden = false;
  gallerySearch.focus();
}

function closeGallery() {
  galleryPanel.hidden = true;
  galleryBtn.focus();
}

function renderList() {
  const q = exampleSearch.value.trim().toLowerCase();
  const filtering = hasExampleFilters();
  exampleClear.hidden = !filtering;
  let anyMatch = false;
  for (const g of exampleGroups) {
    let groupHasMatch = false;
    for (const { el, ex, haystack } of g.opts) {
      const match = (q === '' || haystack.includes(q)) && matchesExampleFilters(ex);
      el.hidden = !(match && (filtering || !g.collapsed));
      if (match) groupHasMatch = true;
    }
    g.groupEl.hidden = filtering && !groupHasMatch;
    g.headEl.setAttribute('aria-expanded', String(filtering ? groupHasMatch : !g.collapsed));
    if (groupHasMatch) anyMatch = true;
  }
  exampleEmpty.hidden = !(filtering && !anyMatch);
}

function setGroupCollapsed(g, collapsed) {
  g.collapsed = collapsed;
  renderList();
}

function toggleGroup(g) {
  g.collapsed = !g.collapsed;
  renderList();
}

// Clamp-move the active item over the flattened visible nav order (no wrap).
function moveActiveTo(index) {
  const items = navItems();
  if (!items.length) return;
  setActive(items[clamp(index, 0, items.length - 1)]);
}

function openBrowser() {
  exampleBrowser.hidden = false;
  exampleTrigger.setAttribute('aria-expanded', 'true');
  resetExampleFilters();
  // Open COMPACT: collapse every category except the loaded scene's, so its
  // rows are the only ones showing and the panel isn't a 29-row wall.
  const loaded = document.getElementById(`ex-opt-${selectedExample}`);
  const loadedGroup = loaded ? groupFor(loaded) : null;
  for (const g of exampleGroups) g.collapsed = loadedGroup ? g !== loadedGroup : true;
  renderList();
  setActive(loaded ?? null); // gallery-only scenes have no featured row to focus
  if (!loaded) updateAttribution(getExampleRecord(selectedExample));
  exampleSearch.focus();
}

function closeBrowser(returnFocus) {
  exampleBrowser.hidden = true;
  exampleTrigger.setAttribute('aria-expanded', 'false');
  resetExampleFilters();
  setActive(null);
  if (returnFocus) exampleTrigger.focus();
}

// Click an option (or Enter on the active one) -> load it + close.
function commitOption(opt) {
  selectExample(opt.dataset.name);
  closeBrowser(true);
}

// Same focus discipline as the listbox: don't let a trigger mousedown blur the
// open panel's search (which would focusout-close it, so the click then re-opens
// a "closed" panel and the toggle never closes). Focus is managed explicitly by
// open/closeBrowser. Keyboard activation (Enter/Space, ArrowDown) is unaffected.
exampleTrigger.addEventListener('mousedown', (e) => e.preventDefault());
exampleTrigger.addEventListener('click', () => {
  if (exampleBrowser.hidden) openBrowser();
  else closeBrowser(true);
});
exampleTrigger.addEventListener('keydown', (e) => {
  // Enter/Space natively click the button (-> open); ArrowDown needs a hand.
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    openBrowser();
  }
});

galleryBtn.addEventListener('click', openGallery);
galleryClose.addEventListener('click', closeGallery);

gallerySearch.addEventListener('input', renderGallery);
for (const filter of [galleryType, galleryDifficulty, galleryTier, galleryLicense]) {
  filter.addEventListener('change', renderGallery);
}
galleryClear.addEventListener('click', () => {
  resetGalleryFilters();
  renderGallery();
  gallerySearch.focus();
});

galleryGrid.addEventListener('click', (e) => {
  const target = /** @type {Element} */ (e.target);
  const card = /** @type {HTMLElement | null} */ (target.closest('.gallery-card'));
  if (!card) return;
  selectExample(card.dataset.name);
  closeGallery();
});

exampleSearch.addEventListener('input', () => {
  renderList();
  // Roving resets to the first visible row so Enter selects the top result
  // (a head would never commit, so default the active item to an option).
  setActive(visibleOptions()[0] ?? null);
});

exampleClear.addEventListener('mousedown', (e) => e.preventDefault());
exampleClear.addEventListener('click', () => {
  resetExampleFilters();
  renderList();
  setActive(visibleOptions()[0] ?? null);
  exampleSearch.focus();
});

for (const filter of [exampleType, exampleDifficulty, exampleTier, exampleLicense]) {
  filter.addEventListener('change', () => {
    renderList();
    setActive(visibleOptions()[0] ?? null);
  });
}

exampleSearch.addEventListener('keydown', (e) => {
  const items = navItems();
  const idx = items.indexOf(activeItem);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActiveTo(idx + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActiveTo(idx - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    moveActiveTo(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    moveActiveTo(items.length - 1);
  } else if (e.key === 'ArrowRight') {
    // On a head: expand. On a row: undefined, so leave the search caret move be.
    if (isHead(activeItem)) {
      e.preventDefault();
      setGroupCollapsed(groupFor(activeItem), false);
    }
  } else if (e.key === 'ArrowLeft') {
    // On a head: collapse. On a row: jump to that row's category head.
    if (isHead(activeItem)) {
      e.preventDefault();
      setGroupCollapsed(groupFor(activeItem), true);
    } else if (activeItem) {
      e.preventDefault();
      setActive(groupFor(activeItem).headEl);
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (isHead(activeItem)) setGroupCollapsed(groupFor(activeItem), false);
    else if (activeItem) commitOption(activeItem);
  } else if (e.key === ' ') {
    // Space activates a head (expand); on a row it must still type into search.
    if (isHead(activeItem)) {
      e.preventDefault();
      setGroupCollapsed(groupFor(activeItem), false);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeBrowser(true);
  }
});

// Keep DOM focus on the search when a head/option (non-focusable divs) is
// clicked: without this the mousedown blurs the input, firing focusout -> close
// BEFORE the click resolves. preventDefault leaves the click intact, focus on
// search; navigation stays driven by aria-activedescendant.
exampleListbox.addEventListener('mousedown', (e) => e.preventDefault());

// Click delegation: a head click toggles its category's collapse (and ropes the
// roving onto that head); an option click loads it. A click that lands on
// neither (padding / the empty note) selects nothing.
exampleListbox.addEventListener('click', (e) => {
  const target = /** @type {Element} */ (e.target);
  const head = target.closest('.ex-group-head');
  if (head) {
    toggleGroup(groupFor(head));
    setActive(head);
    return;
  }
  const opt = target.closest('.ex-option');
  if (!opt) return;
  commitOption(opt);
});

// Outside pointerdown closes WITHOUT stealing focus back to the trigger.
document.addEventListener('pointerdown', (e) => {
  if (exampleBrowser.hidden) return;
  if (exampleField.contains(/** @type {Node} */ (e.target))) return;
  closeBrowser(false);
});

// Tab past the panel (focus leaves the subtree) closes it. A focusout fired
// after we already closed (the programmatic focus handoff to the trigger), or a
// focus move that stays inside the panel, is ignored.
exampleBrowser.addEventListener('focusout', (e) => {
  if (exampleBrowser.hidden) return;
  if (exampleBrowser.contains(/** @type {Node} */ (e.relatedTarget))) return;
  closeBrowser(false);
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

// Repaint the syntax overlay from the current text. Cheap synchronous string
// scan (no debounce: that's only for the render in the live-draft section), so
// it sits beside every renderGutter() call site. The HTML is byte-escaped in
// highlight.js, so it can never break or inject markup.
function paintHighlight() {
  editorCode.innerHTML = highlight(editor.value);
}

// Keep the gutter and syntax overlay aligned as the textarea scrolls. The
// overlay never scrolls itself; we translate #editor-code with a GPU transform
// rather than writing scrollTop (a scroll-linked scrollTop write repaints the
// whole colored layer each tick and stutters on big scenes).
function syncEditorScroll() {
  gutter.scrollTop = editor.scrollTop;
  editorCode.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  positionErrorLine(); // keep the error band aligned with its line as the editor scrolls
  // Keep an open completion popup glued to the caret as the textarea scrolls.
  if (isCompleteOpen()) positionComplete();
}
editor.addEventListener('scroll', syncEditorScroll);
editor.addEventListener('input', () => {
  restoreNote.hidden = true; // a fresh edit supersedes the restore-a-replaced-scene offer
  clearErrorLine(); // the edit may well fix the error; drop the stale marker
  closeFind(false); // editing invalidates the match set; the bar simply closes
  renderGutter();
  paintHighlight();
  refreshComplete(false);
  buildSliders();
  updateSceneActions();
  scheduleSave();
  scheduleDraft({ sourceChanged: true });
});
renderGutter();
paintHighlight();
updateSceneActions();

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

// ---- editor line operations (comment toggle, move, duplicate) + keyboard
//      number stepping ----
// All of these are keyboard edits that bypass the textarea's input event
// (setRangeText fires none), so each successful edit runs refreshAfterEdit for
// the same bookkeeping a keystroke gets via the input handler.

// The post-edit refresh for setRangeText keyboard edits: same supersede/cleanup
// the input handler does (a fresh edit replaces the restore offer and may well
// fix the blamed error line), then the standard repaint + slider re-parse (the
// edit shifted literal spans) + save/draft debounces.
function refreshAfterEdit() {
  restoreNote.hidden = true;
  clearErrorLine();
  renderGutter();
  paintHighlight();
  buildSliders();
  scheduleSave();
  scheduleDraft();
}

// The whole-line span [start, end) covering the selection, end EXCLUSIVE of the
// trailing newline. A multi-line selection ending at column 0 (how a
// shift+down full-line sweep lands) does NOT pull in that final line, so the
// line ops act on exactly the lines that look selected.
function selectedLineRange() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const start = value.lastIndexOf('\n', s - 1) + 1;
  const endRef = e > s && value[e - 1] === '\n' ? e - 1 : e;
  const nl = value.indexOf('\n', endRef);
  return { start, end: nl === -1 ? value.length : nl };
}

// Ctrl/Cmd+/: toggle `//` line comments on the selected line(s). Uncomment only
// when EVERY non-blank line is already commented (mixed blocks comment, so the
// toggle is idempotent over a mixed region); blank lines never gain a marker.
// Returns false (no edit) for an all-blank block.
function toggleLineComment() {
  const { selectionStart: s, selectionEnd: e } = editor;
  const { start, end } = selectedLineRange();
  const block = editor.value.slice(start, end);
  const lines = block.split('\n');
  const nonBlank = lines.filter((l) => l.trim() !== '');
  const uncomment = nonBlank.length > 0 && nonBlank.every((l) => /^[ \t]*\/\//.test(l));
  const out = lines
    .map((l) => {
      if (l.trim() === '') return l;
      return uncomment ? l.replace(/^([ \t]*)\/\/ ?/, '$1') : '// ' + l;
    })
    .join('\n');
  if (out === block) return false;
  if (block.includes('\n')) {
    editor.setRangeText(out, start, end, 'select'); // keep the block selected, like indent
    return true;
  }
  // Single line: shift the caret/selection by the marker delta (clamped into
  // the rewritten line) so typing can resume where it left off.
  const delta = out.length - block.length;
  editor.setRangeText(out, start, end, 'preserve');
  editor.setSelectionRange(
    clamp(s + delta, start, start + out.length),
    clamp(e + delta, start, start + out.length)
  );
  return true;
}

// Alt+Up/Down: swap the selected line block with the adjacent line in ONE
// setRangeText (a single undo step), then re-anchor the selection onto the
// moved text. No-ops (returns false) at the buffer's first/last line.
function moveLines(dir) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const { start, end } = selectedLineRange();
  const block = value.slice(start, end);
  if (dir < 0) {
    if (start === 0) return false;
    const prevStart = value.lastIndexOf('\n', start - 2) + 1;
    const prev = value.slice(prevStart, start - 1);
    editor.setRangeText(block + '\n' + prev, prevStart, end, 'preserve');
    editor.setSelectionRange(s - prev.length - 1, e - prev.length - 1);
  } else {
    if (end === value.length) return false;
    const nextEnd = value.indexOf('\n', end + 1);
    const stop = nextEnd === -1 ? value.length : nextEnd;
    const next = value.slice(end + 1, stop);
    editor.setRangeText(next + '\n' + block, start, stop, 'preserve');
    editor.setSelectionRange(s + next.length + 1, e + next.length + 1);
  }
  return true;
}

// Alt+Shift+Up/Down: duplicate the selected line block. Down keeps the
// selection on the LOWER copy (repeats stamp the block downward); Up keeps it
// on the upper copy, so the caret visually stays put.
function duplicateLines(dir) {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  const { start, end } = selectedLineRange();
  const block = value.slice(start, end);
  editor.setRangeText(block + '\n' + block, start, end, 'preserve');
  if (dir > 0) editor.setSelectionRange(s + block.length + 1, e + block.length + 1);
  else editor.setSelectionRange(s, e);
  return true;
}

// The number token Alt+arrows should step, or null when they should fall
// through to the line ops: a collapsed caret on a literal, or a selection that
// is EXACTLY a literal (how stepNumber leaves it, so held/repeated presses keep
// stepping). Any other selection means the user is operating on lines.
function stepTokenAtCaret() {
  const { selectionStart: s, selectionEnd: e } = editor;
  const tok = numberTokenAt(editor.value, s);
  if (!tok) return null;
  if (s !== e && (s !== tok.start || e !== tok.end)) return null;
  return tok;
}

// Keyboard scrubbing: step the literal by the same magnitude-aware step the
// Alt+drag scrub uses (sliders.js scrubStep/formatScrubbed), 10x with Shift,
// and leave the whole new literal selected for stepTokenAtCaret above.
function stepNumber(tok, dir, big) {
  const step = scrubStep(tok.value);
  const literal = formatScrubbed(tok.value + dir * step * (big ? 10 : 1), step);
  editor.setRangeText(literal, tok.start, tok.end, 'preserve');
  editor.setSelectionRange(tok.start, tok.start + literal.length);
  return true;
}

let escapePrimed = false;
editor.addEventListener('keydown', (e) => {
  // Autocomplete takes navigation keys while open (and Ctrl+Space opens it);
  // anything it doesn't consume falls through to the Tab/Escape editor logic.
  if (handleCompleteKeydown(e)) return;
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
    paintHighlight();
    scheduleSave();
    scheduleDraft();
    return;
  }
  if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.altKey) {
    e.preventDefault();
    escapePrimed = false;
    if (toggleLineComment()) refreshAfterEdit();
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    escapePrimed = false;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    // Precedence: a number token under the caret takes the chord (step it,
    // Shift = 10x); otherwise Alt+arrows move lines and Alt+Shift duplicates.
    // The sign flips for stepping: ArrowUp moves a line UP (-1 in offsets) but
    // steps a number's value UP (+1).
    const tok = stepTokenAtCaret();
    const edited = tok
      ? stepNumber(tok, -dir, e.shiftKey)
      : e.shiftKey
        ? duplicateLines(dir)
        : moveLines(dir);
    if (edited) refreshAfterEdit();
    return;
  }
  if (e.key !== 'Shift') escapePrimed = false;
});
editor.addEventListener('blur', () => {
  escapePrimed = false;
  closeComplete(); // focus left the editor (clicking a popup item keeps focus, so it doesn't fire here)
  editor.style.cursor = ''; // clear any Alt-held scrub cursor
});

// ---- editor autocomplete (SDL keywords + the shipped include library) ----
// The popup is anchored at the caret inside #editor-stack (above the
// transparent textarea). All the ranking/insertion logic is the pure
// complete.js; this section is the DOM: caret measurement, keyboard nav, and
// rendering. Candidate data is the language vocabulary (from highlight.js, via
// complete.js) plus the include-library symbols fetched from the generated
// includes-manifest.json. Until that fetch lands, keyword/builtin completion
// already works, so a slow or failed fetch never blocks the editor.

let completePool = buildPool();
fetch('./includes-manifest.json')
  .then((r) => r.json())
  .then((data) => {
    completePool = buildPool(data.symbols);
    // Readiness signal for tests (and any future "symbols loaded" affordance).
    editor.setAttribute('data-complete-ready', '');
  })
  /* c8 ignore next -- manifest fetch failure leaves keyword-only completion; the offline test harness always serves the file */
  .catch(() => {});

/** @type {{ from: number, to: number, query: string, items: import('./complete.js').Candidate[] } | null} */
let completeState = null;
let completeActive = 0;
// The token start the user dismissed with Escape, so typing more of the SAME
// token stays quiet; moving to a new token reopens. -1 means nothing suppressed.
let suppressedFrom = -1;

const COMPLETE_ACCEPT = new Set(['Enter', 'Tab']);
const COMPLETE_CARET_MOVE = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

function isCompleteOpen() {
  return completeState !== null;
}

// Off-screen mirror of the textarea used to measure the caret's pixel position
// (textareas expose no caret coordinates). Created once, reused; every metric
// that affects glyph advance is copied so the measured x/y match the real text.
let caretMirror;
function measureCaret(index) {
  if (!caretMirror) {
    caretMirror = document.createElement('div');
    caretMirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(caretMirror);
  }
  const cs = getComputedStyle(editor);
  const s = caretMirror.style;
  s.position = 'absolute';
  s.visibility = 'hidden';
  s.top = '0';
  s.left = '-9999px';
  s.whiteSpace = 'pre';
  s.overflow = 'hidden';
  s.margin = '0';
  s.border = '0';
  for (const prop of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'tabSize',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
  ]) {
    s[prop] = cs[prop];
  }
  caretMirror.textContent = editor.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = editor.value.slice(index) || '.';
  caretMirror.appendChild(marker);
  const coords = {
    left: marker.offsetLeft,
    top: marker.offsetTop,
    // #editor sets a unitless line-height (styles.css), which always computes to
    // a px value, so parseFloat is safe here (never 'normal'/NaN).
    lineHeight: parseFloat(cs.lineHeight),
  };
  caretMirror.textContent = '';
  return coords;
}

// Place the popup at the caret: below the line by default, flipped above when
// there isn't room below, and clamped horizontally so it's always fully visible.
function positionComplete() {
  const caret = measureCaret(completeState.to);
  const stackW = editorStack.clientWidth;
  const stackH = editorStack.clientHeight;
  const boxW = completeBox.offsetWidth;
  const boxH = completeBox.offsetHeight;
  const left = Math.max(0, Math.min(caret.left - editor.scrollLeft, stackW - boxW));
  const lineTop = caret.top - editor.scrollTop;
  const below = lineTop + caret.lineHeight;
  // Flip above the caret line when the popup wouldn't fit below it, so it never
  // covers the line being typed near the editor's bottom edge.
  const top = below + boxH <= stackH ? below : Math.max(0, lineTop - boxH);
  completeBox.style.left = `${left}px`;
  completeBox.style.top = `${top}px`;
}

function setActiveDescendant() {
  editor.setAttribute('aria-activedescendant', `complete-opt-${completeActive}`);
}

// Build the option rows. Each row: the name (with a dim macro signature when it
// takes args) on the left, the kind tag, and the include file (provenance) on
// the right. The name truncates with an ellipsis so long macro signatures never
// push the kind/file out of view.
function renderComplete() {
  const frag = document.createDocumentFragment();
  completeState.items.forEach((c, i) => {
    const li = document.createElement('li');
    li.id = `complete-opt-${i}`;
    li.className = i === completeActive ? 'cmp-item is-active' : 'cmp-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === completeActive ? 'true' : 'false');
    li.dataset.index = String(i);

    const name = document.createElement('span');
    name.className = 'cmp-name';
    name.textContent = c.name;
    const sig = signatureText(c);
    if (sig) {
      const sigEl = document.createElement('span');
      sigEl.className = 'cmp-sig';
      sigEl.textContent = sig;
      name.appendChild(sigEl);
    }
    li.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'cmp-meta';
    meta.textContent = c.kind;
    li.appendChild(meta);

    // Include-library provenance, shown inline (not just on hover) so a texture's
    // origin reads the way scenes refer to it ("stones.inc"). Vocabulary and
    // scene-local symbols carry no file, so they get just the kind tag.
    if (c.file) {
      const file = document.createElement('span');
      file.className = 'cmp-file';
      file.textContent = c.file;
      li.appendChild(file);
    }

    // mousedown keeps editor focus (so the textarea doesn't blur); click accepts.
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => {
      completeActive = i;
      acceptActive();
    });
    frag.appendChild(li);
  });
  completeBox.replaceChildren(frag);
  setActiveDescendant();
}

// Announce the active row to the visually-hidden live region. The editor stays a
// plain textbox (a multiline combobox role is ill-defined for screen readers),
// so this speaks the selection rather than leaning on aria-activedescendant alone.
function announceComplete() {
  const item = completeState.items[completeActive];
  const where = item.file ? `, ${item.file}` : '';
  completeStatus.textContent =
    `${item.name}${signatureText(item)} ${item.kind}${where}, ` +
    `${completeActive + 1} of ${completeState.items.length}`;
}

function showComplete(res) {
  completeState = res;
  completeActive = 0;
  renderComplete();
  completeBox.hidden = false;
  positionComplete();
  editor.setAttribute('aria-expanded', 'true');
  announceComplete();
}

function closeComplete() {
  if (completeState === null) return;
  completeState = null;
  completeBox.hidden = true;
  completeBox.replaceChildren();
  editor.setAttribute('aria-expanded', 'false');
  editor.removeAttribute('aria-activedescendant');
}

// Recompute completions for the caret. `force` (Ctrl+Space) opens even on an
// empty token and ignores a prior Escape dismissal. Auto-open waits for 3 chars
// so it stays quiet while typing rather than popping on every 2-letter prefix.
function refreshComplete(force) {
  const res = complete(editor.value, editor.selectionStart, completePool, {
    minLength: force ? 0 : 3,
  });
  if (!res) {
    closeComplete();
    suppressedFrom = -1;
    return;
  }
  if (!force && suppressedFrom === res.from) {
    closeComplete();
    return;
  }
  suppressedFrom = -1;
  showComplete(res);
}

function moveActive(delta) {
  const n = completeState.items.length;
  completeActive = (completeActive + delta + n) % n;
  for (const el of completeBox.children) {
    const li = /** @type {HTMLElement} */ (el);
    const on = Number(li.dataset.index) === completeActive;
    li.classList.toggle('is-active', on);
    li.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  setActiveDescendant();
  completeBox.children[completeActive].scrollIntoView({ block: 'nearest' });
  announceComplete();
}

// Insert the active candidate via setRangeText so the native undo stack stays
// intact, then place the caret where complete.js wants it (inside a macro's
// parens, or after the inserted name).
function acceptActive() {
  const item = completeState.items[completeActive];
  const { from, to } = completeState;
  const out = applyCompletion(editor.value, { from, to }, item);
  const afterLen = editor.value.length - to;
  const insert = out.text.slice(from, out.text.length - afterLen);
  editor.setRangeText(insert, from, to, 'preserve');
  editor.selectionStart = editor.selectionEnd = out.caret;
  closeComplete();
  suppressedFrom = -1;
  renderGutter();
  paintHighlight();
  scheduleSave();
  scheduleDraft();
}

// Returns true when the key was consumed by completion (so the caller stops).
function handleCompleteKeydown(e) {
  if (e.ctrlKey && e.code === 'Space') {
    refreshComplete(true);
    e.preventDefault();
    return true;
  }
  if (!isCompleteOpen()) return false;
  if (e.key === 'ArrowDown') {
    moveActive(1);
    e.preventDefault();
    return true;
  }
  if (e.key === 'ArrowUp') {
    moveActive(-1);
    e.preventDefault();
    return true;
  }
  if (COMPLETE_ACCEPT.has(e.key)) {
    acceptActive();
    e.preventDefault();
    return true;
  }
  if (e.key === 'Escape') {
    suppressedFrom = completeState.from;
    closeComplete();
    e.preventDefault();
    e.stopPropagation(); // don't also abort an in-flight render
    return true;
  }
  if (COMPLETE_CARET_MOVE.has(e.key)) {
    closeComplete();
    return false; // let the caret actually move
  }
  return false;
}

// ---- scene editing primitives (shared by the example browser, the drop import
//      module, and the restore-scene undo) ----

// One in-session recovery copy of the scene the user had edited, kept so a
// replace (example switch or scene drop) past the confirm() is still undoable.
let stashedScene = '';

// Capture the about-to-be-replaced scene and reveal the restore affordance. The
// copy lives in memory only (the undo is for the current session, and the note
// clears on the next edit), so there's no localStorage to leave behind.
function stashScene() {
  stashedScene = editor.value;
  restoreNote.hidden = false;
}

// Restore the stashed scene and dismiss the note. Wired to the restore link.
function restoreScene() {
  editor.value = stashedScene;
  restoreNote.hidden = true;
  reflectSceneReplaced();
}

// Reflect a wholesale, programmatic replacement of the editor text (example
// switch, scene drop, permalink hydrate, restore): repaint the gutter/overlay,
// rebuild the scene-params panel for the NEW source, and reschedule save+draft.
// Direct keystrokes go through the input handler, which runs the same set; this
// is the path for the cases that assign editor.value (no input event fires, so
// the panel would otherwise show the previous scene's params).
/** @param {{ autoDraft?: boolean }} [opts] */
function reflectSceneReplaced({ autoDraft = true } = {}) {
  renderGutter();
  paintHighlight();
  buildSliders();
  updateSceneActions();
  scheduleSave();
  liveDraftController.resumeAuto(); // a new scene gets a fresh slow-draft verdict
  if (autoDraft) scheduleDraft();
  else liveDraftController.cancel();
}

function resetSceneToExample() {
  if (!canResetScene()) return;
  replaceScene(lastLoadedSource);
}

// Replace the whole scene with `text`, stashing the outgoing one first so the swap
// is undoable via the restore note. Shared by the scene-drop import and loading a
// version from history.
function replaceScene(text) {
  stashScene();
  editor.value = text;
  reflectSceneReplaced();
}

// Insert text at the caret, advancing past it, and resync the overlay/gutter and
// the save + live-draft schedules (setRangeText fires no input event). A
// newline is prefixed unless the caret is already at the start of a line, so a
// dropped declare never splits a token mid-line.
function insertAtCaret(text) {
  const at = editor.selectionStart;
  const atLineStart = at === 0 || editor.value[at - 1] === '\n';
  editor.setRangeText(atLineStart ? text : '\n' + text, at, editor.selectionEnd, 'end');
  renderGutter();
  paintHighlight();
  scheduleSave();
  scheduleDraft();
}

// Drag-and-drop asset import lives in its own module; it owns the staged-asset
// registry, the chips, and the drop wiring, and calls back here to mutate the
// editor (insert a snippet, or replace the scene the way an example switch does).
const assetDrop = createAssetDrop({
  insertSnippet: insertAtCaret,
  replaceScene,
});

// ---- scene history ----
// A lightweight, text-only record of previously RENDERED scene versions, so a user
// can jump back to one. Captured only on a successful still render (never on a
// keystroke or the live draft), deduped + capped, persisted in its own localStorage
// key. Loading a version replaces the scene (undoable via the restore note).
/** @type {import('./history.js').Snapshot[]} */
let sceneHistory = loadSnapshots(localStorage, HISTORY_KEY);

// Snapshot `source` as a new version, unless it duplicates the newest one. Returns
// early (no save/re-render) on a dedup so a re-render of the same text is free.
function recordHistory(source) {
  const next = addSnapshot(sceneHistory, source, Date.now(), HISTORY_MAX);
  if (next === sceneHistory) return;
  sceneHistory = next;
  saveSnapshots(localStorage, HISTORY_KEY, sceneHistory);
  renderHistory();
}

function renderHistory() {
  historyDetails.hidden = sceneHistory.length === 0;
  historyCount.textContent = sceneHistory.length ? `(${sceneHistory.length})` : '';
  const now = Date.now();
  historyList.replaceChildren();
  for (const entry of sceneHistory) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-entry';
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = relativeTime(entry.t, now);
    const preview = document.createElement('span');
    preview.className = 'history-preview';
    preview.textContent = snapshotPreview(entry.source);
    // Dim line delta vs the CURRENT editor text ("+2 −5"), or "current" when
    // identical. Recomputed when the list rebuilds (render milestone or panel
    // open), never per keystroke.
    const delta = lineDelta(entry.source, editor.value);
    const badge = document.createElement('span');
    badge.className = 'history-delta';
    const deltaText = delta === null ? 'current' : `+${delta.added} −${delta.removed}`;
    badge.textContent = deltaText;
    const meta = document.createElement('span');
    meta.className = 'history-meta';
    meta.append(time, badge);
    row.title = `${preview.textContent} · ${time.textContent} · ${deltaText}`;
    row.setAttribute('aria-label', `Load history version: ${row.title}`);
    row.append(preview, meta);
    row.addEventListener('click', () => {
      replaceScene(entry.source);
      historyDetails.open = false; // collapse once a version is loaded
    });
    historyList.appendChild(row);
  }
}
renderHistory(); // restore the panel from a prior session's localStorage

// Refresh the relative times when the panel is opened (they're stamped at render
// time and would otherwise read stale).
historyDetails.addEventListener('toggle', () => {
  if (historyDetails.open) renderHistory();
});

// ---- live numeric controls: auto-sliders + inline scrub ----
// Every top-level `#declare NAME = <number>` gets a slider; dragging it rewrites
// the literal in place. Alt+dragging any numeric literal in the editor scrubs it
// the same way. Both edit the source text directly (setRangeText keeps undo and
// the scene-as-single-source-of-truth intact) and re-render via the live draft.
// parseDeclaredNumbers / numberTokenAt / formatScrubbed are the pure half.

/**
 * @type {{ name: string, start: number, end: number, step: number,
 *   input: HTMLInputElement, readout: HTMLElement | null }[]}
 */
let sliderModels = [];

// A scene with more than this many params opens collapsed, so a busy scene (loop
// counters, lots of declares) doesn't wall off the editor. The auto open/close is
// applied only when the panel first appears (see buildSliders): once it's showing,
// the user's manual toggle wins, since typing rebuilds the rows on every keystroke.
const SCENE_PARAMS_OPEN_MAX = 4;
let sceneParamsWasEmpty = true;

// The panel is rebuilt from the source on every edit, so a slider's DEFAULT is
// always the number currently written in the code: editing `#declare A = 5` to
// `= 20` makes 20 the new default and the new slider position. A drag/scrub does
// NOT rebuild (setRangeText fires no input event), so the default survives a drag
// and the per-slider reset restores it.
function buildSliders() {
  slidersPanel.replaceChildren();
  sliderModels = parseDeclaredNumbers(editor.value).map((n) => {
    const literal = editor.value.slice(n.start, n.end); // the exact source text
    const row = document.createElement('label');
    row.className = 'slider-row';
    const name = document.createElement('span');
    name.className = 'slider-name';
    name.textContent = n.name;
    const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
    input.type = 'range';
    input.min = String(n.min);
    input.max = String(n.max);
    input.step = String(n.step);
    input.value = String(n.value);
    const readout = document.createElement('span');
    readout.className = 'slider-value';
    readout.textContent = literal; // mirror the source literal until it's moved
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'slider-reset';
    reset.textContent = '↺';
    reset.title = `Reset ${n.name} to ${literal}`;
    reset.setAttribute('aria-label', reset.title);
    /** @type {(typeof sliderModels)[number]} */
    const model = { name: n.name, start: n.start, end: n.end, step: n.step, input, readout };
    input.addEventListener('input', () =>
      writeLiteralText(model, formatScrubbed(Number(input.value), model.step))
    );
    reset.addEventListener('click', () => {
      input.value = String(n.value);
      writeLiteralText(model, literal); // restore the ORIGINAL literal text, byte for byte
    });
    row.append(name, input, readout, reset);
    slidersPanel.appendChild(row);
    return model;
  });
  const count = sliderModels.length;
  sceneParamsCount.textContent = count ? `(${count})` : '';
  sceneParams.hidden = count === 0;
  // Set the open state only as the region appears (empty -> populated); leave a
  // showing panel's open/closed alone so a rebuild-on-keystroke can't slam shut a
  // panel the user just expanded.
  if (count > 0 && sceneParamsWasEmpty) {
    sceneParams.open = count <= SCENE_PARAMS_OPEN_MAX;
  }
  sceneParamsWasEmpty = count === 0;
}

// Rewrite a tracked literal to the exact text `literal`, keeping the spans of the
// OTHER tracked literals correct (a shorter/longer number shifts everything after
// it). Shared by the sliders, the reset, and the inline scrub; never regenerates
// the panel, so a drag stays smooth (setRangeText fires no input event). The
// equal-start case (scrubbing a declared number's own literal) is deliberately
// left unshifted: that slider's stale span is fixed by the mouseup rebuild.
function writeLiteralText(model, literal) {
  const delta = literal.length - (model.end - model.start);
  editor.setRangeText(literal, model.start, model.end, 'preserve');
  model.end = model.start + literal.length;
  for (const m of sliderModels) {
    if (m.start > model.start) {
      m.start += delta;
      m.end += delta;
    }
  }
  if (model.readout) model.readout.textContent = literal;
  renderGutter();
  paintHighlight();
  scheduleSave();
  scheduleDraft();
}

/** @type {{ start: number, end: number, step: number, readout: null } | null} */
let scrubModel = null;
let scrubStartX = 0;
let scrubStartValue = 0;

// One monospace glyph's width, measured off-screen with the editor's font.
function measureCharWidth(cs) {
  const probe = document.createElement('span');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing']) probe.style[p] = cs[p];
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'pre';
  probe.textContent = '0'.repeat(20);
  document.body.appendChild(probe);
  const w = probe.offsetWidth / 20;
  probe.remove();
  return w;
}

// Map a pointer position to a character offset in the textarea via the monospace
// metrics + scroll, or -1 when the point is outside the text. Tabs are expanded
// to their tab stops (a tab is one character but advances to the next multiple
// of tab-size columns), so the offset is right on tab-indented lines.
function offsetFromPoint(clientX, clientY) {
  const rect = editor.getBoundingClientRect();
  const cs = getComputedStyle(editor);
  const x = clientX - rect.left - parseFloat(cs.paddingLeft) + editor.scrollLeft;
  const y = clientY - rect.top - parseFloat(cs.paddingTop) + editor.scrollTop;
  const lines = editor.value.split('\n');
  const row = Math.floor(y / parseFloat(cs.lineHeight));
  if (row < 0 || row >= lines.length) return -1;
  let off = 0;
  for (let i = 0; i < row; i++) off += lines[i].length + 1;
  const targetCol = Math.round(x / measureCharWidth(cs));
  const tabSize = parseInt(cs.tabSize, 10);
  const line = lines[row];
  let col = 0;
  let i = 0;
  while (i < line.length && col < targetCol) {
    col += line[i] === '\t' ? tabSize - (col % tabSize) : 1;
    i++;
  }
  return off + i;
}

editor.addEventListener('mousedown', (e) => {
  if (!e.altKey) return; // plain drag stays a text selection
  const tok = numberTokenAt(editor.value, offsetFromPoint(e.clientX, e.clientY));
  if (!tok) return;
  e.preventDefault(); // suppress the selection an alt-drag would otherwise start
  scrubModel = { start: tok.start, end: tok.end, step: scrubStep(tok.value), readout: null };
  scrubStartX = e.clientX;
  scrubStartValue = tok.value;
});

document.addEventListener('mousemove', (e) => {
  if (!scrubModel) return;
  const value = scrubStartValue + (e.clientX - scrubStartX) * scrubModel.step;
  writeLiteralText(scrubModel, formatScrubbed(value, scrubModel.step));
});

document.addEventListener('mouseup', () => {
  if (!scrubModel) return;
  scrubModel = null;
  buildSliders(); // refresh any slider that tracks the just-scrubbed literal
});

// Holding Alt reveals that editor numbers are scrubbable (the only affordance the
// otherwise-invisible scrub gets); the cursor clears on release or on blur.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') editor.style.cursor = 'ew-resize';
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt') editor.style.cursor = '';
});

buildSliders(); // initial panel from the loaded scene

// ---- controls ----

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// True when a <select> currently offers `value`. The option set lives in the
// DOM, so the saved/URL/permalink hydration paths all validate against it here
// rather than trusting an out-of-range value.
function selectAllows(select, value) {
  return [...select.options].some((o) => o.value === value);
}

// Read + clamp the controls into render options WITHOUT writing back to the
// inputs. The draft path uses this so an auto-render never clobbers the
// width/height fields the user is mid-typing.
function readRenderOptions() {
  let width = parseInt(widthInput.value, 10);
  if (Number.isNaN(width)) width = 512;
  width = clamp(width, 8, 2048);

  let height = parseInt(heightInput.value, 10);
  if (Number.isNaN(height)) height = 384;
  height = clamp(height, 8, 2048);

  const quality = qualitySelect.value === '' ? undefined : Number(qualitySelect.value);
  const antialias = antialiasSelect.value === 'off' ? false : Number(antialiasSelect.value);

  let threads;
  const threadsRaw = parseInt(threadsInput.value, 10);
  if (!Number.isNaN(threadsRaw)) threads = clamp(threadsRaw, 1, 32);

  return { width, height, quality, antialias, threads };
}

// One-shot final-quality override, armed by Shift+Ctrl/Cmd+Enter: the next
// explicit render runs at quality 9 + antialias 0.05 without touching the
// persisted control values. A module flag rather than a startRender argument
// because the draft-abort handoff re-enters startRender() through the
// live-draft controller with no arguments; collectOptions consumes it at the
// moment the options are actually read, and startRender's bail paths disarm it
// so a swallowed chord can't silently upgrade a LATER plain render.
let finalRenderOnce = false;

// The explicit-render path: read + clamp, then write the clamped dims back into
// the inputs so the UI always shows the values actually used. Raw flags from the
// advanced field ride along as `args`, which the wrapper appends LAST on the
// command line so they override the structured +W/+H/+Q/+A flags (last-wins).
// Drafts deliberately skip this (they build their own fast opts) so a heavy flag
// never bogs down the live preview.
function collectOptions() {
  const opts = readRenderOptions();
  if (finalRenderOnce) {
    finalRenderOnce = false;
    opts.quality = 9;
    opts.antialias = 0.05;
  }
  widthInput.value = String(opts.width);
  heightInput.value = String(opts.height);
  opts.files = assetDrop.assetFiles(); // undefined when no assets are loaded; the wrapper skips it
  const args = parseFlags(flagsInput.value);
  return args.length ? { ...opts, args } : opts;
}

for (const el of [
  widthInput,
  heightInput,
  qualitySelect,
  antialiasSelect,
  draftSelect,
  threadsInput,
  framesInput,
  fpsInput,
]) {
  el.addEventListener('change', scheduleSave);
}

// A new draft edge makes the last preview the wrong size: clear the "already
// attempted this source" guard so the unchanged scene re-drafts at the new
// resolution (scheduleDraft self-guards on mode/live-off).
draftSelect.addEventListener('change', () => {
  liveDraftController.resetAttempted();
  scheduleDraft();
});

// The raw-flags field is free text, so persist + re-sync the permalink as it is
// typed (input, not just change-on-blur), matching the editor's live behavior.
flagsInput.addEventListener('input', scheduleSave);

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

// Swap width and height (portrait <-> landscape), then run the same handling
// the inputs themselves are wired to: re-aspect the empty-state plate (their
// input listener) and persist (their change listener). The next render/draft
// reads the inputs fresh, so nothing else needs poking.
const swapSizeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('swap-size'));
swapSizeBtn.addEventListener('click', () => {
  const w = widthInput.value;
  widthInput.value = heightInput.value;
  heightInput.value = w;
  updateHintAspect();
  scheduleSave();
});

const faviconLink = /** @type {HTMLLinkElement} */ (document.querySelector('link[rel="icon"]'));
const {
  setStatus,
  setBusyStatus,
  syncSpinner,
  progressStart,
  progressPercent,
  progressDeterminate,
  progressStop,
  appendLogLine,
  setProgressLine,
  commitProgressLine,
  resetLog,
  setLogSummary,
} = createRenderFeedback({
  status,
  statusSpinner,
  stopBtn,
  progressBar,
  log,
  logDetails,
  logLabel,
  logCount,
  faviconLink,
  isDrafting: () => liveDraftController.isDrafting(),
});

// ---- image zoom (fit / 1:1 / 4x) ----
// The meta-row button is the accessible path; clicking the image is the
// bonus pointer shortcut. Both cycle fit -> 1:1 -> 4x -> fit; the image
// click additionally anchors the zoom on the clicked point, and a drag pans
// the zoomed image (see the plate pointer handlers below). The 4x step is
// the pixel-peep: sub-pixel options (the 0.05 antialias threshold) are
// invisible without it. .zoom-1x styling (max-width: none, pixelated, plate
// overflow) lives in styles.css and covers both zoomed steps; the 4x width
// is written inline because it derives from naturalWidth, which CSS can't
// read.

const outputPlate = /** @type {HTMLElement} */ (document.getElementById('output-plate'));

// 0 = fit (CSS max-width scaling), 1 = 1:1 device pixels, 2 = 4x pixel-peep.
let zoomLevel = 0;

// Set when a press on the image/plate was consumed as a drag-pan or a
// hold-to-peek: the browser still synthesizes a click on release, and that
// click must not ALSO cycle the zoom. Consumed by the plate click handler.
let suppressClick = false;

// Live drafts render downscaled (DRAFT_MAX_EDGE) but must not shrink the hero
// plate: the page below would pump in height on every keystroke between a full
// render and the next draft. The draft path holds #output at the full render's
// display width (the upscale softness is the accepted trade); CSS
// max-width:100% still clamps the held width to the plate. A full render
// clears the hold, and 1:1 zoom suspends it (1:1 promises true device pixels,
// which a held upscale would contradict).
/** @type {number | null} */
let heldWidth = null;

// One owner for #output's inline width: the 4x peep beats a draft's footprint
// hold (a zoom is an explicit inspection request), and the hold only applies
// at fit (1:1/4x promise device pixels, which a held upscale contradicts).
function applyImageWidth() {
  if (zoomLevel === 2) output.style.width = `${output.naturalWidth * 4}px`;
  else if (heldWidth !== null && zoomLevel === 0) output.style.width = `${heldWidth}px`;
  else output.style.width = '';
}

function updateZoomLabel() {
  if (output.hidden || !output.naturalWidth) {
    zoomBtn.hidden = true;
    return;
  }
  // aria-pressed stays a boolean ("a zoom step is engaged"); WHICH step is
  // engaged rides in the visible label, which is also the accessible name.
  zoomBtn.setAttribute('aria-pressed', String(zoomLevel > 0));
  if (zoomLevel > 0) {
    zoomBtn.hidden = false;
    zoomBtn.textContent = zoomLevel === 2 ? '4×' : '1:1';
    return;
  }
  const pct = Math.round((output.clientWidth / output.naturalWidth) * 100) || 100;
  // At 100% "fit" IS 1:1, so the toggle would be a no-op; hide the chip rather
  // than dangle a dead control. It returns once the ratio diverges (a bigger
  // render, a narrower pane, or a held draft upscale). The image click still
  // toggles, harmlessly, for pointer users.
  zoomBtn.hidden = pct === 100;
  zoomBtn.textContent = `fit (${pct}%)`;
}

function cycleZoom() {
  zoomLevel = (zoomLevel + 1) % 3;
  output.classList.toggle('zoom-1x', zoomLevel > 0);
  // zoom-4x only flips the cursor (zoom-in at 1:1, where the next click goes
  // further IN; zoom-out at the last step). The shared .zoom-1x block carries
  // everything else for both steps.
  output.classList.toggle('zoom-4x', zoomLevel === 2);
  applyImageWidth();
  updateZoomLabel();
}

// Scroll the plate so the image-space fraction (fx, fy) lands at the plate
// viewport's center. Out-of-range targets clamp to the scroll bounds (native
// scrollLeft/scrollTop behavior), so a fit-sized image just stays put.
function anchorZoom(fx, fy) {
  outputPlate.scrollLeft = fx * output.clientWidth - outputPlate.clientWidth / 2;
  outputPlate.scrollTop = fy * output.clientHeight - outputPlate.clientHeight / 2;
}

zoomBtn.addEventListener('click', () => {
  cycleZoom();
  // The button carries no click point; anchor each zoomed step on the center.
  if (zoomLevel > 0) anchorZoom(0.5, 0.5);
});

// The zoom-cycle click lives on the PLATE, not the image: while a drag-pan
// has pointer capture, the browser retargets the synthesized click at the
// capturing plate, so an image-only listener would miss the under-4px presses
// that must still count as clicks. Image-relative bounds gate it back to
// "clicks on the render" (the surrounding mat is not a zoom control), and the
// click point becomes the zoom anchor so the pixel under the cursor stays
// under the cursor.
outputPlate.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (output.hidden) return;
  const r = output.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
    return;
  }
  const fx = (e.clientX - r.left) / r.width;
  const fy = (e.clientY - r.top) / r.height;
  cycleZoom();
  if (zoomLevel > 0) anchorZoom(fx, fy);
});

// ---- drag-to-pan while zoomed ----
// Mouse/pen only: on touch the plate's native overflow scrolling already
// pans, and capturing the pointer would fight it. Presses that move under
// 4px stay clicks (the zoom cycle above); past it the press is a pan and the
// release's click is suppressed.

/** @type {{ x: number, y: number, left: number, top: number, moved: boolean } | null} */
let panState = null;

outputPlate.addEventListener('pointerdown', (e) => {
  if (zoomLevel === 0 || e.pointerType === 'touch' || e.button !== 0) return;
  panState = {
    x: e.clientX,
    y: e.clientY,
    left: outputPlate.scrollLeft,
    top: outputPlate.scrollTop,
    moved: false,
  };
  outputPlate.setPointerCapture(e.pointerId);
});

outputPlate.addEventListener('pointermove', (e) => {
  if (!panState) return;
  const dx = e.clientX - panState.x;
  const dy = e.clientY - panState.y;
  if (!panState.moved && Math.hypot(dx, dy) < 4) return;
  panState.moved = true;
  cancelPeekHold(); // the press is a pan, not a hold-to-peek
  outputPlate.classList.add('panning'); // grabbing cursor while actually moving
  outputPlate.scrollLeft = panState.left - dx;
  outputPlate.scrollTop = panState.top - dy;
});

function endPan() {
  if (!panState) return;
  if (panState.moved) suppressClick = true;
  panState = null;
  outputPlate.classList.remove('panning');
}

// One release path for every way a press on the plate can end. pointerleave
// covers the uncaptured (fit-mode) press dragged off the plate and released
// outside, where pointerup never fires here and a peek would otherwise stick.
function endPlatePress() {
  endPan();
  cancelPeekHold();
  endPeek();
}
outputPlate.addEventListener('pointerup', endPlatePress);
outputPlate.addEventListener('pointercancel', endPlatePress);
outputPlate.addEventListener('pointerleave', endPlatePress);

output.addEventListener('load', () =>
  requestAnimationFrame(() => {
    applyImageWidth(); // the 4x width derives from naturalWidth, which just changed
    updateZoomLabel();
  })
);
window.addEventListener('resize', updateZoomLabel);

// ---- hold-to-peek the previous render (A/B compare) ----
// The core loop is tweak -> render -> squint at what changed, so showImage
// keeps ONE step of image history (prevUrl). Holding Alt+B, or press-and-
// holding the image itself, swaps the previous render in; release restores
// the current one. Drafts and full renders both flow through showImage, so
// the compare works draft-to-draft and full-to-full alike.

// The hold threshold separating a peek press from a zoom-cycle click.
const PEEK_HOLD_MS = 350;
/** @type {string | null} */
let prevUrl = null;
let peeking = false;
let peekStatusText = '';
/** @type {ReturnType<typeof setTimeout> | null} */
let peekTimer = null;

function startPeek() {
  if (peeking || !prevUrl || output.hidden) return;
  peeking = true;
  // Direct textContent writes (not setStatus): the peek is a momentary
  // overlay on whatever the status machinery is doing, and must put the
  // exact text back on release without disturbing its state/throttle
  // bookkeeping.
  peekStatusText = status.textContent;
  status.textContent = 'previous render';
  output.src = prevUrl;
}

function endPeek() {
  if (!peeking) return;
  peeking = false;
  status.textContent = peekStatusText;
  output.src = lastUrl;
}

function cancelPeekHold() {
  clearTimeout(peekTimer);
  peekTimer = null;
}

// Pointer path: engage only after a hold, so a quick press stays the zoom
// click and a drag past the pan threshold cancels the hold (pointermove
// above). The release is endPlatePress (the press bubbles to the plate).
output.addEventListener('pointerdown', () => {
  cancelPeekHold();
  peekTimer = setTimeout(() => {
    peekTimer = null;
    suppressClick = true; // the long press's release must not cycle the zoom
    startPeek();
  }, PEEK_HOLD_MS);
});

// Keyboard path, document-level so it works while typing in the editor.
// e.code, not e.key: with Alt held macOS composes '∫', and preventDefault
// keeps that character out of the focused field. Key-repeat re-fires keydown
// for the whole hold; startPeek's `peeking` guard absorbs it.
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.code === 'KeyB') {
    e.preventDefault();
    startPeek();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'KeyB') endPeek();
});
// Alt+Tab away mid-peek would otherwise strand the previous frame on screen
// (the keyup lands in another window).
window.addEventListener('blur', endPeek);

// ---- error -> editor line jump ----

function editorLineHeight() {
  return parseFloat(getComputedStyle(editor).lineHeight) || 19;
}

// Scroll line n toward the top of the view (two lines of context above it) and
// resync the gutter/overlay/error-band. Shared by the error jump and the find
// bar, so a find match and a blamed line land identically.
function scrollEditorToLine(n) {
  editor.scrollTop = Math.max(0, (n - 3) * editorLineHeight());
  syncEditorScroll();
}

function selectEditorLine(n) {
  const lines = editor.value.split('\n');
  if (!(n >= 1 && n <= lines.length)) return;
  let start = 0;
  for (let i = 0; i < n - 1; i++) start += lines[i].length + 1;
  editor.setSelectionRange(start, start + lines[n - 1].length);
  scrollEditorToLine(n);
}

// A persistent red band on the line a failed render blamed (the auto-jump only
// sets an invisible textarea selection). Translated with the editor scroll by
// positionErrorLine so it tracks the line; cleared on the next edit or render.
let errorLineNo = 0;

function markErrorLine(n) {
  errorLineNo = n;
  const lh = editorLineHeight();
  errorLineEl.style.top = `${8 + (n - 1) * lh}px`; // 8px = the editor's top padding
  errorLineEl.style.height = `${lh}px`;
  errorLineEl.hidden = false;
  errorBox.classList.add('has-line'); // the error box becomes a jump-to-line affordance
  positionErrorLine();
}

function clearErrorLine() {
  errorLineEl.hidden = true;
  errorLineNo = 0;
  errorBox.classList.remove('has-line');
}

function positionErrorLine() {
  errorLineEl.style.transform = `translateY(${-editor.scrollTop}px)`;
}

// Re-jump to the blamed line when the error box is clicked (selectEditorLine
// no-ops when there's no line, so the click is harmless without one).
errorBox.addEventListener('click', () => selectEditorLine(errorLineNo));

// ---- find + go-to-line (the #find-bar strip over the editor) ----
// One bar, two modes: Ctrl/Cmd+F opens it as case-insensitive substring find
// (Enter next / Shift+Enter previous, wrapping; the match is selected in the
// textarea and scrolled into view), Ctrl/Cmd+G as go-to-line (Enter jumps via
// selectEditorLine). Esc returns focus to the editor at the current match.
// Focus stays in the bar while cycling, so Enter can never retrigger a render.
// Editing the scene closes the bar (the match offsets would be stale).

/** @type {'find' | 'goto'} */
let findMode = 'find';
/** @type {number[]} match start offsets in editor.value, ascending */
let findMatches = [];
let findIndex = -1;

// Non-overlapping, case-insensitive substring match offsets.
function findAllMatches(text, query) {
  const out = [];
  if (!query) return out;
  const hay = text.toLowerCase();
  const q = query.toLowerCase();
  let i = hay.indexOf(q);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

// The dim counter: "3/17" while finding (0/0 with no query or no hits), the
// buffer's line count as the bounds hint while going to a line.
function updateFindCount() {
  if (findMode === 'goto') {
    findCount.textContent = `${editor.value.split('\n').length} lines`;
  } else {
    findCount.textContent = findMatches.length ? `${findIndex + 1}/${findMatches.length}` : '0/0';
  }
}

// Select the current match in the textarea (visible once focus returns there)
// and scroll its line into view; the bar keeps focus while cycling.
function selectFindMatch() {
  const start = findMatches[findIndex];
  editor.setSelectionRange(start, start + findInput.value.length);
  scrollEditorToLine(editor.value.slice(0, start).split('\n').length);
  updateFindCount();
}

// Recompute the match set for the current query, restarting from the first
// match at/after the editor caret (so reopening find resumes near the user's
// place rather than at the top of a long scene).
function refreshFind() {
  findMatches = findAllMatches(editor.value, findInput.value);
  if (!findMatches.length) {
    findIndex = -1;
    updateFindCount();
    return;
  }
  const caret = editor.selectionStart;
  const ahead = findMatches.findIndex((s) => s >= caret);
  findIndex = ahead === -1 ? 0 : ahead;
  selectFindMatch();
}

function stepFind(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  selectFindMatch();
}

function commitGoto() {
  const n = parseInt(findInput.value, 10);
  closeFind(true);
  // selectEditorLine ignores an out-of-range line, so junk input just closes.
  if (Number.isInteger(n)) selectEditorLine(n);
}

/** @param {'find' | 'goto'} mode */
function openFind(mode) {
  // Reopening the already-showing mode keeps the query (Ctrl+F again just
  // refocuses); switching modes or opening fresh starts blank.
  if (findBar.hidden || findMode !== mode) {
    findMode = mode;
    findInput.value = '';
    findInput.placeholder = mode === 'goto' ? 'go to line' : 'find';
    findBar.hidden = false;
    findMatches = [];
    findIndex = -1;
    updateFindCount();
  }
  findInput.focus();
  findInput.select();
}

// Close the bar; `focusEditor` hands focus back (Esc, go-to-line commit). The
// editor-input path passes false so closing never yanks focus mid-keystroke.
function closeFind(focusEditor) {
  if (findBar.hidden) return;
  findBar.hidden = true;
  if (focusEditor) editor.focus();
}

findInput.addEventListener('input', () => {
  if (findMode === 'find') refreshFind();
  else updateFindCount();
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (findMode === 'goto') commitGoto();
    else stepFind(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation(); // closing the bar must not also abort a render
    closeFind(true); // back to the editor, caret on the current match
  }
});

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
  return editor.value === lastLoadedSource ? selectedExample : 'edited scene';
}

// done in 0.92s · 512×384
// The brief celebratory headline: wall-clock time + resolution only. The full
// numeric breakdown (timings, rays, rays/s, threads, warnings) lives in the stat
// chips under the image (showStats), so nothing is repeated between the two.
/** @param {number} elapsedMs @param {{ width: number, height: number }} opts @returns {string} */
function doneLine(elapsedMs, opts) {
  return `done in ${(elapsedMs / 1000).toFixed(2)}s · ${opts.width}×${opts.height}`;
}

// One stat chip: <div class="stat"><dt>label</dt><dd>value</dd></div>.
/** @param {string} label @param {string} value @returns {HTMLDivElement} */
function statChip(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'stat';
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

// Promote the render log's headline numbers into the stat-chip readout under the
// image. Parses the raw log for the per-phase timings/rays/threads and pairs them
// with the render dimensions. Called only from the explicit still-render success
// path (drafts are previews, animate has its own footer); the chips then persist
// as the last full render's stats until the next one.
/** @param {string} rawLog @param {{ width: number, height: number }} opts */
function showStats(rawLog, opts) {
  const rows = formatStats(parseStats(rawLog), {
    width: opts.width,
    height: opts.height,
  });
  statsList.replaceChildren(...rows.map((r) => statChip(r.label, r.value)));
  statsList.hidden = false;
}

let abortCtl = null;
let lastUrl = null;
// True once any engine output has ever arrived this session: the first
// render's silence is wasm startup, later renders go straight to parsing.
let engineSeen = false;

// One image-swap path shared by the explicit render and the live draft: the
// zoom label recomputes off the #output 'load' listener, and the outgoing
// image survives one generation as prevUrl (the hold-to-peek A/B frame, one
// blob of memory) before the revoke. `holdWidth` (drafts only) pins the
// display width so the downscaled preview keeps the full render's footprint;
// full renders omit it, restoring natural sizing.
function showImage(blobUrl, alt, holdWidth = null) {
  // A frame landing mid-peek must win over the release's restore: settle the
  // peek first, so the swap below is the last word on output.src.
  endPeek();
  if (prevUrl) URL.revokeObjectURL(prevUrl);
  prevUrl = lastUrl;
  lastUrl = blobUrl;
  heldWidth = holdWidth;
  applyImageWidth();
  output.src = blobUrl;
  output.hidden = false;
  playerCanvas.hidden = true;
  hasStillImage = true;
  output.alt = alt;
  output.classList.remove('stale');
  plateHint.hidden = true;
}

// ---- live draft (auto-render as you type, still mode only) ----
// Reuses render-client's renderScene + the single `busy` singleton + an
// AbortSignal; it never duplicates orchestration. Explicit renders always win
// (see startRender). The persisted `liveDraft` toggle is wired further down.

// Longest draft edge in px (the downscaled fast preview), from the advanced
// "draft" select (256/320/512, default 320; persisted via CONTROL_FIELDS like
// quality/antialias). A select always has a numeric option chosen.
function draftMaxEdge() {
  return Number(draftSelect.value);
}

// Drafts also cap quality: q6+ ray features (reflection, refraction, radiosity)
// dominate render time, which is wrong for an as-you-type preview. The full
// Render keeps the selected quality. Auto quality (undefined) would otherwise
// run at POV-Ray's default q9, so the cap applies there too.
const DRAFT_MAX_QUALITY = 5;

// ... and threads: every render spawns a fresh worker pool, so at high core
// counts the per-draft spawn overhead outweighs what a ~320px image can use,
// and an as-you-type preview shouldn't commandeer every core anyway. An
// explicit threads value still wins (for drafts AND the full Render, which
// otherwise keeps the wrapper's all-cores default).
const DRAFT_MAX_THREADS = 4;

// Fast + clearly lower-res than the full Render: antialias always off and the
// longest edge capped to draftMaxEdge(), aspect ratio preserved so the draft
// composition matches the eventual full render. Reads (never writes) the inputs
// so a mid-type width/height isn't clobbered.
function draftOptions() {
  const { width, height, quality, threads } = readRenderOptions();
  const s = Math.min(1, draftMaxEdge() / Math.max(width, height));
  return {
    width: Math.max(8, Math.round(width * s)),
    height: Math.max(8, Math.round(height * s)),
    quality: Math.min(quality ?? Infinity, DRAFT_MAX_QUALITY),
    threads: threads ?? Math.min(DRAFT_MAX_THREADS, navigator.hardwareConcurrency),
    antialias: false,
    files: assetDrop.assetFiles(), // staged dropped assets (undefined when none)
  };
}

function draftStatus(dims) {
  return `preview ready · ${dims}`;
}

const liveDraftController = createLiveDraftController({
  enabled: () => mode === 'still' && liveDraft && crossOriginIsolated,
  readSource: () => editor.value,
  // The auto-draft gate must live here, not just in scheduleDraft: the
  // controller re-schedules itself after an aborted draft settles, and that
  // internal path would otherwise auto-preview heavy/animated examples.
  sourceReady: (source) => canAutoDraftCurrentScene() && validateScene(source).ready,
  explicitInFlight: () => abortCtl !== null,
  renderBusy: isBusy,
  draftOptions,
  renderDraft: (source, options, signal) =>
    renderScene(source, { ...options, signal, keepBytes: false }),
  onStart: (_source, opts) => {
    const dims = `${opts.width}×${opts.height}`;
    setStatus(draftStatus(dims), 'draft');
  },
  onSuccess: (_source, result, opts) => {
    const dims = `${opts.width}×${opts.height}`;
    // Success is the ONLY time the image swaps (a draft error keeps the last
    // good one). Drafts never touch the progress bar or the render log.
    errorBox.hidden = true;
    errorBox.textContent = '';
    errorBox.classList.remove('draft');
    // Hold the draft at the FULL render's target width (re-read at swap time so
    // a width edit mid-draft lands), keeping the plate footprint stable.
    showImage(result.blobUrl, `live draft, ${sceneName()}, ${dims}`, readRenderOptions().width);
    downloadBtn.hidden = true; // the preview is low-res, not a downloadable full render
    setStatus(draftStatus(dims), 'draft');
  },
  onError: (_source, err) => {
    // Non-destructive: keep the last good image (no #output.src change, no
    // .stale, no canvas clear). Surface the message quietly inline and do NOT
    // jump the caret (hostile while typing). A draft error is a polite live
    // region (role swapped to status), not the assertive alert the explicit
    // Render path uses, so a screen reader isn't interrupted on every keystroke.
    errorBox.setAttribute('role', 'status');
    errorBox.textContent = formatError(err);
    errorBox.classList.add('draft');
    errorBox.hidden = false;
    setStatus('preview error', 'draft');
  },
  onSettled: syncSpinner,
  startFullRender: () => startRender(),
  // The just-shown image stays; only future auto-drafts stop. Loading another
  // scene or re-flipping the live toggle resumes (the resumeAuto call sites).
  /* c8 ignore next -- pausing needs a real draft slower than the 20s threshold, which the suite can't render deterministically */
  onAutoPause: () => setStatus('preview paused · slow scene, use Render', 'idle'),
});

// Read-only test-observability probe (no behaviour; the app never reads it).
// Surfaces the draft scheduler's internal state so the browser coverage suite
// can await coalescing / supersede / mid-flight-abort transitions deterministically.
/** @type {Window & { __liveDraftProbe?: () => unknown }} */ (window).__liveDraftProbe =
  liveDraftController.probe;

function scheduleDraft({ sourceChanged = false } = {}) {
  if (!canAutoDraftCurrentScene()) {
    liveDraftController.cancel();
    return;
  }
  if (sourceChanged) liveDraftController.sourceChanged();
  else liveDraftController.schedule();
}

async function startRender() {
  // An explicit render always wins over a live draft. Drop any pending draft
  // timer, and if a draft is mid-flight, abort it and let its finally restart
  // us once `busy` clears.
  if (liveDraftController.requestFullRender()) return;
  // Bail while busy or non-isolated (first-visit SW install window: the
  // banner is visible and the page will reload itself once installed). The
  // draft handoff above deliberately KEEPS finalRenderOnce armed (the restarted
  // render is the same user intent); these dead ends disarm it.
  if (abortCtl || isBusy()) {
    finalRenderOnce = false;
    return;
  }
  if (!crossOriginIsolated) {
    isoWarning.hidden = false;
    finalRenderOnce = false;
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
  clearErrorLine();
  output.classList.add('stale');
  downloadBtn.classList.add('stale');
  statsList.classList.add('stale');
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
  const renderedSource = editor.value;
  let sawLine = engineSeen;
  let tracing = false;

  try {
    const {
      blobUrl,
      elapsedMs,
      log: rawLog,
    } = await renderScene(renderedSource, {
      ...opts,
      signal: ctl.signal,
      keepBytes: false,
      onEvent: (ev) => {
        if (ctl.signal.aborted) return; // never overwrite 'cancelled'
        engineSeen = true;
        if (ev.kind === 'progress') {
          const pct = progressPercent(ev.percent);
          setProgressLine(ev.text);
          if (pct >= 0) setBusyStatus(`rendering… ${pct}%`);
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

    showImage(blobUrl, `render output, ${sceneName()}, ${opts.width}×${opts.height}`);
    downloadBtn.href = blobUrl;
    downloadBtn.download = downloadName(opts);
    downloadBtn.hidden = false;
    downloadBtn.classList.remove('stale');
    statsList.classList.remove('stale');
    showStats(rawLog, opts);

    setStatus(doneLine(elapsedMs, opts), 'done');
    recordHistory(renderedSource); // a milestone worth remembering: this scene just rendered
    setLogSummary('render log');
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
      statsList.classList.remove('stale');
      setStatus('render cancelled', 'cancelled');
    } else {
      setStatus('render failed', 'error');
      const message = formatError(err);
      // An explicit Render failure is the loud, assertive case: clear any quiet
      // draft styling/role a prior live-draft error left behind so the box reads
      // as the red, alert-announced error it should be.
      errorBox.classList.remove('draft');
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      const lineMatch = /^line (\d+)\b/.exec(message);
      if (lineMatch) {
        markErrorLine(Number(lineMatch[1]));
        selectEditorLine(Number(lineMatch[1]));
      }
      setLogSummary(
        err instanceof PovrayError ? `render log · exit ${err.exitCode}` : 'render log'
      );
    }
  } finally {
    abortCtl = null;
    progressStop();
    renderBtn.disabled = false;
    // Return focus before hiding Cancel (hiding the focused element drops
    // focus to <body>).
    if (document.activeElement === cancelBtn) renderBtn.focus();
    cancelBtn.hidden = true;
    // Mark this exact source as already attempted so the backstop draft no-ops
    // until the next edit. If the user typed during the render, editor.value
    // now differs from renderedSource, so the draft fires for the latest text.
    liveDraftController.markAttempted(renderedSource);
    scheduleDraft();
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

async function runAnimateRender() {
  const opts = collectOptions();
  const { frames, fps } = collectAnimOptions();
  resetLog();
  errorBox.hidden = true;
  errorBox.textContent = '';
  clearErrorLine();
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
      keepFrames: false,
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
    setLogSummary('render log');
    if (!matchMedia('(min-width: 900px)').matches) {
      playerCanvas.scrollIntoView({ block: 'nearest' });
    }
  } catch (err) {
    commitProgressLine();
    if (isAbortError(err)) {
      setStatus('render cancelled', 'cancelled');
    } else {
      setStatus('render failed', 'error');
      const message = formatError(err);
      // Same as the still path: an explicit animate failure is the loud,
      // assertive error, never the quiet draft variant.
      errorBox.classList.remove('draft');
      errorBox.setAttribute('role', 'alert');
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'nearest' });
      const lineMatch = /^line (\d+)\b/.exec(message);
      if (lineMatch) {
        markErrorLine(Number(lineMatch[1]));
        selectEditorLine(Number(lineMatch[1]));
      }
      setLogSummary(
        err instanceof PovrayError ? `render log · exit ${err.exitCode}` : 'render log'
      );
    }
  } finally {
    abortCtl = null;
    progressStop();
    renderBtn.disabled = false;
    if (document.activeElement === cancelBtn) renderBtn.focus();
    cancelBtn.hidden = true;
  }
}

const player = createPlayer({
  canvas: playerCanvas,
  controls: playerControls,
  playButton: playBtn,
  scrubber,
  frameReadout,
  loopButton: loopBtn,
  exportButton: exportBtn,
  exportFormat,
});

// ---- mode toggle + plate routing ----

function setMode(next) {
  if (next === mode) return;
  if (abortCtl) return; // an explicit/animate render locks the mode
  // A live draft is still-only; aborting it must not block the switch (its
  // finally re-checks mode and won't reschedule in animate).
  liveDraftController.cancel();
  mode = next;
  // The log + stat chips narrate the OTHER mode's last render; left visible
  // they read as describing the new plate (a still's "render log" lingering
  // under an empty animate plate). Hide both; the next render's first log
  // line / stats repopulate and re-reveal them.
  logDetails.hidden = true;
  statsList.hidden = true;
  applyMode();
  // Re-derive the footer so it agrees with the new plate. Without this #status
  // keeps the prior mode's text (a "preview ready · WxH" line lingering in animate
  // where drafts are suppressed, or an animate "done … · N frames" line over a
  // single still). A still-mode draft, if it fires below, overrides this.
  syncStatusToPlate();
  scheduleSave();
  // Switching back to still refreshes the preview; switching to animate leaves
  // drafts suppressed (scheduleDraft early-returns when mode !== 'still').
  if (mode === 'still' && liveDraft) scheduleDraft();
}

// Neutral status line that agrees with whatever the plate is actually showing.
// Kept in the dim 'idle' state: it describes existing content, it isn't the
// bright payoff line a fresh render earns.
function syncStatusToPlate() {
  if (mode === 'animate') {
    setStatus(player.hasFrames() ? 'animation ready' : 'no render yet', 'idle');
  } else {
    // Name the artifact + its dims (the done-line convention): a bare "render
    // ready" is ambiguous with "the renderer is ready". naturalWidth stays
    // honest even when a held draft is displayed upscaled.
    setStatus(
      hasStillImage
        ? `still ready · ${output.naturalWidth}×${output.naturalHeight}`
        : 'no render yet',
      'idle'
    );
  }
}

function applyMode() {
  document.body.dataset.mode = mode;
  modeStillBtn.setAttribute('aria-pressed', String(mode === 'still'));
  modeAnimateBtn.setAttribute('aria-pressed', String(mode === 'animate'));
  if (mode === 'still') player.pause();
  refreshPlate();
}

// The hint's still copy is the first-run onboarding sentence (from the
// markup). In animate mode the plate can sit empty MID-session (frames only
// exist after an explicit Render), where that copy would misread as a reset;
// the empty animate plate instead says what Render will do, quoting the live
// frames input.
const stillHintCopy = plateHint.textContent;

function updatePlateHint() {
  if (mode === 'animate' && !player.hasFrames()) {
    const n = parseInt(framesInput.value, 10);
    const frames = Number.isNaN(n) ? 24 : clamp(n, 1, 240);
    plateHint.textContent = `Render to ray-trace ${frames} frames of this scene.`;
  } else {
    plateHint.textContent = stillHintCopy;
  }
}

// The animate empty-state hint quotes the frame count; keep it current while
// the user dials frames in before the first animation render.
framesInput.addEventListener('input', updatePlateHint);

// Show the right thing in #output-plate for the current mode: the player
// canvas (animate, once frames exist), the still image (still, once rendered),
// or the empty-state hint.
function refreshPlate() {
  updatePlateHint();
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

// Persist the advanced disclosure's open state (a personal preference, like
// liveDraft, so it rides in saveState but NOT the share URL): a power user opens
// it once and it stays open across renders and reloads.
advanced.addEventListener('toggle', scheduleSave);

// ---- draggable editor/output split ----
// #split-handle is the 8px grid column between the panes at the two-column
// breakpoint (display:none below it, so none of this can fire on mobile). A
// pointer drag, Arrow keys (WAI-ARIA window-splitter), or a saved state set
// --split on <main> as the editor pane's fr count; double-click or Home resets
// to the 50/50 default. Persisted via saveState like advancedOpen/liveDraft.

// The editor pane's share of the row, 0..1; the default split is an even half.
function splitFraction() {
  return splitFr === null ? 0.5 : splitFr / (1 + splitFr);
}

// Write splitFr onto <main> (null clears back to the stylesheet's 1fr default)
// and mirror the percentage into the separator's aria-valuenow.
function applySplit() {
  if (splitFr === null) mainEl.style.removeProperty('--split');
  else mainEl.style.setProperty('--split', `${splitFr}fr`);
  splitHandle.setAttribute('aria-valuenow', String(Math.round(splitFraction() * 100)));
}

// Set the split from a pane fraction (null = reset), clamped to the 20%..80%
// drag bounds, then persist. The fr count is rounded so the saved blob and the
// inline style stay short.
/** @param {number | null} f */
function setSplitFraction(f) {
  if (f === null) {
    splitFr = null;
  } else {
    const bounded = clamp(f, SPLIT_MIN_FRACTION, SPLIT_MAX_FRACTION);
    splitFr = Math.round((bounded / (1 - bounded)) * 1000) / 1000;
  }
  applySplit();
  scheduleSave();
}

let splitDragging = false;
splitHandle.addEventListener('pointerdown', (e) => {
  splitDragging = true;
  splitHandle.setPointerCapture(e.pointerId);
  e.preventDefault(); // no text selection / focus scroll while dragging
});
splitHandle.addEventListener('pointermove', (e) => {
  if (!splitDragging) return;
  // The fraction is the pointer's x within main's content box (the grid area
  // the two panes + handle actually divide).
  const rect = mainEl.getBoundingClientRect();
  const cs = getComputedStyle(mainEl);
  const left = rect.left + parseFloat(cs.paddingLeft);
  const width = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  setSplitFraction((e.clientX - left) / width);
});
const endSplitDrag = () => {
  splitDragging = false;
};
splitHandle.addEventListener('pointerup', endSplitDrag);
splitHandle.addEventListener('pointercancel', endSplitDrag);
splitHandle.addEventListener('dblclick', () => setSplitFraction(null));

// Keyboard splitter (the handle is tabbable): Arrows nudge 2% per press, Home
// resets to the even split, matching the WAI-ARIA window-splitter pattern.
splitHandle.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setSplitFraction(splitFraction() - 0.02);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    setSplitFraction(splitFraction() + 0.02);
  } else if (e.key === 'Home') {
    e.preventDefault();
    setSplitFraction(null);
  }
});

applySplit(); // reflect the restored (or default) split

// Undo a scene replacement: put the stashed (pre-replace) scene back.
restoreBtn.addEventListener('click', restoreScene);

function setLiveTogglePressed(on) {
  liveToggle.setAttribute('aria-pressed', String(on));
  liveToggle.setAttribute('aria-label', `Auto preview ${on ? 'on' : 'off'}`);
  liveToggleState.textContent = on ? 'on' : 'off';
}

// Live-draft toggle: reflect the restored state, then flip + persist on click.
// Turning it on schedules a draft; turning it off cancels any pending/in-flight
// draft (no accent: it's the quiet grey .toggle-btn invert).
setLiveTogglePressed(liveDraft);
liveToggle.addEventListener('click', () => {
  liveDraft = !liveDraft;
  setLiveTogglePressed(liveDraft);
  scheduleSave();
  if (liveDraft) {
    liveDraftController.resumeAuto(); // an explicit re-enable overrides a slow-draft pause
    if (status.dataset.state === 'idle' && status.textContent.startsWith('preview paused')) {
      syncStatusToPlate();
    }
    scheduleDraft();
  } else {
    liveDraftController.cancel();
    // Drop the "preview ready · …" label so the now-frozen, editable preview isn't
    // still announced as live. Only when the footer is actually showing a draft
    // line (don't clobber a real render's done/error payoff).
    if (status.dataset.state === 'draft') setStatus('preview paused', 'idle');
  }
});
// Seed the player fps from the (restored) input and route the plate for the
// restored mode.
player.setFps(Number(fpsInput.value));
applyMode();

// ---- shareable permalink deep-link (#<payload>) ---------------------------

// Apply a decoded permalink state to the editor + controls, then route the UI
// (mode, gutter/highlight, save, live preview). Mirrors the example/gist "load
// text into editor" replay (renderGutter/paintHighlight/scheduleSave/
// scheduleDraft) PLUS the control writes the gist path doesn't need.
/** @param {import('./permalink.js').PermalinkState} state */
function hydrateFromState(state) {
  editor.value = state.source;
  // Same control schema as save/restore. coerceHydrate trusts the decoded values
  // but still checks selects against the live options (an old link may name a
  // dropped one) and defaults a missing flags string to '' (links predate it).
  applyControls(state, coerceHydrate);
  player.setFps(Number(fpsInput.value));
  // setMode() no-ops when next === current and would skip applyMode(); set the
  // var + applyMode() directly so the plate/toggles always reflect the payload.
  mode = state.mode;
  applyMode();
  // A permalink replaces "what counts as the loaded scene": clear the example
  // dirty-baseline so the next example switch doesn't treat this as example text.
  lastLoadedSource = state.source;
  reflectSceneReplaced();
}

// ---- load a scene from a GitHub gist (?gist=<id>) -------------------------
// Optional deep-link: ?gist=<id> on the editor URL loads a gist's scene into
// the editor on page load, OVERRIDING the normally-restored saved scene. The
// value may be a bare gist id, a `user/id`, or a full gist URL; we take the
// last path segment (the gist JSON API keys on the id alone).
//
// Cross-origin: the page is cross-origin isolated (COEP: require-corp). A CORS
// fetch to api.github.com works (it sends Access-Control-Allow-Origin), but the
// raw gist host (gist.githubusercontent.com) sends no CORS, so we read the file
// text from the JSON API's files[name].content and never touch the raw_url. (A
// file past the API's inline cap comes back `truncated` with only partial
// content; v1 uses that partial text and doesn't chase raw_url.)

/**
 * Pull a gist id out of the ?gist= value. Returns null when the trailing path
 * segment isn't a hex id, so a malformed param falls back gracefully instead of
 * firing a junk request.
 * @param {string} raw
 * @returns {string | null}
 */
function gistIdFrom(raw) {
  const path = raw.trim().split(/[?#]/)[0];
  const parts = path.split('/');
  const id = parts[parts.length - 1];
  return /^[0-9a-f]+$/i.test(id) ? id : null;
}

/**
 * Choose the scene text from a gist's files map: prefer a `.pov` file, else the
 * first file carrying inline text. Returns null when none is usable.
 * @param {any} files gist files map from the JSON API
 * @returns {string | null}
 */
function pickGistSource(files) {
  const text = Object.values(files).filter((f) => typeof f.content === 'string');
  const pov = text.find((f) => /\.pov$/i.test(f.filename));
  const chosen = pov ?? text[0];
  return chosen ? chosen.content : null;
}

// Quiet, non-modal failure: reuse the live-draft error affordance (a dim,
// role=status box, not the loud red role=alert a user-triggered Render uses)
// since this fires on load. The restored saved/default scene is already in the
// editor as the fallback; we don't auto-preview it here so the message persists.
/** @param {string} message */
function gistFailed(message) {
  errorBox.classList.add('draft');
  errorBox.setAttribute('role', 'status');
  errorBox.textContent = message;
  errorBox.hidden = false;
}

// Drop ?gist from the visible URL. Used on a failed load so a dead/garbage
// ?gist doesn't linger as the "permalink"; a SUCCESSFUL load deliberately keeps
// it (the gist URL is the shareable permalink until the scene is edited).
function stripGistParam() {
  const url = new URL(location.href);
  url.searchParams.delete('gist');
  history.replaceState(null, '', url);
}

/** @param {string} raw the raw ?gist= value */
async function loadGistScene(raw) {
  const id = gistIdFrom(raw);
  if (!id) {
    stripGistParam();
    gistFailed("couldn't read a gist id from the link");
    return;
  }
  /** @type {string | null} */
  let source;
  try {
    const res = await fetch(`https://api.github.com/gists/${id}`);
    if (!res.ok) {
      stripGistParam();
      gistFailed(`couldn't load gist (HTTP ${res.status})`);
      return;
    }
    const data = await res.json();
    source = pickGistSource(data.files);
  } catch {
    stripGistParam();
    gistFailed("couldn't reach the gist API (offline or rate-limited)");
    return;
  }
  if (source === null) {
    stripGistParam();
    gistFailed('that gist has no scene file to load');
    return;
  }
  // Success: the gist text replaces the restored scene, then renders it in FULL
  // (not just a live-draft preview). A ?gist link is a "show me this scene" deep
  // link, so the recipient should land on the finished image. We PIN the gist as
  // the permalink (gistId/gistSource): ?gist stays in the bar as the shareable
  // URL until the scene is edited, at which point syncAddressUrl clears the stale
  // gist query. startRender() supersedes any in-flight draft and
  // self-guards on busy / non-isolated, so it is safe to fire right after.
  gistId = id;
  gistSource = source;
  editor.value = source;
  renderGutter();
  paintHighlight();
  scheduleSave();
  startRender();
}

function scheduleInitialDraft() {
  const record = getExampleRecord(selectedExample);
  if (record && editor.value === lastLoadedSource && !shouldAutoDraftExample(record)) return;
  scheduleDraft();
}

// Deep-link precedence on load: a #<permalink> hash wins over ?gist, which wins
// over ?example / the already-applied saved/default scene. The permalink decode
// is async and tolerant (decodeState returns null on garbage); a null falls
// through to the gist/example/cold-load path so a junk hash never strands the
// page. Without the final scheduleInitialDraft a cheap still cold page load sits
// on the empty-state hint until the first keystroke, which reads as "live is
// broken" (it isn't). Animated/heavy pristine examples wait for explicit Render.
const permalinkPayload = location.hash.slice(1);
const gistParam = new URLSearchParams(location.search).get('gist');
if (permalinkPayload) {
  decodeState(permalinkPayload).then((state) => {
    if (state) {
      hydrateFromState(state);
      // Same contract as the ?gist path: a shared link is a "show me this
      // scene" deep link, so the recipient lands on the finished render (at
      // the link's full settings), not a low-res draft. startRender supersedes
      // the draft hydrateFromState just scheduled and self-guards on busy /
      // non-isolated, so it is safe to fire right after.
      startRender();
    } else if (gistParam) {
      loadGistScene(gistParam);
    } else {
      scheduleInitialDraft();
    }
  });
} else if (gistParam) {
  loadGistScene(gistParam);
} else {
  scheduleInitialDraft();
}

// Warm the renderer (glue module + wasm fetch/compile) off the first render's
// critical path. After the deep-link routing so a boot render/draft is already
// queued; the warm fetches overlap it (or any later first render) for free.
prewarm();

renderBtn.addEventListener('click', startRender);
cancelBtn.addEventListener('click', () => abortCtl?.abort());

// Copy the current scene's shareable URL to the clipboard and flash the button
// label. Copy Link is the explicit "give it to me now" action: pinned gists copy
// as ?gist=, pristine catalog examples copy as ?example= plus render params, and
// custom/edited scenes copy as a self-contained compressed #hash. On clipboard
// rejection the bar still updates, so the URL stays selectable.
let copyLabelTimer = null;
/** @param {string} label */
function flashCopyLabel(label) {
  clearTimeout(copyLabelTimer);
  copyLinkBtn.textContent = label;
  copyLabelTimer = setTimeout(() => {
    copyLinkBtn.textContent = 'Copy Link';
  }, 1200);
}
async function copyPermalink() {
  const url = await shareUrlForCurrentState();
  replaceAddress(url);
  try {
    await navigator.clipboard.writeText(url.href);
    flashCopyLabel('Copied');
  } catch {
    /* c8 ignore next 2 -- clipboard.writeText rejects only on a denied permission / insecure context the COOP/COEP secure-context test page can't reach */
    flashCopyLabel('Copy failed');
  }
}
copyLinkBtn.addEventListener('click', copyPermalink);

let copySceneLabelTimer = null;
/** @param {string} label */
function flashCopySceneLabel(label) {
  clearTimeout(copySceneLabelTimer);
  copySceneBtn.textContent = label;
  copySceneLabelTimer = setTimeout(() => {
    copySceneBtn.textContent = 'Copy';
  }, 1200);
}

async function copySceneSource() {
  try {
    await navigator.clipboard.writeText(editor.value);
    flashCopySceneLabel('Copied');
  } catch {
    /* c8 ignore next 2 -- clipboard.writeText rejects only on denied permission / insecure contexts the COOP/COEP test page can't reach */
    flashCopySceneLabel('Copy failed');
  }
}

copySceneBtn.addEventListener('click', copySceneSource);
resetSceneBtn.addEventListener('click', resetSceneToExample);
downloadSceneBtn.addEventListener('click', downloadScene);

// Read-only test-observability probe (no behaviour; the app never reads it).
// Surfaces the button label + current hash so the browser coverage suite can
// await the async encode/clipboard's "Copied" flip and the hash being set
// deterministically instead of racing them.
/** @type {Window & { __permalinkProbe?: () => unknown }} */ (window).__permalinkProbe = () => ({
  label: copyLinkBtn.textContent,
  hash: location.hash,
});

// The prominent stop control on #status-row (syncSpinner shows it exactly while
// something is rendering). It stops whatever is in flight: an explicit render is
// aborted like the toolbar Cancel; a live draft is aborted AND live-draft is
// turned off so the draft's finally backstop (scheduleDraft) can't immediately
// reschedule it. The live toggle visibly reflects off; the user re-enables it to
// resume. Idle clicks (neither controller set) are a defensive no-op.
stopBtn.addEventListener('click', () => {
  if (abortCtl) {
    abortCtl.abort();
  } else if (liveDraftController.isDrafting()) {
    liveDraft = false;
    setLiveTogglePressed(false);
    liveDraftController.cancel();
    scheduleSave();
    // The stop button is only visible mid-draft, so the footer is in the
    // 'draft' state here; drop the "preview ready · …" label so the now-frozen,
    // editable preview isn't still announced as live.
    setStatus('preview paused', 'idle');
  }
});

// ---- keyboard-shortcuts overlay ----
// A plain dialog panel listing every binding, toggled by ? (when focus isn't in
// a typing surface) or the footer hint; Esc or ? closes. No backdrop/trap: the
// panel is static reference text, so plain show/hide with a focus handoff (the
// panel on open, the opener back on close) covers the dialog contract.

const shortcutsPanel = document.getElementById('shortcuts');
const shortcutsHint = /** @type {HTMLButtonElement} */ (document.getElementById('shortcuts-hint'));
/** @type {Element | null} */
let shortcutsReturnFocus = null;

function openShortcuts() {
  shortcutsReturnFocus = document.activeElement;
  shortcutsPanel.hidden = false;
  shortcutsPanel.focus();
}

function closeShortcuts() {
  shortcutsPanel.hidden = true;
  if (shortcutsReturnFocus instanceof HTMLElement) shortcutsReturnFocus.focus();
  shortcutsReturnFocus = null;
}

function toggleShortcuts() {
  if (shortcutsPanel.hidden) openShortcuts();
  else closeShortcuts();
}
shortcutsHint.addEventListener('click', toggleShortcuts);

// True when `el` is a typing surface, where a bare `?` must stay a character
// (the editor, the example search, the flags field, the number inputs...).
function isTextField(el) {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

// Ctrl/Cmd+S: flush the debounced persistence first (the freshest text is what
// downloads AND what survives a tab close right after), then save the scene as
// a .pov. Same revoke-after-grace pattern as the player exports (the synthetic
// click navigates synchronously; the timeout frees the blob).
function downloadScene() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saveState();
  syncAddressUrl();
  const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain' }));
  triggerDownload(url, 'scene.pov');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// True when the editor's find/go-to-line chords should engage: focus is in the
// editor, already in the find bar, or nowhere in particular (the body). In any
// other field the browser's own Ctrl/Cmd+F stays untouched.
function findScopeOk(target) {
  return target === editor || target === document.body || findBar.contains(target);
}

// Document-level shortcuts: Ctrl/Cmd+Enter renders from anywhere (startRender
// guards on busy), +Shift arms the one-shot final-quality override first.
// Escape closes the shortcuts overlay when it's open, else the find bar, else
// aborts an in-flight render. Ctrl/Cmd+F finds in the scene and Ctrl/Cmd+G
// goes to a line (both editor-scoped, see findScopeOk), Ctrl/Cmd+S downloads
// the scene, Ctrl/Cmd+K opens the example browser, Shift+Ctrl/Cmd+K opens the
// gallery, and ? toggles the shortcuts overlay.
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Enter' && mod) {
    e.preventDefault();
    if (e.shiftKey) finalRenderOnce = true;
    startRender();
  } else if (e.key === 'Escape') {
    if (!galleryPanel.hidden) {
      e.preventDefault();
      closeGallery();
    } else if (!shortcutsPanel.hidden) closeShortcuts();
    else if (!findBar.hidden) closeFind(false);
    else abortCtl?.abort();
  } else if ((e.key === 'f' || e.key === 'F') && mod && !e.shiftKey && !e.altKey) {
    if (!findScopeOk(e.target)) return; // leave the browser's find alone elsewhere
    e.preventDefault();
    openFind('find');
  } else if ((e.key === 'g' || e.key === 'G') && mod && !e.shiftKey && !e.altKey) {
    if (!findScopeOk(e.target)) return;
    e.preventDefault();
    openFind('goto');
  } else if ((e.key === 's' || e.key === 'S') && mod && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    downloadScene();
  } else if ((e.key === 'k' || e.key === 'K') && mod && e.shiftKey && !e.altKey) {
    if (
      !exampleBrowser.hidden ||
      !galleryPanel.hidden ||
      !shortcutsPanel.hidden ||
      isCompleteOpen()
    )
      return;
    e.preventDefault();
    openGallery();
  } else if ((e.key === 'k' || e.key === 'K') && mod && !e.shiftKey && !e.altKey) {
    // Leave the chord alone while another popover/overlay owns the screen (the
    // browser already showing included: re-opening would reset its state).
    if (
      !exampleBrowser.hidden ||
      !galleryPanel.hidden ||
      !shortcutsPanel.hidden ||
      isCompleteOpen()
    )
      return;
    e.preventDefault();
    openBrowser();
  } else if (e.key === '?' && !mod && !e.altKey && galleryPanel.hidden && !isTextField(e.target)) {
    e.preventDefault();
    toggleShortcuts();
  }
});

// Plain Enter inside the number inputs and the raw-flags field renders too:
// every sibling control in the settings rows answers Enter, and the flags
// field's whole point is iterating on AA settings render-to-render.
for (const el of [widthInput, heightInput, threadsInput, framesInput, fpsInput, flagsInput]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      startRender();
    }
  });
}
