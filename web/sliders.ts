// Live numeric controls for the editor: auto-generated sliders for top-level
// `#declare NAME = <number>` parameters, and Alt+drag "scrubbing" of any numeric
// literal in place. Both edit the SAME source text (the scene stays the single
// source of truth), so this module is the pure part: it locates the literals,
// derives a sensible range/step, and formats the rewritten value. ui.js owns the
// slider DOM, the pointer handling, and the setRangeText edits.

// A POV-Ray numeric literal: optional sign, int/decimal/leading-dot forms, and
// an optional exponent. Used both anchored (in DECLARE_RE) and global (scanning).
// Distinct from highlight.js's NUMBER_RE on purpose: that one EXCLUDES the
// leading `-` (a minus stays an operator for coloring); here numberTokenAt wants
// the sign in the span (then strips it back when it's actually subtraction).
const NUMBER = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';

// A top-level `#declare NAME = <number>` (the `;` is optional in SDL). The `d`
// flag exposes capture-group offsets so the literal's exact span is known. Not
// global: it's matched against one line's code part at a time.
const DECLARE_RE = new RegExp(
  `^[ \\t]*#declare[ \\t]+([A-Za-z_]\\w*)[ \\t]*=[ \\t]*(${NUMBER})[ \\t]*;?[ \\t]*$`,
  'd'
);

// An explicit range annotation in the trailing comment: `// 0..90` or `// 0..90..5`.
// The numbers require digits after any decimal point (no bare trailing dot), so
// the `..` separator is never swallowed by a number's optional fraction.
const RANGE_RE =
  /(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\.\.\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*\.\.\s*(\d+(?:\.\d+)?|\.\d+))?/;

const NUMBER_RE = new RegExp(NUMBER, 'g');

/** Decimal places implied by a step (so 0.01 -> 2, 1 -> 0), capped at 6. */
function decimalsFor(step: number): number {
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
}

/**
 * A "nice" step (a power of ten giving ~100-1000 increments) for a span, with a
 * small fallback for a degenerate (zero/inverted) span.
 *
 * @param span max - min
 */
function niceStep(span: number): number {
  if (!(span > 0)) return 0.01;
  return Math.pow(10, Math.floor(Math.log10(span)) - 2);
}

/**
 * A default slider range for a bare value (no annotation): zero to twice the
 * value (flipped for negatives), or 0..1 for exactly zero.
 */
function heuristicRange(value: number): SliderRange {
  if (value === 0) return { min: 0, max: 1, step: 0.01 };
  const min = Math.min(0, 2 * value);
  const max = Math.max(0, 2 * value);
  return { min, max, step: niceStep(max - min) };
}

/**
 * The range for a declared number: an explicit `min..max[..step]` annotation
 * from the trailing comment if present, else the heuristic.
 *
 * @param comment the trailing `//` comment text (without the slashes)
 */
function rangeFor(comment: string, value: number): SliderRange {
  const m = RANGE_RE.exec(comment);
  if (!m) return heuristicRange(value);
  const min = Number(m[1]);
  const max = Number(m[2]);
  const step = m[3] !== undefined ? Number(m[3]) : niceStep(max - min);
  return { min, max, step };
}

/** The slider bounds derived for one literal. */
export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

export interface DeclaredNumber extends SliderRange {
  /** the declared identifier */
  name: string;
  /** its current numeric value */
  value: number;
  /** start offset of the literal in the text */
  start: number;
  /** end offset of the literal in the text */
  end: number;
}

/**
 * Find every top-level `#declare NAME = <number>` and return a slider model for
 * each (name, current value, the literal's exact span, and a range/step). The
 * `//` comment part of a line is split off first, so a `#declare` inside a line
 * comment is ignored and a trailing `// min..max` is read as the range. Block
 * comments are NOT tracked, so a `#declare` buried inside a block comment would
 * still produce a slider (rare). A trailing CRLF carriage return is stripped
 * before matching, but counted in the offset so the literal spans stay anchored.
 */
export function parseDeclaredNumbers(text: string): DeclaredNumber[] {
  const out: DeclaredNumber[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const lineStart = offset;
    offset += raw.length + 1; // account for the split-out newline (raw keeps any \r)
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const slashes = line.indexOf('//');
    const code = slashes >= 0 ? line.slice(0, slashes) : line;
    const comment = slashes >= 0 ? line.slice(slashes + 2) : '';
    const m = DECLARE_RE.exec(code);
    if (!m) continue;
    // DECLARE_RE carries the `d` flag, so a match always has `indices`, and its
    // group 2 is not optional, so that span is always populated. Both are
    // asserted rather than guarded: a fallback would be a branch no input can
    // reach, and the 100% gate would then owe it a test.
    const [numStart, numEnd] = (m.indices as RegExpIndicesArray)[2] as [number, number];
    const value = Number(m[2]);
    out.push({
      name: m[1],
      value,
      start: lineStart + numStart,
      end: lineStart + numEnd,
      ...rangeFor(comment, value),
    });
  }
  return out;
}

/** One numeric literal located in the source, as scrub hit-testing sees it. */
export interface NumberToken {
  start: number;
  end: number;
  text: string;
  value: number;
}

/** A character that, before a `-`, makes it a subtraction operator not a sign. */
const VALUE_CHAR = /[\w)\].>]/;

/**
 * The numeric literal whose span contains (or abuts) `offset`, for scrub
 * hit-testing, or null if the offset isn't on a number. Two corrections keep a
 * scrub from corrupting the source: a leading `-` that follows a value (a
 * subtraction operator, as in `a-1.5`) is excluded from the token so scrubbing
 * across zero can't fuse `a` and the number; and a match starting right after a
 * `.` (the `.90` inside a `// 0..90` range annotation) is skipped.
 */
export function numberTokenAt(text: string, offset: number): NumberToken | null {
  NUMBER_RE.lastIndex = 0;
  for (let m = NUMBER_RE.exec(text); m; m = NUMBER_RE.exec(text)) {
    let start = m.index;
    let str = m[0];
    // The character before the match, or '' at the buffer start. Sliced rather
    // than `text[start - 1] || ''`: that form leaned on an out-of-range index
    // coercing to undefined and then to a falsy value, which reads as a typo and
    // is a real trap (VALUE_CHAR.test(undefined) tests the STRING "undefined" and
    // matches, so dropping the fallback would silently treat a leading '-' at
    // offset 0 as subtraction). slice() says "the character before, if there is
    // one" outright, and costs one less branch.
    const before = text.slice(Math.max(0, start - 1), start);
    if (str[0] === '-' && VALUE_CHAR.test(before)) {
      start += 1; // the '-' is subtraction; the number starts after it
      str = str.slice(1);
    }
    if (text[start - 1] === '.') continue; // part of a `..` annotation, not a literal
    const end = start + str.length;
    if (offset >= start && offset <= end) {
      return { start, end, text: str, value: Number(str) };
    }
    if (start > offset) break; // matches are left-to-right; we've passed the offset
  }
  return null;
}

/**
 * A magnitude-aware step for scrubbing a bare literal (no declared range):
 * reuses the heuristic so a small value scrubs finely and a large one coarsely.
 */
export function scrubStep(value: number): number {
  return heuristicRange(value).step;
}

/**
 * Format a value for writing back into the source, with the decimal precision
 * implied by `step` (so a step of 0.01 keeps two decimals, 1 keeps none).
 */
export function formatScrubbed(value: number, step: number): string {
  return value.toFixed(decimalsFor(step));
}
