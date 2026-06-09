// Parse a raw POV-Ray flags string (the advanced "escape hatch" field) into an
// argv token array. The wrapper appends these tokens LAST on the command line,
// after the structured +W/+H/+Q/+A flags, so a raw `+A0.05` or `+AM2 +R4`
// overrides the corresponding control (POV-Ray is last-wins for most options).
//
// Tokenization is shell-ish but minimal: whitespace separates tokens, and a
// double- or single-quoted run keeps its inner spaces (for the rare flag that
// carries a path with a space). Empty / whitespace-only input yields []. We pass
// tokens through verbatim, no validation: this is a deliberate power-user hatch,
// and a bad flag simply surfaces in the render log like any other engine error.

/**
 * @param {string} input the raw flags field text
 * @returns {string[]} argv tokens (no surrounding quotes)
 */
export function parseFlags(input) {
  /** @type {string[]} */
  const out = [];
  // Alternatives in priority order: a "double" run, a 'single' run, then a bare
  // non-whitespace run. \S+ skips the inter-token whitespace for free.
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}
