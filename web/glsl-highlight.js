// GLSL syntax highlighter, a sibling of highlight.js for the generated-shader
// view (povrayer turbo compiles SDL to a fragment shader and shows it). Same
// contract as the SDL highlighter so the two can share an overlay and a palette:
//
//   - `highlight(source)` returns an HTML string for an overlay <code>, with the
//     source HTML-ESCAPED FIRST (GLSL is full of `<`, `>`, `&`: `a < b`, `x>>1`,
//     `&&`), so the overlay can never break or inject markup.
//   - The same byte-faithful invariant holds: htmlUnescape(stripTags(highlight(s)))
//     === s, so an overlay's text stays aligned with a textarea underneath it.
//   - Only the language vocabulary lights up; operators and the user's own names
//     stay default text. The SAME six tok-* classes as highlight.js are emitted
//     (tok-comment / tok-keyword / tok-builtin / tok-string / tok-number /
//     tok-directive), so one CSS palette covers both languages.
//
// Pure, DOM-free, no deps, like its SDL sibling.

// Preprocessor directives, matched as `#` + word -> tok-directive (GLSL's `#`
// directives, plus the ES `#version`/`#extension` turbo emits).
export const GLSL_DIRECTIVES = new Set([
  'version',
  'define',
  'undef',
  'if',
  'ifdef',
  'ifndef',
  'else',
  'elif',
  'endif',
  'error',
  'pragma',
  'extension',
  'line',
  'include',
]);

// Types, qualifiers, and control flow -> tok-keyword (the structural skeleton).
export const GLSL_KEYWORDS = new Set([
  // control flow
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'discard',
  // declarations / qualifiers
  'const',
  'uniform',
  'buffer',
  'shared',
  'attribute',
  'varying',
  'in',
  'out',
  'inout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'invariant',
  'precise',
  'layout',
  'precision',
  'highp',
  'mediump',
  'lowp',
  'struct',
  // scalar / vector / matrix types
  'void',
  'bool',
  'int',
  'uint',
  'float',
  'double',
  'vec2',
  'vec3',
  'vec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'dvec2',
  'dvec3',
  'dvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  // opaque / sampler types
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DArray',
  'sampler2DShadow',
  'samplerCubeShadow',
  'isampler2D',
  'isampler3D',
  'usampler2D',
  'usampler3D',
]);

// Built-in functions, plus the built-in `gl_*` variables and a couple of
// reserved constants -> tok-builtin (mirrors highlight.js's x/y/z/clock tier).
export const GLSL_BUILTINS = new Set([
  // trig / exponential
  'radians',
  'degrees',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'pow',
  'exp',
  'log',
  'exp2',
  'log2',
  'sqrt',
  'inversesqrt',
  // common
  'abs',
  'sign',
  'floor',
  'trunc',
  'round',
  'roundEven',
  'ceil',
  'fract',
  'mod',
  'modf',
  'min',
  'max',
  'clamp',
  'mix',
  'step',
  'smoothstep',
  'isnan',
  'isinf',
  'floatBitsToInt',
  'intBitsToFloat',
  // geometric
  'length',
  'distance',
  'dot',
  'cross',
  'normalize',
  'faceforward',
  'reflect',
  'refract',
  // matrix / vector relational
  'matrixCompMult',
  'outerProduct',
  'transpose',
  'determinant',
  'inverse',
  'lessThan',
  'lessThanEqual',
  'greaterThan',
  'greaterThanEqual',
  'equal',
  'notEqual',
  'any',
  'all',
  'not',
  // texture / derivative / misc
  'texture',
  'textureLod',
  'textureProj',
  'textureGrad',
  'textureOffset',
  'texelFetch',
  'textureSize',
  'dFdx',
  'dFdy',
  'fwidth',
  // built-in variables / constants
  'gl_Position',
  'gl_PointSize',
  'gl_FragCoord',
  'gl_FrontFacing',
  'gl_FragDepth',
  'gl_PointCoord',
  'gl_VertexID',
  'gl_InstanceID',
  'gl_PrimitiveID',
  'true',
  'false',
]);

// Matches GLSL numbers: hex ints (0x1Au), then floats (1.5, .5, 1e3, 1.0f), then
// plain ints (10, 10u). A leading `-` is left out so it stays an operator, like
// the SDL highlighter. Sticky so it only matches at the scan position.
const GLSL_NUMBER_RE =
  /0[xX][0-9a-fA-F]+[uU]?|\d*\.\d+(?:[eE][+-]?\d+)?[fF]?|\d+\.?\d*(?:[eE][+-]?\d+)?[fFuU]?/y;
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
 * Tokenize GLSL into safe, syntax-colored HTML. Single O(n) forward scan, same
 * shape as highlight.js: whitespace, `//` and nested-free `/* *\/` comments,
 * `"..."` strings, `#`+directive, number, identifier, then any other char. Every
 * emitted chunk is HTML-escaped, so the output is well-formed and byte-faithful.
 *
 * @param {string} source raw shader text
 * @returns {string} HTML for an overlay's <code> element
 */
export function highlight(source) {
  const src = String(source);
  const n = src.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = src[i];

    WS_RE.lastIndex = i;
    const ws = WS_RE.exec(src);
    if (ws) {
      out += esc(ws[0]);
      i += ws[0].length;
      continue;
    }

    // line comment: // ... to end of line
    if (src.startsWith('//', i)) {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      out += span('tok-comment', src.slice(i, j));
      i = j;
      continue;
    }

    // block comment: /* ... */ (GLSL block comments do NOT nest; first */ ends it)
    if (src.startsWith('/*', i)) {
      let j = i + 2;
      while (j < n && !src.startsWith('*/', j)) j++;
      j = j < n ? j + 2 : n; // include the closing */, or run to EOF if unterminated
      out += span('tok-comment', src.slice(i, j));
      i = j;
      continue;
    }

    // string: "..." honoring \" escapes; an unterminated string runs to EOL
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '"') {
          j++;
          break;
        }
        if (c === '\n') break;
        j++;
      }
      out += span('tok-string', src.slice(i, j));
      i = j;
      continue;
    }

    // directive: `#` + a known preprocessor word; a bare `#` falls through
    if (ch === '#') {
      const word = identAt(src, i + 1);
      if (GLSL_DIRECTIVES.has(word)) {
        out += span('tok-directive', '#' + word);
        i += 1 + word.length;
      } else {
        out += esc('#');
        i += 1;
      }
      continue;
    }

    // number (leading `-` excluded on purpose; it stays an operator)
    GLSL_NUMBER_RE.lastIndex = i;
    const num = GLSL_NUMBER_RE.exec(src);
    if (num && num.index === i) {
      out += span('tok-number', num[0]);
      i += num[0].length;
      continue;
    }

    // identifier: keyword / builtin get a span; user names stay default text
    const word = identAt(src, i);
    if (word) {
      if (GLSL_KEYWORDS.has(word)) out += span('tok-keyword', word);
      else if (GLSL_BUILTINS.has(word)) out += span('tok-builtin', word);
      else out += esc(word);
      i += word.length;
      continue;
    }

    // any other single char: operators, punctuation, `< > { } ( ) ; ,` etc.
    out += esc(ch);
    i += 1;
  }

  return out;
}
