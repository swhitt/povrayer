// Autocomplete logic for the SDL editor. Pure and DOM-free: every function here
// takes text + a caret offset and returns plain data (candidate lists, a
// replacement range, the post-insert text + caret). The popup itself (caret
// positioning, keyboard nav, rendering) lives in ui.js; this module is the part
// that node-unit-tests to 100% without a browser.
//
// Three candidate sources, one ranking:
//   1. the language vocabulary, reused from highlight.js so it can't drift from
//      what the editor colors (keywords, math/vector builtins, # directives);
//   2. the include library's shipped identifiers, from includes-manifest.json
//      (passed in as `symbols`, so this stays pure);
//   3. the scene's own #declare / #local / #macro names, scanned live from the
//      buffer so a user's definitions complete the moment they exist.

import { DIRECTIVES, KEYWORDS, BUILTINS } from './highlight.js';

/**
 * @typedef {object} Candidate
 * @property {string} name
 * @property {string} kind  keyword | builtin | directive | scene | texture | finish | macro | ...
 * @property {string} [file]  include file the symbol ships in (manifest entries)
 * @property {string[]} [params]  parameter names (macros)
 */

/**
 * The identifier being typed immediately to the LEFT of the caret. Walks back
 * over word characters; if that run starts with a digit it's a number, not an
 * identifier, so no completion is offered. `hashed` reports whether a `#`
 * directly precedes the run (so the caller can switch to directive candidates).
 *
 * @param {string} text
 * @param {number} caret
 * @returns {{ start: number, end: number, word: string, hashed: boolean }}
 */
export function tokenAt(text, caret) {
  let start = caret;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  const word = text.slice(start, caret);
  // A run that begins with a digit (e.g. mid-number) is not an identifier.
  if (word.length > 0 && !/^[A-Za-z_]/.test(word)) {
    return { start: caret, end: caret, word: '', hashed: false };
  }
  const hashed = start > 0 && text[start - 1] === '#';
  return { start, end: caret, word, hashed };
}

/**
 * Match tier for a candidate name against a query (lower is better):
 *   0 case-sensitive prefix, 1 case-insensitive prefix, 2 substring, -1 no match.
 *
 * @param {string} name
 * @param {string} q  raw query
 * @param {string} qLower  query lowercased once by the caller
 * @returns {number}
 */
function tier(name, q, qLower) {
  if (name.startsWith(q)) return 0;
  const lower = name.toLowerCase();
  if (lower.startsWith(qLower)) return 1;
  if (lower.includes(qLower)) return 2;
  return -1;
}

// POV-Ray's stdlib leaks `__`-prefixed internals (e.g. __FU, __Gradient_Fn_*)
// into the include namespace. They're real, so they stay completable, but they
// sink within a match tier so `F`+Tab never surfaces a double-underscore helper
// ahead of an ordinary finish. Booleans subtract as 0/1.
const isInternal = (name) => (name.startsWith('__') ? 1 : 0);

/**
 * Rank candidates for a query. Prefix beats substring, exact-case beats
 * case-folded, internal `__` names sink within a tier, then shorter names, then
 * alphabetical, so the list is stable and the best match sits first (ready to
 * accept with Enter). An empty query matches everything (the Ctrl+Space "browse"
 * case), capped by `limit`.
 *
 * @param {string} query
 * @param {Candidate[]} candidates
 * @param {number} [limit]
 * @returns {Candidate[]}
 */
export function rank(query, candidates, limit = 50) {
  const qLower = query.toLowerCase();
  const scored = [];
  for (const c of candidates) {
    const t = query === '' ? 1 : tier(c.name, query, qLower);
    if (t < 0) continue;
    scored.push({ c, t });
  }
  scored.sort(
    (a, b) =>
      a.t - b.t ||
      isInternal(a.c.name) - isInternal(b.c.name) ||
      a.c.name.length - b.c.name.length ||
      (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0)
  );
  return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Build the static candidate pool: the editor's keyword + builtin vocabulary
 * merged with the include library's symbols. Directives are NOT here (they only
 * apply right after a `#`; see directivePool).
 *
 * @param {Candidate[]} [symbols]  includes-manifest symbols
 * @returns {Candidate[]}
 */
export function buildPool(symbols = []) {
  /** @type {Candidate[]} */
  const pool = [];
  for (const name of KEYWORDS) pool.push({ name, kind: 'keyword' });
  for (const name of BUILTINS) pool.push({ name, kind: 'builtin' });
  for (const s of symbols) pool.push(s);
  return pool;
}

/** Candidate list for the post-`#` position: the preprocessor directives. */
export function directivePool() {
  return [...DIRECTIVES].map((name) => ({ name, kind: 'directive' }));
}

const BUFFER_DECL_RE = /#(?:declare|local)\s+([A-Za-z_]\w*)/g;
const BUFFER_MACRO_RE = /#macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;

/**
 * Scan the buffer for the scene's own definitions so they complete too. The
 * in-progress token (`exclude`) is skipped so a half-typed `#declare Foo|`
 * doesn't suggest `Foo` back to itself.
 *
 * This deliberately does NOT strip comments/strings (unlike the build-time
 * parser): it runs on every keystroke, so a `#declare` sitting in a comment or a
 * "..." string can surface as a phantom candidate. That's cheap and low-harm (a
 * commented-out definition completing is at worst mildly surprising), and it
 * keeps the hot path a single regex pass.
 *
 * @param {string} text
 * @param {string} exclude  the identifier currently being typed
 * @returns {Candidate[]}
 */
export function scanBufferSymbols(text, exclude) {
  /** @type {Map<string, Candidate>} */
  const found = new Map();
  for (let m = BUFFER_DECL_RE.exec(text); m; m = BUFFER_DECL_RE.exec(text)) {
    const name = m[1];
    if (name !== exclude && !found.has(name)) found.set(name, { name, kind: 'scene' });
  }
  for (let m = BUFFER_MACRO_RE.exec(text); m; m = BUFFER_MACRO_RE.exec(text)) {
    const name = m[1];
    if (name === exclude || found.has(name)) continue;
    // Split on commas AND whitespace: params are always bare identifiers.
    const params = m[2].split(/[\s,]+/).filter((p) => p.length > 0);
    found.set(name, { name, kind: 'macro', params });
  }
  return [...found.values()];
}

/**
 * The display signature for a macro candidate, e.g. `(A, B)` (or `()` for a
 * no-arg macro). Empty string for anything that isn't a macro.
 *
 * @param {Candidate} candidate
 * @returns {string}
 */
export function signatureText(candidate) {
  if (candidate.kind !== 'macro' || !candidate.params) return '';
  return '(' + candidate.params.join(', ') + ')';
}

/**
 * Compute the completion offer for a caret position, or null when there's
 * nothing to offer (token shorter than minLength, or no matches). `from`/`to`
 * is the range the accepted text replaces.
 *
 * @param {string} text
 * @param {number} caret
 * @param {Candidate[]} pool  result of buildPool()
 * @param {{ minLength?: number, limit?: number }} [opts]
 * @returns {{ from: number, to: number, query: string, items: Candidate[] } | null}
 */
export function complete(text, caret, pool, opts = {}) {
  const minLength = opts.minLength ?? 1;
  const limit = opts.limit ?? 50;
  const tok = tokenAt(text, caret);
  if (tok.word.length < minLength) return null;
  // Scene definitions take precedence over a library symbol of the same name
  // (the user redefining `Brass` means their `Brass`), so buffer symbols go
  // first and shadow any pool entry sharing their name.
  const buffer = tok.hashed ? [] : scanBufferSymbols(text, tok.word);
  const shadowed = new Set(buffer.map((c) => c.name));
  const candidates = tok.hashed
    ? directivePool()
    : buffer.concat(pool.filter((c) => !shadowed.has(c.name)));
  const items = rank(tok.word, candidates, limit);
  if (items.length === 0) return null;
  return { from: tok.start, to: tok.end, query: tok.word, items };
}

/**
 * Apply a chosen candidate to the text. Macros insert `name()` with the caret
 * placed inside the parens when they take arguments (ready to type them) or
 * after the closing paren when they don't. Everything else inserts the bare
 * name with the caret after it.
 *
 * @param {string} text
 * @param {{ from: number, to: number }} range
 * @param {Candidate} candidate
 * @returns {{ text: string, caret: number }}
 */
export function applyCompletion(text, range, candidate) {
  let insert;
  let caretOffset;
  if (candidate.kind === 'macro') {
    insert = candidate.name + '()';
    caretOffset =
      candidate.params && candidate.params.length > 0 ? candidate.name.length + 1 : insert.length;
  } else {
    insert = candidate.name;
    caretOffset = insert.length;
  }
  const before = text.slice(0, range.from);
  const after = text.slice(range.to);
  return { text: before + insert + after, caret: range.from + caretOffset };
}
