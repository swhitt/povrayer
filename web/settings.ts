// The render-control field schema and the rules for reading each control back
// from a foreign source. This is the single source of truth so the five paths in
// ui.js that touch the control set (persist, permalink-capture, saved-restore,
// URL-param seed, permalink-hydrate) can't drift apart: adding a control is one
// entry here. Pure and DOM-free, so it node-tests to 100%; ui.js maps each field
// key to its element and supplies the <select> option check.

// A discriminated union on `kind`, not one optional-heavy record: the int fields
// ALWAYS carry min/max and the text fields ALWAYS carry allowEmpty, and saying so
// is what lets coerceInt below take `field.min` directly. The JSDoc version had
// them all optional and paid for it with `Number(field.min)` at the call site,
// which quietly turned a missing bound into NaN instead of a compile error.
export type ControlField =
  /** text: free-form value; allowEmpty decides whether "" is meaningful */
  | { key: string; kind: 'text'; allowEmpty: boolean }
  /** select: value must be one of the live <option>s (ui.js supplies the check) */
  | { key: string; kind: 'select' }
  /** int: whole number inside [min, max], inclusive */
  | { key: string; kind: 'int'; min: number; max: number };

export const CONTROL_FIELDS: ControlField[] = [
  { key: 'width', kind: 'text', allowEmpty: false },
  { key: 'height', kind: 'text', allowEmpty: false },
  { key: 'quality', kind: 'select' },
  { key: 'antialias', kind: 'select' },
  { key: 'draft', kind: 'select' },
  { key: 'threads', kind: 'text', allowEmpty: true },
  { key: 'flags', kind: 'text', allowEmpty: true },
  { key: 'frames', kind: 'int', min: 1, max: 240 },
  { key: 'fps', kind: 'int', min: 1, max: 60 },
];

/** The live <option> membership check ui.js supplies for the select fields. */
export type OptionCheck = (value: string) => boolean;

// Quality shipped as `<option value="" selected>9</option>` until 2026-08, so an
// empty string was how "9" (POV-Ray's own default +Q) was persisted, permalinked,
// and handed off from the REPL. The option is an honest '9' now, so every foreign
// value set is rewritten through here first: without it, a returning user's saved
// blob and every link written before the change would carry a quality that is no
// longer a real option, and get dropped.
const LEGACY_SELECT_VALUES: Record<string, Record<string, string>> = {
  quality: { '': '9' },
};

/**
 * Rewrite a legacy encoding of a control value onto its current option value.
 * Non-strings and values with no legacy meaning pass through untouched.
 *
 * Generic in the value so the string callers below get `string` back rather than
 * a union they would have to re-narrow: the only thing this ever SUBSTITUTES is a
 * string, and anything else it hands straight back.
 */
export function migrateValue<T>(field: ControlField, value: T): T | string {
  if (typeof value !== 'string') return value;
  const mapped = LEGACY_SELECT_VALUES[field.key]?.[value];
  return mapped === undefined ? value : mapped;
}

// A coercion returns the string to WRITE into the control, or null to leave the
// control's current value untouched.

/**
 * Parse an integer field, returning the canonical string only when it is a whole
 * number inside [min, max]; otherwise null (keep the default).
 *
 * `String(value)` is not a widening: parseInt does ToString on its argument
 * anyway, so this is exactly what the untyped version did for a number, null, or
 * an object out of a hand-edited blob.
 */
function coerceInt(value: unknown, min: number, max: number): string | null {
  const n = parseInt(String(value), 10);
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
}

/**
 * From an UNTRUSTED saved blob (localStorage JSON): every value is type-checked,
 * ints are range-checked, selects are checked against the live options, and an
 * empty string is kept only for fields that allow it.
 */
export function coerceSaved(
  field: ControlField,
  value: unknown,
  isAllowed: OptionCheck
): string | null {
  if (field.kind === 'int') return coerceInt(value, field.min, field.max);
  if (typeof value !== 'string') return null;
  if (field.kind === 'select') {
    const migrated = migrateValue(field, value);
    return isAllowed(migrated) ? migrated : null;
  }
  return field.allowEmpty || value ? value : null;
}

/**
 * From pre-parsed URL params (url-params.ts already clamped the numerics): an
 * absent param is skipped; only the select membership is re-checked here.
 */
export function coerceParam(
  field: ControlField,
  value: string | undefined,
  isAllowed: OptionCheck
): string | null {
  if (value === undefined) return null;
  if (field.kind === 'select') {
    const migrated = migrateValue(field, value);
    return isAllowed(migrated) ? migrated : null;
  }
  return value;
}

/**
 * From a decoded permalink (our own encoder, so mostly trusted): selects are
 * re-checked against the options (an old link may name a dropped one), and the
 * flags field normalizes a missing value to '' (links predating the field).
 * Everything else, including the int ranges the encoder already wrote, is verbatim.
 *
 * A select value this build no longer offers lands on `fallback` (the control's
 * own default) rather than being skipped. Skipping it kept whatever the RECIPIENT
 * had dialed in, so a link whose quality didn't survive decoding rendered at the
 * reader's setting (verified: an editor sitting at quality 3 stayed at 3), which
 * silently misdescribes the shared scene. A permalink is a complete state
 * description: when a value can't be honored, the honest answer is the default.
 *
 * @param fallback the control's default value (`''` for a text field)
 */
export function coerceHydrate(
  field: ControlField,
  value: string | undefined,
  isAllowed: OptionCheck,
  fallback: string
): string | null {
  if (field.kind === 'select') {
    // `draft` is the one select PermalinkState marks optional, so a link minted
    // before that field existed decodes without it. Reading the absent value as
    // the control's own default is the same answer the membership check gave when
    // it was handed undefined, just arrived at without a second guard.
    const migrated = migrateValue(field, value ?? fallback);
    return isAllowed(migrated) ? migrated : fallback;
  }
  if (field.key === 'flags') return typeof value === 'string' ? value : '';
  // Int and text fields are all REQUIRED in PermalinkState (flags and draft are
  // the only optional ones and both are handled above), so the decoder always
  // wrote a string here.
  return value ?? null;
}
