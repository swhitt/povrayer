// Extract the user-facing identifiers a scene can reference from the POV-Ray
// standard include library plus the bundled Lightsys IV files. The output feeds
// the editor's autocomplete: typing `T_` should surface the REAL textures this
// build ships (T_Stone1..44, T_Gold_*, ...), not a hand-maintained list that
// drifts from what the renderer actually has.
//
// Pure on purpose: the generator (generate.mjs) fetches the pinned sources and
// hands their text here, but this module never touches the network or the
// filesystem, so it unit-tests against small fixtures. Determinism is a hard
// requirement (the result is committed): files are processed in name order,
// duplicate identifiers resolve first-wins, and the symbol list is sorted by
// name, so the same inputs always yield byte-identical output.
// web/sdl-strip.ts, via its compiled artifact: Node cannot import .ts on the
// Node 20 line the project still supports, so `npm run gen:manifest` builds
// _build/web first (see the pregen:manifest hook and tools/build-web.mjs).
import { stripCommentsAndStrings } from '../../_build/web/sdl-strip.js';

// Color constructors and the `color`/`colour` keyword: all collapse to one kind.
const COLOR = new Set([
  'color',
  'colour',
  'rgb',
  'rgbf',
  'rgbt',
  'rgbft',
  'srgb',
  'srgbf',
  'srgbt',
  'srgbft',
]);

// Spline declarations (the leading keyword names the interpolation).
const SPLINE = new Set([
  'spline',
  'linear_spline',
  'quadratic_spline',
  'cubic_spline',
  'natural_spline',
  'bezier_spline',
]);

// Material-ish blocks whose own keyword IS the kind we want to show. `colour`
// is handled by COLOR; `interior_texture` reads as a texture to a user.
const NAMED = new Set([
  'texture',
  'pigment',
  'normal',
  'finish',
  'interior',
  'material',
  'media',
  'density',
]);

// Geometry: every leading keyword here means "this identifier is an object".
const OBJECT = new Set([
  'union',
  'difference',
  'intersection',
  'merge',
  'object',
  'box',
  'sphere',
  'cylinder',
  'cone',
  'plane',
  'torus',
  'prism',
  'blob',
  'lathe',
  'sor',
  'disc',
  'triangle',
  'mesh',
  'mesh2',
  'polygon',
  'text',
  'superellipsoid',
  'height_field',
  'isosurface',
  'ovus',
  'parametric',
  'sphere_sweep',
  'julia_fractal',
  'quadric',
  'quartic',
  'cubic',
  'poly',
  'bicubic_patch',
]);

/**
 * Map the first keyword on a declaration's right-hand side to a short kind tag
 * the popup shows dim next to the name. Anything we don't recognize (a bare
 * float, an alias to another identifier, a pattern keyword) falls through to
 * 'value', which is a fine catch-all for the readout. SDL is case-sensitive, so
 * the word is matched as written.
 *
 * @param {string} word the leading RHS identifier
 * @returns {string}
 */
export function classifyKind(word) {
  if (COLOR.has(word)) return 'color';
  if (word === 'function') return 'function';
  if (SPLINE.has(word)) return 'spline';
  if (word === 'array') return 'array';
  if (word === 'interior_texture') return 'texture';
  if (NAMED.has(word)) return word;
  if (OBJECT.has(word)) return 'object';
  if (word === 'transform' || word === 'matrix') return 'transform';
  if (word === 'version') return 'version'; // the #declare X = version save/restore dance; filtered out
  return 'value';
}

// `#declare NAME = <lead>` where lead is the first RHS token: an identifier, a
// `<` (vector), or a numeric sign/digit. \s spans newlines, so a multi-line
// `#declare T_Grnt0 =\n  texture {` still captures `texture`.
const DECLARE_RE = /#declare\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*|<|[-+.\d])?/g;

// `#macro NAME(params)`. Params are bare identifiers in the stdlib (no nested
// parens, no defaults), so a non-greedy `[^)]*` captures the whole list.
const MACRO_RE = /#macro\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;

/** Internal version save temporaries (`#declare Foo_Inc_Temp = version;`). */
const TEMP_RE = /_inc_temp$/i;

/**
 * Split a macro parameter list into bare identifier names. Splits on commas AND
 * whitespace (POV-Ray macro params are always single identifiers, never types or
 * defaults), so it both trims normal lists and recovers params the stdlib forgot
 * to comma-separate: shapes3.inc's Half_Hollowed_Rounded_Cylinder2 has a comma
 * hidden inside a comment, leaving `Border_Scale_y_ <newline> Merge_On` as one
 * comma-segment that must still resolve to two names. Comments were already
 * blanked by stripCommentsAndStrings.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function splitParams(raw) {
  return raw.split(/[\s,]+/).filter((p) => p.length > 0);
}

/**
 * @typedef {object} IncludeSymbol
 * @property {string} name  the identifier as a scene would write it
 * @property {string} kind  short tag: texture/finish/pigment/color/function/spline/object/transform/array/macro/value
 * @property {string} file  the .inc file it's declared in
 * @property {string[]} [params]  macro parameter names (macros only)
 */

/**
 * Extract every user-facing identifier from a set of include files.
 *
 * @param {{ name: string, text: string }[]} files
 * @returns {IncludeSymbol[]} sorted by name, deduped first-wins
 */
export function parseManifest(files) {
  /** @type {Map<string, IncludeSymbol>} */
  const byName = new Map();
  // Process files in name order so first-wins dedup is deterministic.
  const ordered = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const { name: file, text } of ordered) {
    const cleaned = stripCommentsAndStrings(text);

    DECLARE_RE.lastIndex = 0;
    for (let m = DECLARE_RE.exec(cleaned); m; m = DECLARE_RE.exec(cleaned)) {
      const ident = m[1];
      if (TEMP_RE.test(ident)) continue;
      const lead = m[2];
      let kind;
      if (lead == null) kind = 'value';
      else if (lead === '<') kind = 'vector';
      else if (/^[-+.\d]$/.test(lead)) kind = 'float';
      else kind = classifyKind(lead);
      if (kind === 'version') continue;
      if (!byName.has(ident)) byName.set(ident, { name: ident, kind, file });
    }

    MACRO_RE.lastIndex = 0;
    for (let m = MACRO_RE.exec(cleaned); m; m = MACRO_RE.exec(cleaned)) {
      const ident = m[1];
      if (TEMP_RE.test(ident)) continue;
      if (!byName.has(ident)) {
        byName.set(ident, { name: ident, kind: 'macro', file, params: splitParams(m[2]) });
      }
    }
  }

  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
