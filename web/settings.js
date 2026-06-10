// The render-control field schema and the rules for reading each control back
// from a foreign source. This is the single source of truth so the five paths in
// ui.js that touch the control set (persist, permalink-capture, saved-restore,
// URL-param seed, permalink-hydrate) can't drift apart: adding a control is one
// entry here. Pure and DOM-free, so it node-tests to 100%; ui.js maps each field
// key to its element and supplies the <select> option check.

/**
 * @typedef {Object} ControlField
 * @property {string} key the saved-state / element key
 * @property {'text' | 'select' | 'int'} kind how its value is validated
 * @property {boolean} [allowEmpty] text only: keep an empty string (e.g. threads
 *   = "auto") vs reject it and keep the default (e.g. an empty width)
 * @property {number} [min] int only: inclusive lower bound
 * @property {number} [max] int only: inclusive upper bound
 */

/** @type {ControlField[]} */
export const CONTROL_FIELDS = [
  { key: 'width', kind: 'text', allowEmpty: false },
  { key: 'height', kind: 'text', allowEmpty: false },
  { key: 'quality', kind: 'select' },
  { key: 'antialias', kind: 'select' },
  { key: 'threads', kind: 'text', allowEmpty: true },
  { key: 'flags', kind: 'text', allowEmpty: true },
  { key: 'frames', kind: 'int', min: 1, max: 240 },
  { key: 'fps', kind: 'int', min: 1, max: 60 },
];

// A coercion returns the string to WRITE into the control, or null to leave the
// control's current value untouched.

/**
 * Parse an integer field, returning the canonical string only when it is a whole
 * number inside [min, max]; otherwise null (keep the default).
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @returns {string | null}
 */
function coerceInt(value, min, max) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
}

/**
 * From an UNTRUSTED saved blob (localStorage JSON): every value is type-checked,
 * ints are range-checked, selects are checked against the live options, and an
 * empty string is kept only for fields that allow it.
 * @param {ControlField} field
 * @param {*} value
 * @param {(v: string) => boolean} isAllowed
 * @returns {string | null}
 */
export function coerceSaved(field, value, isAllowed) {
  if (field.kind === 'int') return coerceInt(value, Number(field.min), Number(field.max));
  if (typeof value !== 'string') return null;
  if (field.kind === 'select') return isAllowed(value) ? value : null;
  return field.allowEmpty || value ? value : null;
}

/**
 * From pre-parsed URL params (url-params.js already clamped the numerics): an
 * absent param is skipped; only the select membership is re-checked here.
 * @param {ControlField} field
 * @param {*} value
 * @param {(v: string) => boolean} isAllowed
 * @returns {string | null}
 */
export function coerceParam(field, value, isAllowed) {
  if (value === undefined) return null;
  if (field.kind === 'select') return isAllowed(value) ? value : null;
  return value;
}

/**
 * From a decoded permalink (our own encoder, so mostly trusted): selects are
 * re-checked against the options (an old link may name a dropped one), and the
 * flags field normalizes a missing value to '' (links predating the field).
 * Everything else is taken verbatim.
 * @param {ControlField} field
 * @param {*} value
 * @param {(v: string) => boolean} isAllowed
 * @returns {string | null}
 */
export function coerceHydrate(field, value, isAllowed) {
  if (field.kind === 'select') return isAllowed(value) ? value : null;
  if (field.key === 'flags') return typeof value === 'string' ? value : '';
  return value;
}
