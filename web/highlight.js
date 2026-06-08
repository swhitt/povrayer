// SDL syntax highlighter for the editor overlay. Pure, DOM-free, no deps.
//
// `highlight(source)` returns an HTML string the overlay <code> renders behind
// a transparent textarea. The hard requirement: the source is HTML-ESCAPED
// FIRST (POV-Ray SDL is full of `<`, `>`, `&` in vectors / rgb<...> / `#if (A <
// B)`), so the overlay can never break or inject markup. Quotes are NOT escaped
// because the highlighted text is only ever element *content*, never an
// attribute value.
//
// Invariant the tests pin: htmlUnescape(stripTags(highlight(src))) === src for
// every example scene, so the overlay text is byte-identical to the textarea
// and the two layers can't drift out of alignment.
//
// Only the language vocabulary lights up. Punctuation and operators (`< > { } (
// ) , = * + - /`) stay default --text on purpose, so dense vectors don't turn
// garish, and the user's own #declare/#macro names stay neutral (they're in no
// vocabulary Set, so they get no span).

// Preprocessor directives, matched as `#` + word -> tok-directive. A `#` not
// followed by one of these emits a bare `#` and lets the word fall through as a
// plain identifier.
const DIRECTIVES = new Set([
  'version',
  'declare',
  'local',
  'include',
  'undef',
  'fopen',
  'fclose',
  'read',
  'write',
  'default',
  'macro',
  'if',
  'ifdef',
  'ifndef',
  'else',
  'elseif',
  'end',
  'while',
  'for',
  'switch',
  'case',
  'range',
  'break',
  'debug',
  'warning',
  'error',
  'render',
  'statistics',
]);

// Structural SDL vocabulary -> tok-keyword. One class, grouped only for human
// readability; membership affects beauty/correctness, never coverage.
const KEYWORDS = new Set([
  // objects / CSG
  'blob',
  'box',
  'cone',
  'cylinder',
  'difference',
  'disc',
  'height_field',
  'intersection',
  'isosurface',
  'julia_fractal',
  'lathe',
  'light_source',
  'merge',
  'mesh',
  'mesh2',
  'object',
  'ovus',
  'parametric',
  'plane',
  'polygon',
  'prism',
  'quadric',
  'quartic',
  'sphere',
  'sphere_sweep',
  'superellipsoid',
  'text',
  'torus',
  'triangle',
  'smooth_triangle',
  'union',
  'bicubic_patch',
  'sor',
  // scene
  'camera',
  'global_settings',
  'light_group',
  'sky_sphere',
  'rainbow',
  'fog',
  'media',
  'background',
  'photons',
  'radiosity',
  'looks_like',
  // camera params
  'location',
  'look_at',
  'right',
  'up',
  'direction',
  'angle',
  'sky',
  'aperture',
  'blur_samples',
  'focal_point',
  'confidence',
  'variance',
  'perspective',
  'orthographic',
  'panoramic',
  // texture / material
  'texture',
  'pigment',
  'normal',
  'finish',
  'interior',
  'interior_texture',
  'material',
  'texture_map',
  'pigment_map',
  'normal_map',
  'color_map',
  'colour_map',
  'slope_map',
  'density',
  'density_map',
  'warp',
  'uv_mapping',
  // patterns
  'agate',
  'average',
  'bozo',
  'brick',
  'bumps',
  'cells',
  'checker',
  'crackle',
  'cylindrical',
  'dents',
  'facets',
  'function',
  'gradient',
  'granite',
  'hexagon',
  'leopard',
  'marble',
  'onion',
  'planar',
  'quilted',
  'radial',
  'ripples',
  'slope',
  'spherical',
  'spiral1',
  'spiral2',
  'spotted',
  'waves',
  'wood',
  'wrinkles',
  'image_map',
  'bump_map',
  // color
  'rgb',
  'rgbf',
  'rgbt',
  'rgbft',
  'color',
  'colour',
  'red',
  'green',
  'blue',
  'filter',
  'transmit',
  'srgb',
  // finish
  'ambient',
  'diffuse',
  'brilliance',
  'specular',
  'roughness',
  'metallic',
  'phong',
  'phong_size',
  'reflection',
  'refraction',
  'emission',
  'crand',
  'conserve_energy',
  'fresnel',
  'irid',
  'subsurface',
  // light
  'area_light',
  'spotlight',
  'shadowless',
  'point_at',
  'radius',
  'falloff',
  'tightness',
  'fade_distance',
  'fade_power',
  'adaptive',
  'jitter',
  'circular',
  'orient',
  'parallel',
  'projected_through',
  'media_attenuation',
  'media_interaction',
  // interior / media
  'ior',
  'caustics',
  'dispersion',
  'dispersion_samples',
  'fade_color',
  'absorption',
  'scattering',
  'extinction',
  'intervals',
  'samples',
  'method',
  // transforms / modifiers
  'translate',
  'rotate',
  'scale',
  'matrix',
  'transform',
  'no_shadow',
  'no_image',
  'no_reflection',
  'hollow',
  'inverse',
  'open',
  'double_illuminate',
  'clipped_by',
  'bounded_by',
  'contained_by',
  'threshold',
  'accuracy',
  'max_gradient',
  'sturm',
  'smooth',
  'turbulence',
  'octaves',
  'omega',
  'lambda',
  'frequency',
  'phase',
  // global / radiosity / fog
  'assumed_gamma',
  'max_trace_level',
  'adc_bailout',
  'ambient_light',
  'count',
  'error_bound',
  'gray_threshold',
  'nearest_count',
  'recursion_limit',
  'minimum_reuse',
  'pretrace_start',
  'pretrace_end',
  'brightness',
  'fog_type',
  'distance',
  'fog_offset',
  'fog_alt',
  // misc
  'array',
  'spline',
  'linear_spline',
  'quadratic_spline',
  'cubic_spline',
  'natural_spline',
]);

// Math / vector functions plus reserved coordinate/value identifiers ->
// tok-builtin (x/y/z/clock/pi and friends).
const BUILTINS = new Set([
  // functions
  'abs',
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'ceil',
  'cos',
  'cosh',
  'degrees',
  'div',
  'exp',
  'floor',
  'int',
  'ln',
  'log',
  'max',
  'min',
  'mod',
  'pow',
  'prod',
  'radians',
  'rand',
  'seed',
  'select',
  'sin',
  'sinh',
  'sqrt',
  'strcmp',
  'strlen',
  'sum',
  'tan',
  'tanh',
  'val',
  'vaxis_rotate',
  'vcross',
  'vdot',
  'vlength',
  'vnormalize',
  'vrotate',
  'vturbulence',
  // coordinate / value identifiers
  'x',
  'y',
  'z',
  'u',
  'v',
  't',
  'clock',
  'clock_delta',
  'clock_on',
  'pi',
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'final_clock',
  'initial_clock',
  'frame_number',
]);

// Matches 1, 1., 1.5, .5, 1e3, 1.5e-3, 2E10. A leading `-` is intentionally
// left out (it stays an operator), so vectors like <-1,2,3> keep the minus in
// default text. Sticky so it only ever matches at the scan position.
const NUMBER_RE = /\d*\.\d+(?:[eE][+-]?\d+)?|\d+\.?\d*(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_]\w*/y;
const WS_RE = /\s+/y;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** HTML-escape the three characters that could break or inject markup. */
function esc(s) {
  return s.replace(/[&<>]/g, (c) => ESCAPES[c]);
}

/** Wrap escaped token text in a class-tagged span. */
function span(cls, text) {
  return `<span class="${cls}">${esc(text)}</span>`;
}

/** The identifier starting at `pos`, or '' if there isn't one there. */
function identAt(src, pos) {
  IDENT_RE.lastIndex = pos;
  const m = IDENT_RE.exec(src);
  return m ? m[0] : '';
}

/**
 * Tokenize POV-Ray SDL into safe, syntax-colored HTML.
 *
 * Single O(n) forward scan. At each position it tries, in order: whitespace
 * run, `//` line comment, `/* *\/` block comment (NESTED, depth-counted like
 * POV-Ray; unterminated runs to EOF), `"..."` string (honors `\"`; unterminated
 * runs to EOL), `#`+directive, number, identifier, then any other single char.
 * Every chunk emitted (token text AND the punctuation/whitespace passed through)
 * is HTML-escaped, so the output is always well-formed and byte-faithful.
 *
 * @param {string} source raw editor text
 * @returns {string} HTML for the overlay's <code> element
 */
export function highlight(source) {
  const src = String(source);
  const n = src.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = src[i];

    // whitespace run (no span; escaped for the byte-faithful invariant)
    WS_RE.lastIndex = i;
    const ws = WS_RE.exec(src);
    if (ws) {
      out += esc(ws[0]);
      i += ws[0].length;
      continue;
    }

    // line comment: // ... to end of line (the newline is left for the next pass)
    if (src.startsWith('//', i)) {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      out += span('tok-comment', src.slice(i, j));
      i = j;
      continue;
    }

    // block comment: /* ... */, NESTED like POV-Ray 3.8 (depth-counted).
    // An unterminated comment runs to EOF.
    if (src.startsWith('/*', i)) {
      let j = i + 2;
      let depth = 1;
      while (j < n && depth > 0) {
        if (src.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (src.startsWith('*/', j)) {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      out += span('tok-comment', src.slice(i, j));
      i = j;
      continue;
    }

    // string: "..." honoring \" escapes; an unterminated string runs to EOL.
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2; // skip the escaped char (\" stays inside the string)
          continue;
        }
        if (c === '"') {
          j++; // include the closing quote
          break;
        }
        if (c === '\n') break; // unterminated: stop at the line break
        j++;
      }
      out += span('tok-string', src.slice(i, j));
      i = j;
      continue;
    }

    // directive: `#` + a known directive word. A `#` followed by anything else
    // emits a bare `#` and lets the word fall through as a plain identifier.
    if (ch === '#') {
      const word = identAt(src, i + 1);
      if (DIRECTIVES.has(word)) {
        out += span('tok-directive', '#' + word);
        i += 1 + word.length;
      } else {
        out += esc('#');
        i += 1;
      }
      continue;
    }

    // number (leading `-` excluded on purpose; it stays an operator)
    NUMBER_RE.lastIndex = i;
    const num = NUMBER_RE.exec(src);
    if (num) {
      out += span('tok-number', num[0]);
      i += num[0].length;
      continue;
    }

    // identifier: keyword / builtin get a span; user names stay default text
    const word = identAt(src, i);
    if (word) {
      if (KEYWORDS.has(word)) out += span('tok-keyword', word);
      else if (BUILTINS.has(word)) out += span('tok-builtin', word);
      else out += esc(word);
      i += word.length;
      continue;
    }

    // any other single char: operators, punctuation, vector `< >`, etc.
    out += esc(ch);
    i += 1;
  }

  return out;
}
