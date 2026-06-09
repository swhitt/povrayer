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
import { EXAMPLES, getExample, getExampleRecord, groupByCategory } from './examples.js';
import { highlight } from './highlight.js';
import { validateScene } from './sdl-validate.js';
import { encodeState, decodeState } from './permalink.js';
import { parseRenderParams } from './url-params.js';
import { parseFlags } from './flags.js';
import { formatStats } from './stats.js';
import { encodeGif } from './gif.js';
import { encodeApng } from './apng.js';
import { buildPool, complete, applyCompletion, signatureText } from './complete.js';
import { classifyAsset, assetSnippet, safeName, uniqueName } from './assets.js';

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

// Page elements. The `/** @type {...} */ (...)` casts pin each lookup to the
// concrete element it is in index.html (verified against the markup) so checkJs
// can flag a `.value` on a div or a `.disabled` on a span. The ids all exist at
// module-eval time, so the cast (which also drops the `| null`) is safe here.
const exampleField = document.getElementById('example-field');
const exampleTrigger = document.getElementById('example-trigger');
const exampleTriggerText = document.getElementById('example-trigger-text');
const exampleBrowser = document.getElementById('example-browser');
const exampleSearch = /** @type {HTMLInputElement} */ (document.getElementById('example-search'));
const exampleListbox = document.getElementById('example-listbox');
const exampleEmpty = document.getElementById('example-empty');
const exampleAttrText = document.querySelector('#example-attribution .ex-attr-text');
const exampleAttrSrc = /** @type {HTMLAnchorElement} */ (
  document.querySelector('#example-attribution .ex-attr-src')
);
const editor = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
const editorCode = document.getElementById('editor-code');
const editorStack = document.getElementById('editor-stack');
const editorWrap = document.getElementById('editor-wrap');
const completeBox = document.getElementById('complete');
const completeStatus = document.getElementById('complete-status');
const assetsStrip = document.getElementById('assets');
const assetChips = document.getElementById('asset-chips');
const assetNote = document.getElementById('asset-note');
const gutter = document.getElementById('gutter');
const liveToggle = document.getElementById('live-toggle');
const widthInput = /** @type {HTMLInputElement} */ (document.getElementById('width'));
const heightInput = /** @type {HTMLInputElement} */ (document.getElementById('height'));
const qualitySelect = /** @type {HTMLSelectElement} */ (document.getElementById('quality'));
const antialiasSelect = /** @type {HTMLSelectElement} */ (document.getElementById('antialias'));
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
const output = /** @type {HTMLImageElement} */ (document.getElementById('output'));
const downloadBtn = /** @type {HTMLAnchorElement} */ (document.getElementById('download-btn'));
const log = document.getElementById('log');
const logDetails = document.getElementById('log-details');
const logSummary = document.getElementById('log-summary');
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
const playerControls = document.getElementById('player-controls');
const playBtn = /** @type {HTMLButtonElement} */ (document.getElementById('play-btn'));
const scrubber = /** @type {HTMLInputElement} */ (document.getElementById('scrubber'));
const frameReadout = document.getElementById('frame-readout');
const fpsReadout = document.getElementById('fps-readout');
const loopBtn = /** @type {HTMLButtonElement} */ (document.getElementById('loop-btn'));
const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById('export-btn'));
const exportFormat = /** @type {HTMLSelectElement} */ (document.getElementById('export-format'));

const STORAGE_KEY = 'povrayer.ui.v1';
const STASH_KEY = 'povrayer.ui.stash';

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

// ---- example browser (editable-combobox popover) + persisted state ----

// The flattened option elements in render order, plus the per-group bookkeeping
// the filter + accordion toggle. Both populated by buildExampleBrowser(); the
// option's lowercased haystack is its filter target. Each group record is
// { key, groupEl, headEl, opts: [{ el, haystack }], collapsed }; collapsed
// drives the disclosure (openBrowser seeds it, the head toggle flips it).
const optionEls = [];
const exampleGroups = [];
// The roving aria-activedescendant item: a category HEAD or an OPTION, or null.
let activeItem = null;

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
      const by = document.createElement('span');
      by.className = 'ex-by';
      by.textContent = `${ex.author} · ${ex.license}`;
      opt.append(title, desc, by);

      groupEl.appendChild(opt);
      // Filter target: everything a user might type, joined + lowercased. Tags
      // and the category label fuel the search without ever showing per-row.
      const haystack = [ex.name, ex.title, ex.description, ex.author, ...ex.tags, group.label]
        .join(' ')
        .toLowerCase();
      opts.push({ el: opt, haystack });
      optionEls.push(opt);
    }
    exampleListbox.insertBefore(groupEl, exampleEmpty);
    exampleGroups.push({ key: group.key, groupEl, headEl: head, opts, collapsed: true });
  }
}
buildExampleBrowser();

// EXAMPLES is a static, non-empty module literal, so EXAMPLES[0] is defined.
const DEFAULT_EXAMPLE = EXAMPLES[0].name;
// The loaded scene's name; replaces every old examplesSelect.value read/write.
let selectedExample = DEFAULT_EXAMPLE;

function hasExample(name) {
  return EXAMPLES.some((e) => e.name === name);
}

// Footer attribution. Branch-free: the link's visibility is an assignment off
// sourceUrl (every shipped scene ships ''), so the "shown" outcome lights up
// automatically if an adapted scene with a real URL ever lands.
function updateAttribution(ex) {
  exampleAttrText.textContent = `by ${ex.author} · ${ex.license}`;
  exampleAttrSrc.href = ex.sourceUrl; // '' is fine; the link stays hidden
  exampleAttrSrc.hidden = !ex.sourceUrl; // assignment, not `if` -> no dead branch
  exampleAttrSrc.setAttribute('aria-label', `source for ${ex.title}`);
}

// Reflect the loaded scene in the trigger label + data-name, and re-mark the
// loaded option (bold + a quiet ` · loaded` suffix on .ex-by, never aria-selected).
function setTriggerLabel(name) {
  const record = getExampleRecord(name);
  exampleTriggerText.textContent = record.title;
  exampleTrigger.dataset.name = name;
  for (const opt of optionEls) {
    const r = getExampleRecord(opt.dataset.name);
    const byBase = `${r.author} · ${r.license}`;
    const loaded = opt.dataset.name === name;
    opt.querySelector('.ex-by').textContent = loaded ? `${byBase} · loaded` : byBase;
    if (loaded) opt.dataset.loaded = 'true';
    else delete opt.dataset.loaded;
  }
}

// Animated examples ship a suggested frame count + fps; prefill the animate
// inputs so the intended loop runs without guessing. Still examples leave the
// inputs untouched, so a frames/fps the user dialed in survives loading other
// still scenes. setFps keeps the inline player's cadence in sync.
function applyExampleClock(record) {
  if (!record.animated) return; // still scenes: leave the inputs alone
  framesInput.value = String(record.frames);
  fpsInput.value = String(record.fps);
  player.setFps(record.fps);
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
        flags: flagsInput.value,
        example: selectedExample,
        mode,
        liveDraft,
        frames: framesInput.value,
        fps: fpsInput.value,
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
  return {
    source: editor.value,
    width: widthInput.value,
    height: heightInput.value,
    quality: qualitySelect.value,
    antialias: antialiasSelect.value,
    threads: threadsInput.value,
    flags: flagsInput.value,
    mode,
    frames: framesInput.value,
    fps: fpsInput.value,
  };
}

// When a ?gist=<id> scene is loaded, that short gist URL stays the shareable
// permalink (in the address bar and what Copy Link copies) until the scene text
// is edited. gistId is the loaded id; gistSource is its pristine text. The pin
// breaks the moment editor.value diverges from gistSource (see syncPermalinkHash).
/** @type {string | null} */
let gistId = null;
/** @type {string | null} */
let gistSource = null;

// Keep the address-bar permalink live so a shared or bookmarked URL always
// matches the current scene + settings. Driven off the same debounce as
// scheduleSave (re-encode once the user pauses, not per keystroke), and uses
// replaceState rather than assigning location.hash so an edit never pushes a
// back-stack entry. encodeState never throws for a well-formed state.
async function syncPermalinkHash() {
  // While an unmodified ?gist scene is showing, the short gist URL IS the
  // shareable permalink, so keep it in the bar instead of burying it under a
  // compressed hash. The first edit that diverges from the gist text unpins and
  // falls through to the live hash below (which also drops ?gist).
  if (gistId !== null) {
    if (editor.value === gistSource) {
      const pinned = new URL(location.href);
      pinned.search = '';
      pinned.searchParams.set('gist', gistId);
      pinned.hash = '';
      history.replaceState(null, '', pinned);
      return;
    }
    gistId = null;
    gistSource = null;
  }
  const payload = await encodeState(captureState());
  const url = new URL(location.href);
  url.search = ''; // the hash is self-contained; drop ?gist / any stray query
  url.hash = payload;
  history.replaceState(null, '', url);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState();
    syncPermalinkHash();
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
    if (typeof saved.width === 'string' && saved.width) widthInput.value = saved.width;
    if (typeof saved.height === 'string' && saved.height) heightInput.value = saved.height;
    if (
      typeof saved.quality === 'string' &&
      Array.from(qualitySelect.options).some((o) => o.value === saved.quality)
    ) {
      qualitySelect.value = saved.quality;
    }
    if (
      typeof saved.antialias === 'string' &&
      Array.from(antialiasSelect.options).some((o) => o.value === saved.antialias)
    ) {
      antialiasSelect.value = saved.antialias;
    }
    if (typeof saved.threads === 'string') threadsInput.value = saved.threads;
    if (typeof saved.flags === 'string') flagsInput.value = saved.flags;
    if (typeof saved.liveDraft === 'boolean') liveDraft = saved.liveDraft;
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

// URL query params (e.g. ?width=1200&q=11&mode=animate) seed the controls on
// load, OVERRIDING the saved/default values. Read-only: the live shareable link
// is the #hash permalink, which hydrates AFTER this runs and so wins. Combines
// with ?gist (the gist scene rendered at these settings). The numeric clamps
// live in url-params.js; quality/antialias are matched here against the real
// <select> options so an out-of-range value is ignored, not forced.
function applyUrlParams() {
  const p = parseRenderParams(location.search);
  if (p.width !== undefined) widthInput.value = p.width;
  if (p.height !== undefined) heightInput.value = p.height;
  if (p.threads !== undefined) threadsInput.value = p.threads;
  if (p.frames !== undefined) framesInput.value = p.frames;
  if (p.fps !== undefined) fpsInput.value = p.fps;
  if (
    p.quality !== undefined &&
    Array.from(qualitySelect.options).some((o) => o.value === p.quality)
  ) {
    qualitySelect.value = p.quality;
  }
  if (
    p.antialias !== undefined &&
    Array.from(antialiasSelect.options).some((o) => o.value === p.antialias)
  ) {
    antialiasSelect.value = p.antialias;
  }
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
  setTriggerLabel(name); // trigger text + data-name + re-mark loaded option
  renderGutter();
  paintHighlight();
  scheduleSave();
  scheduleDraft();
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
function renderList() {
  const q = exampleSearch.value.trim().toLowerCase();
  const searching = q !== '';
  let anyMatch = false;
  for (const g of exampleGroups) {
    let groupHasMatch = false;
    for (const { el, haystack } of g.opts) {
      const match = q === '' || haystack.includes(q);
      el.hidden = !(match && (searching || !g.collapsed));
      if (match) groupHasMatch = true;
    }
    g.groupEl.hidden = searching && !groupHasMatch;
    g.headEl.setAttribute('aria-expanded', String(searching ? groupHasMatch : !g.collapsed));
    if (groupHasMatch) anyMatch = true;
  }
  exampleEmpty.hidden = !(searching && !anyMatch);
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
  exampleSearch.value = '';
  // Open COMPACT: collapse every category except the loaded scene's, so its
  // rows are the only ones showing and the panel isn't a 29-row wall.
  const loaded = document.getElementById(`ex-opt-${selectedExample}`);
  const loadedGroup = groupFor(loaded);
  for (const g of exampleGroups) g.collapsed = g !== loadedGroup;
  renderList();
  setActive(loaded); // open focused on the loaded scene (scrolls it into view)
  exampleSearch.focus();
}

function closeBrowser(returnFocus) {
  exampleBrowser.hidden = true;
  exampleTrigger.setAttribute('aria-expanded', 'false');
  exampleSearch.value = '';
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

exampleSearch.addEventListener('input', () => {
  renderList();
  // Roving resets to the first visible row so Enter selects the top result
  // (a head would never commit, so default the active item to an option).
  setActive(visibleOptions()[0] ?? null);
});
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
  // Keep an open completion popup glued to the caret as the textarea scrolls.
  if (isCompleteOpen()) positionComplete();
}
editor.addEventListener('scroll', syncEditorScroll);
editor.addEventListener('input', () => {
  renderGutter();
  paintHighlight();
  refreshComplete(false);
  scheduleSave();
  scheduleDraft();
});
renderGutter();
paintHighlight();

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
  if (e.key !== 'Shift') escapePrimed = false;
});
editor.addEventListener('blur', () => {
  escapePrimed = false;
  closeComplete(); // focus left the editor (clicking a popup item keeps focus, so it doesn't fire here)
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

// ---- drag-and-drop asset import ----
// Drop an image on the editor and it's staged into the render filesystem (the
// wrapper writes the `files` map to /work/<name>) with an image_map pigment
// declare inserted at the caret; drop a .inc to stage + #include it; drop a .pov
// to replace the scene. Assets are session-only (raw bytes, not part of the
// permalink) and shown as removable chips so it's always clear what's loaded.

/** @type {Map<string, Uint8Array | string>} */
const assetRegistry = new Map();
const EMPTY_ASSET = new Uint8Array(0); // placeholder while a dropped file is being read

// The staged assets as the wrapper's `files` map, or undefined when there are
// none (so the render opts stay clean and the wrapper skips FS staging).
function assetFiles() {
  return assetRegistry.size > 0 ? Object.fromEntries(assetRegistry) : undefined;
}

function renderAssetChips() {
  assetChips.replaceChildren();
  for (const name of assetRegistry.keys()) {
    const chip = document.createElement('span');
    chip.className = 'asset-chip';
    const label = document.createElement('span');
    label.className = 'asset-name';
    label.textContent = name;
    chip.appendChild(label);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'asset-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `unload ${name}`);
    // Spell out that removal only unstages the bytes; the scene's snippet stays.
    remove.title = `Unload ${name} from the next render (its snippet stays in the scene)`;
    remove.addEventListener('click', () => {
      assetRegistry.delete(name);
      renderAssetChips();
    });
    chip.appendChild(remove);
    assetChips.appendChild(chip);
  }
  assetsStrip.hidden = assetRegistry.size === 0;
}

// Report the files a drop couldn't import (unsupported type or unreadable), or
// clear the note when the drop was fully clean.
function showDropNote(skipped) {
  if (skipped.length > 0) {
    assetNote.textContent = `skipped (unsupported or unreadable): ${skipped.join(', ')}`;
    assetNote.hidden = false;
  } else {
    assetNote.hidden = true;
  }
}

// Stash the current scene as the single recovery copy before it's replaced
// (shared with the example-browser replace flow).
function stashScene() {
  try {
    localStorage.setItem(STASH_KEY, editor.value);
  } catch {
    // best-effort stash
  }
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

async function handleDrop(fileList) {
  const skipped = [];
  for (const file of fileList) {
    const kind = classifyAsset(file.name);
    if (kind === 'unknown') {
      skipped.push(file.name);
      continue;
    }
    if (kind === 'scene') {
      const text = await file.text();
      if (confirm(`Replace the scene with ${file.name}?`)) {
        stashScene();
        editor.value = text;
        renderGutter();
        paintHighlight();
        scheduleSave();
        scheduleDraft();
      }
      continue;
    }
    // Reserve the (sanitized, unique) name synchronously so a second drop racing
    // through here can't claim the same name before the async read finishes.
    const name = uniqueName(safeName(file.name), assetRegistry);
    assetRegistry.set(name, EMPTY_ASSET);
    let data;
    try {
      data = kind === 'image' ? new Uint8Array(await file.arrayBuffer()) : await file.text();
    } catch {
      /* c8 ignore next 4 -- an in-memory dropped File doesn't reject on read in the harness; releases the reservation and reports */
      assetRegistry.delete(name);
      skipped.push(file.name);
      continue;
    }
    assetRegistry.set(name, data);
    insertAtCaret(assetSnippet(name, kind));
    renderAssetChips();
  }
  showDropNote(skipped);
}

editorWrap.addEventListener('dragover', (e) => {
  e.preventDefault(); // allow the drop
  editorWrap.classList.add('drag-over');
});
editorWrap.addEventListener('dragleave', (e) => {
  // Ignore the dragleave fired when the pointer crosses onto a child (gutter,
  // overlay, textarea); only clear when the drag truly leaves the editor.
  if (!editorWrap.contains(/** @type {Node | null} */ (e.relatedTarget))) {
    editorWrap.classList.remove('drag-over');
  }
});
editorWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  editorWrap.classList.remove('drag-over');
  handleDrop(e.dataTransfer.files);
});

// ---- controls ----

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
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

// The explicit-render path: read + clamp, then write the clamped dims back into
// the inputs so the UI always shows the values actually used. Raw flags from the
// advanced field ride along as `args`, which the wrapper appends LAST on the
// command line so they override the structured +W/+H/+Q/+A flags (last-wins).
// Drafts deliberately skip this (they build their own fast opts) so a heavy flag
// never bogs down the live preview.
function collectOptions() {
  const opts = readRenderOptions();
  widthInput.value = String(opts.width);
  heightInput.value = String(opts.height);
  opts.files = assetFiles(); // undefined when no assets are loaded; the wrapper skips it
  const args = parseFlags(flagsInput.value);
  return args.length ? { ...opts, args } : opts;
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
  syncSpinner();
}

function setBusyStatus(text) {
  status.dataset.state = 'busy';
  syncSpinner();
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

// The spinner mirrors "a render is actually in flight". An explicit render holds
// data-state 'busy' for its whole duration; a live draft holds 'draft', but that
// state also describes a *settled* draft (the resting "live draft · WxH" line),
// so the draft case keys on the in-flight controller, not the state. Once both
// clear, the spinner hides. The prominent #stop-btn rides the SAME signal (its
// click handler near the bottom stops whatever is in flight), so the spinner and
// the stop control always agree on "something is rendering".
function syncSpinner() {
  const inFlight = status.dataset.state === 'busy' || draftCtl !== null;
  statusSpinner.hidden = !inFlight;
  stopBtn.hidden = !inFlight;
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
  syncEditorScroll();
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

// One image-swap path shared by the explicit render and the live draft: a
// single lastUrl revoke, and the zoom label recomputes off the #output 'load'
// listener.
function showImage(blobUrl, alt) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = blobUrl;
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

const DRAFT_DEBOUNCE_MIN_MS = 250;
const DRAFT_DEBOUNCE_MAX_MS = 2000;
const DRAFT_DEBOUNCE_FACTOR = 0.75;
const DRAFT_MAX_EDGE = 320; // longest draft edge in px (downscaled fast preview)

let draftTimer = null; // pending debounce timeout, or null
let draftCtl = null; // AbortController for the in-flight DRAFT, or null
let draftingSource = ''; // the source the in-flight draft is rendering
let lastDraftSource = null; // last source actually attempted (draft or explicit)
let lastDraftMs = 0; // last draft's elapsed ms; drives the adaptive debounce
let pendingFull = false; // an explicit render is waiting on a draft to abort

// Read-only test-observability probe (no behaviour; the app never reads it).
// Surfaces the draft scheduler's internal state (a debounced fire pending, a
// draft render in flight, and which source it is rendering) so the browser
// coverage suite can await the coalescing / supersede / mid-flight-abort
// transitions deterministically instead of racing the adaptive debounce with
// fixed sleeps (which broke whenever a cold, slow prior draft inflated it).
/** @type {Window & { __liveDraftProbe?: () => unknown }} */ (window).__liveDraftProbe = () => ({
  pending: draftTimer !== null,
  inFlight: draftCtl !== null,
  source: draftingSource,
});

// Scale the debounce with the last draft's elapsed time so a slow scene waits
// longer between auto-renders and a fast one fires near the floor. Simple
// last-duration scaling, clamped; no hysteresis/EWMA/multi-pass.
function computeDraftDebounce() {
  return clamp(lastDraftMs * DRAFT_DEBOUNCE_FACTOR, DRAFT_DEBOUNCE_MIN_MS, DRAFT_DEBOUNCE_MAX_MS);
}

// Fast + clearly lower-res than the full Render: antialias always off and the
// longest edge capped to DRAFT_MAX_EDGE, aspect ratio preserved so the draft
// composition matches the eventual full render. Reads (never writes) the inputs
// so a mid-type width/height isn't clobbered.
function draftOptions() {
  const { width, height, quality, threads } = readRenderOptions();
  const s = Math.min(1, DRAFT_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(8, Math.round(width * s)),
    height: Math.max(8, Math.round(height * s)),
    quality,
    threads,
    antialias: false,
    files: assetFiles(), // staged dropped assets (undefined when none)
  };
}

function scheduleDraft() {
  if (mode !== 'still' || !liveDraft) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(fireDraft, computeDraftDebounce());
}

function fireDraft() {
  draftTimer = null;
  // Re-read the newest text every time: that's what makes coalescing collapse a
  // burst of keystrokes to a single render of the FINAL text (no queue).
  const src = editor.value;
  if (mode !== 'still' || !liveDraft || !crossOriginIsolated) return;
  if (src === lastDraftSource) return; // nothing changed since the last attempt
  if (!validateScene(src).ready) return; // looks mid-edit; stay quiet
  if (abortCtl) return; // an explicit render owns the engine; its finally reschedules
  if (draftCtl) {
    if (src === draftingSource) return; // already rendering this exact text
    draftCtl.abort(); // supersede with the newer text; the abort's finally reschedules
    return;
  }
  if (isBusy()) return; // defensive: never pile up on the busy singleton
  runDraft(src);
}

async function runDraft(src) {
  draftCtl = new AbortController();
  const ctl = draftCtl;
  draftingSource = src;
  const opts = draftOptions();
  const dims = `${opts.width}×${opts.height}`;
  setStatus(`live draft · ${dims}`, 'draft');
  try {
    const { blobUrl, elapsedMs } = await renderScene(src, { ...opts, signal: ctl.signal });
    lastDraftMs = elapsedMs;
    lastDraftSource = src;
    // Success is the ONLY time the image swaps (a draft error keeps the last
    // good one). Drafts never touch the progress bar or the render log.
    errorBox.hidden = true;
    errorBox.textContent = '';
    errorBox.classList.remove('draft');
    showImage(blobUrl, `live draft, ${sceneName()}, ${dims}`);
    downloadBtn.hidden = true; // the preview is low-res, not a downloadable full render
    setStatus(`live draft · ${dims}`, 'draft');
  } catch (err) {
    if (!isAbortError(err)) {
      // Record the failed source too. The success path sets lastDraftSource, but
      // a deterministic parse failure must also mark this exact text as
      // attempted, or the finally's backstop scheduleDraft re-fires the same
      // erroring scene forever (fireDraft's `src === lastDraftSource` guard never
      // short-circuits). That loop is a silent CPU/battery drain with status
      // flicker, worst on mobile.
      lastDraftSource = src;
      // Non-destructive: keep the last good image (no #output.src change, no
      // .stale, no canvas clear). Surface the message quietly inline and do NOT
      // jump the caret (hostile while typing). A draft error is a polite live
      // region (role swapped to status), not the assertive alert the explicit
      // Render path uses, so a screen reader isn't interrupted on every keystroke.
      errorBox.setAttribute('role', 'status');
      errorBox.textContent = formatError(err);
      errorBox.classList.add('draft');
      errorBox.hidden = false;
      setStatus('live draft · error', 'draft');
    }
    // On abort (superseded by newer text) do nothing: keep the image.
  } finally {
    draftCtl = null;
    syncSpinner();
    if (pendingFull) {
      // An explicit render is waiting on this abort; renderScene cleared `busy`
      // synchronously in its finally before ours, so the restart is race-free.
      pendingFull = false;
      startRender();
    } else {
      // Backstop: re-read the latest text even if the user stopped typing right
      // at an abort.
      scheduleDraft();
    }
  }
}

async function startRender() {
  // An explicit render always wins over a live draft. Drop any pending draft
  // timer, and if a draft is mid-flight, abort it and let its finally restart
  // us once `busy` clears.
  clearTimeout(draftTimer);
  draftTimer = null;
  if (draftCtl) {
    pendingFull = true;
    draftCtl.abort();
    return;
  }
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

    showImage(blobUrl, `render output, ${sceneName()}, ${opts.width}×${opts.height}`);
    downloadBtn.href = blobUrl;
    downloadBtn.download = downloadName(opts);
    downloadBtn.hidden = false;
    downloadBtn.classList.remove('stale');
    statsList.classList.remove('stale');
    showStats(rawLog, opts);

    setStatus(doneLine(elapsedMs, opts), 'done');
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
      statsList.classList.remove('stale');
      setStatus('cancelled', 'cancelled');
    } else {
      setStatus('error', 'error');
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
    // Mark this exact source as already attempted so the backstop draft no-ops
    // until the next edit. If the user typed during the render, editor.value
    // now differs from renderedSource, so the draft fires for the latest text.
    lastDraftSource = renderedSource;
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
      // Same as the still path: an explicit animate failure is the loud,
      // assertive error, never the quiet draft variant.
      errorBox.classList.remove('draft');
      errorBox.setAttribute('role', 'alert');
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
  let rafHandle = null;
  let lastAdvance = 0;

  function draw(i) {
    idx = i;
    ctx.drawImage(bitmaps[i], 0, 0);
    scrubber.value = String(i);
    // aria-valuetext so a screen reader announces the 1-based "frame 2 of 3"
    // that matches the visible readout, not the raw 0-indexed slider value.
    scrubber.setAttribute('aria-valuetext', `frame ${i + 1} of ${bitmaps.length}`);
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

  function triggerDownload(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Sequential per-frame PNG download: the raw blob URLs we already hold, named
  // frame001.png, frame002.png, ... Also the degraded path when WebM has no codec.
  function downloadFramesAsPng() {
    urls.forEach((url, i) => {
      triggerDownload(url, `frame${String(i + 1).padStart(3, '0')}.png`);
    });
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

  function pickMime() {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? null;
  }

  function canWebm() {
    return pickMime() !== null;
  }

  // WebM via MediaRecorder over a canvas captureStream: the one lossy/codec path
  // (GIF + APNG are deterministic client-side encodes). Records real-time
  // playback, so it takes ~clip-length to finish.
  async function exportWebm() {
    const mime = pickMime();
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
    if (format === 'png' || (format === 'webm' && !canWebm())) {
      downloadFramesAsPng();
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
      else await exportWebm();
    } finally {
      exporting = false;
      exportBtn.disabled = false;
      exportBtn.textContent = prevLabel;
    }
  }

  function hasFrames() {
    return bitmaps.length > 0;
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
const player = createPlayer();

// ---- mode toggle + plate routing ----

function setMode(next) {
  if (next === mode) return;
  if (abortCtl) return; // an explicit/animate render locks the mode
  // A live draft is still-only; aborting it must not block the switch (its
  // finally re-checks mode and won't reschedule in animate).
  if (draftCtl) draftCtl.abort();
  clearTimeout(draftTimer);
  draftTimer = null;
  mode = next;
  applyMode();
  // Re-derive the footer so it agrees with the new plate. Without this #status
  // keeps the prior mode's text (a "live draft · WxH" line lingering in animate
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
    setStatus(hasStillImage ? 'render ready' : 'no render yet', 'idle');
  }
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

// Live-draft toggle: reflect the restored state, then flip + persist on click.
// Turning it on schedules a draft; turning it off cancels any pending/in-flight
// draft (no accent: it's the quiet grey .toggle-btn invert).
liveToggle.setAttribute('aria-pressed', String(liveDraft));
liveToggle.addEventListener('click', () => {
  liveDraft = !liveDraft;
  liveToggle.setAttribute('aria-pressed', String(liveDraft));
  scheduleSave();
  if (liveDraft) {
    scheduleDraft();
  } else {
    clearTimeout(draftTimer);
    draftTimer = null;
    draftCtl?.abort();
    // Drop the "live draft · …" label so the now-frozen, editable preview isn't
    // still announced as live. Only when the footer is actually showing a draft
    // line (don't clobber a real render's done/error payoff).
    if (status.dataset.state === 'draft') setStatus('live off', 'idle');
  }
});
playBtn.addEventListener('click', () => player.toggle());
scrubber.addEventListener('input', () => player.seek(Number(scrubber.value)));
loopBtn.addEventListener('click', () => {
  player.setLoop(loopBtn.getAttribute('aria-pressed') !== 'true');
});
exportBtn.addEventListener('click', () => player.exportAs(exportFormat.value));
// Drop the WebM option where MediaRecorder has no webm codec (e.g. some Safari):
// GIF/APNG/PNG cover every browser deterministically, so a dead option would
// just mislead. GIF stays the default (first option) regardless.
/* c8 ignore next 3 -- Chromium (the only coverage browser) always has a webm codec, so this Safari-only option removal never runs under the gate */
if (!player.canWebm()) {
  exportFormat.querySelector('option[value="webm"]')?.remove();
}

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
  widthInput.value = state.width;
  heightInput.value = state.height;
  // Only adopt a select value the markup actually offers; an out-of-range
  // payload leaves the current option (matches the saved-state restore guard).
  if (Array.from(qualitySelect.options).some((o) => o.value === state.quality)) {
    qualitySelect.value = state.quality;
  }
  if (Array.from(antialiasSelect.options).some((o) => o.value === state.antialias)) {
    antialiasSelect.value = state.antialias;
  }
  threadsInput.value = state.threads;
  // flags is optional on PermalinkState (older links predate the field); a
  // non-string payload clears the field rather than writing junk into it.
  flagsInput.value = typeof state.flags === 'string' ? state.flags : '';
  framesInput.value = state.frames;
  fpsInput.value = state.fps;
  player.setFps(Number(fpsInput.value));
  // setMode() no-ops when next === current and would skip applyMode(); set the
  // var + applyMode() directly so the plate/toggles always reflect the payload.
  mode = state.mode;
  applyMode();
  // A permalink replaces "what counts as the loaded scene": clear the example
  // dirty-baseline so the next example switch doesn't treat this as example text.
  lastLoadedSource = state.source;
  renderGutter();
  paintHighlight();
  scheduleSave();
  scheduleDraft();
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
  // URL until the scene is edited, at which point syncPermalinkHash unpins to a
  // self-contained #hash. startRender() supersedes any in-flight draft and
  // self-guards on busy / non-isolated, so it is safe to fire right after.
  gistId = id;
  gistSource = source;
  editor.value = source;
  renderGutter();
  paintHighlight();
  scheduleSave();
  startRender();
}

// Deep-link precedence on load: a #<permalink> hash wins over ?gist, which wins
// over the already-applied saved/default scene. The permalink decode is async
// and tolerant (decodeState returns null on garbage); a null falls through to
// the gist/cold-load path so a junk hash never strands the page. Without the
// final scheduleDraft a cold page load sits on the empty-state hint until the
// first keystroke, which reads as "live is broken" (it isn't); scheduleDraft()
// self-guards to still-mode + liveDraft, so animate or a live-off preference
// render nothing. Both a hash and a successful ?gist are LEFT in the bar (the
// hash is self-contained; ?gist is the short shareable permalink until the scene
// is edited), so a reload of either reproduces the shared scene.
const permalinkPayload = location.hash.slice(1);
const gistParam = new URLSearchParams(location.search).get('gist');
if (permalinkPayload) {
  decodeState(permalinkPayload).then((state) => {
    if (state) {
      hydrateFromState(state);
    } else if (gistParam) {
      loadGistScene(gistParam);
    } else {
      scheduleDraft();
    }
  });
} else if (gistParam) {
  loadGistScene(gistParam);
} else {
  scheduleDraft();
}

renderBtn.addEventListener('click', startRender);
cancelBtn.addEventListener('click', () => abortCtl?.abort());

// Copy the current scene's shareable URL to the clipboard and flash the button
// label. The address bar is already kept live by syncPermalinkHash (debounced on
// every change); Copy Link is the explicit "give it to me now" action and routes
// through the same sync, so it copies the canonical URL (the short ?gist link
// while an unmodified gist is pinned, otherwise a fresh self-contained #hash).
// On a clipboard rejection the bar still updated, so the URL stays selectable.
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
  // Make the address bar exact first: the pinned ?gist URL when an unmodified
  // gist is showing, otherwise a freshly-encoded #hash. Then copy whatever it
  // now reads (syncPermalinkHash re-encodes from live state, so the copied link
  // is exact even between debounce ticks, and the bar matches regardless of the
  // clipboard outcome).
  await syncPermalinkHash();
  try {
    await navigator.clipboard.writeText(location.href);
    flashCopyLabel('Copied');
  } catch {
    /* c8 ignore next 2 -- clipboard.writeText rejects only on a denied permission / insecure context the COOP/COEP secure-context test page can't reach */
    flashCopyLabel('Copy failed');
  }
}
copyLinkBtn.addEventListener('click', copyPermalink);

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
  } else if (draftCtl) {
    liveDraft = false;
    liveToggle.setAttribute('aria-pressed', 'false');
    clearTimeout(draftTimer);
    draftTimer = null;
    draftCtl.abort();
    scheduleSave();
    // The stop button is only visible mid-draft, so the footer is in the
    // 'draft' state here; drop the "live draft · …" label so the now-frozen,
    // editable preview isn't still announced as live.
    setStatus('live off', 'idle');
  }
});

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
