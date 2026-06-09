// Block-context detection for context-aware completion. SDL nests blocks with
// braces (`texture { pigment { ... } finish { ... } }`), and the identifiers
// that belong in each block differ: `finish {}` wants ambient/diffuse/reflection
// and the F_* finishes, `pigment {}` wants patterns and colors, and so on.
//
// blockContextAt walks the text up to the caret tracking the nested-brace stack
// (skipping comments and strings) and returns the keyword that opened the
// innermost still-open block, or '' at top level. complete() turns that into a
// relevance predicate so the candidates that actually belong in the block sort
// to the top, WITHOUT hiding anything (an out-of-context name the user really
// wants still appears, just lower). Pure and DOM-free, so it node-tests to 100%.

// The SDL keywords meaningful directly inside a given block. Curated for the
// blocks where it pays off most; blocks not listed simply get no keyword boost
// (their manifest-kind boost in CONTEXT_KINDS still applies where relevant).
export const CONTEXT_KEYWORDS = {
  finish: new Set([
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
  ]),
  pigment: new Set([
    'color',
    'colour',
    'rgb',
    'rgbf',
    'rgbt',
    'rgbft',
    'srgb',
    'color_map',
    'pigment_map',
    'gradient',
    'marble',
    'checker',
    'hexagon',
    'brick',
    'agate',
    'bozo',
    'granite',
    'crackle',
    'spotted',
    'wood',
    'onion',
    'radial',
    'image_map',
    'turbulence',
    'warp',
  ]),
  normal: new Set([
    'bumps',
    'dents',
    'ripples',
    'waves',
    'wrinkles',
    'wood',
    'marble',
    'granite',
    'gradient',
    'bump_map',
    'slope_map',
    'normal_map',
    'turbulence',
    'warp',
  ]),
  texture: new Set(['pigment', 'normal', 'finish', 'texture_map', 'uv_mapping']),
  material: new Set(['texture', 'interior', 'interior_texture']),
  interior: new Set([
    'ior',
    'caustics',
    'dispersion',
    'dispersion_samples',
    'fade_color',
    'fade_distance',
    'fade_power',
    'media',
  ]),
  media: new Set([
    'emission',
    'absorption',
    'scattering',
    'density',
    'intervals',
    'samples',
    'method',
    'confidence',
    'variance',
  ]),
  light_source: new Set([
    'color',
    'rgb',
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
    'looks_like',
    'media_attenuation',
    'media_interaction',
    'projected_through',
  ]),
  camera: new Set([
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
  ]),
  global_settings: new Set([
    'assumed_gamma',
    'max_trace_level',
    'adc_bailout',
    'ambient_light',
    'radiosity',
    'photons',
  ]),
  radiosity: new Set([
    'count',
    'error_bound',
    'gray_threshold',
    'nearest_count',
    'recursion_limit',
    'minimum_reuse',
    'pretrace_start',
    'pretrace_end',
    'brightness',
  ]),
  fog: new Set([
    'fog_type',
    'distance',
    'color',
    'colour',
    'rgb',
    'turbulence',
    'octaves',
    'omega',
    'lambda',
    'fog_offset',
    'fog_alt',
    'up',
  ]),
};

// The manifest kinds relevant inside a block, so the shipped library identifiers
// of that kind (the F_* finishes, the T_* textures) sort up too. Some kinds
// (normal, media, density) aren't present in the current manifest but are the
// correct mapping if the shipped library ever declares one, so they stay.
export const CONTEXT_KINDS = {
  finish: new Set(['finish']),
  pigment: new Set(['pigment', 'color']),
  normal: new Set(['normal']),
  texture: new Set(['texture', 'pigment', 'normal', 'finish']),
  interior: new Set(['interior']),
  material: new Set(['material', 'texture', 'interior']),
  media: new Set(['media', 'density']),
};

/**
 * The keyword that opened the innermost block enclosing `caret`, or '' at top
 * level. Tracks the brace stack while skipping line comments, nested block
 * comments, and strings, so a `{` inside `// ...` or `"..."` never counts.
 *
 * @param {string} text
 * @param {number} caret
 * @returns {string}
 */
export function blockContextAt(text, caret) {
  /** @type {string[]} */
  const stack = [];
  let lastWord = '';
  let i = 0;
  const n = Math.min(caret, text.length);
  while (i < n) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\n') break; // unterminated string ends at the line break, like the parser/highlighter
        if (text[i] === '\\') i++; // skip the escaped character
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') {
      stack.push(lastWord);
      lastWord = '';
      i++;
      continue;
    }
    if (ch === '}') {
      if (stack.length > 0) stack.pop();
      lastWord = '';
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /\w/.test(text[j])) j++;
      lastWord = text.slice(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return stack.length > 0 ? stack[stack.length - 1] : '';
}

/**
 * A relevance predicate for an enclosing block, or null when the block has no
 * known relevant set (top level, or an object block like `sphere {}` where any
 * identifier is fair game). The scene's own definitions are always treated as
 * relevant so they never sink below library symbols.
 *
 * @param {string} context  result of blockContextAt
 * @returns {((c: { name: string, kind: string }) => boolean) | null}
 */
export function relevanceFor(context) {
  const keywords = CONTEXT_KEYWORDS[context];
  const kinds = CONTEXT_KINDS[context];
  if (!keywords && !kinds) return null;
  return (c) =>
    c.kind === 'scene' ||
    (keywords !== undefined && keywords.has(c.name)) ||
    (kinds !== undefined && kinds.has(c.kind));
}
