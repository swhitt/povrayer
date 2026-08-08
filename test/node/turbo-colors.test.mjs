// Drift guard for turbo's inlined colors.inc table.
//
// turbo compiles POV-Ray SDL to GLSL in the browser, so it carries its own copy
// of colors.inc as the COLORS_INC map. web/includes-manifest.json is generated
// from the EXACT include tree the pinned wasm embeds (tools/includes-manifest),
// which makes it the authority on WHICH names exist. A name missing from turbo
// resolves to gray AND lands in the "N things only the real tracer can do" chip,
// so turbo ends up advertising a difference between the two renderers that isn't
// real: six names (Bronze2, DarkSlateGrey, Light_Purple, Med_Purple, Mica,
// Very_Light_Purple) drifted out that way before this test existed.
//
// The manifest cannot generate the table: its symbol records are
// {name, kind, file, params} with no rgb values at all, so the VALUES stay
// hand-maintained (read off the #declare lines) and only the KEY SET is checked
// here. Extending tools/includes-manifest/parse.mjs to carry colors would be the
// only way to close that half, and it is a bigger change than this guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const turbo = readFileSync(join(root, 'web', 'turbo.html'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'web', 'includes-manifest.json'), 'utf8'));

/**
 * The COLORS_INC object literal, parsed out of turbo's inline script. turbo is a
 * single self-contained file with no build step and no ESM (see
 * tools/gen-turbo.mjs), so there is nothing to import: the literal is read as
 * text and evaluated as JSON-ish source.
 * @returns {Record<string, number[]>}
 */
function turboColors() {
  const start = turbo.indexOf('const COLORS_INC = {');
  assert.notEqual(start, -1, 'turbo.html must still declare COLORS_INC');
  const open = turbo.indexOf('{', start);
  const close = turbo.indexOf('\n      };', open);
  assert.notEqual(close, -1, 'COLORS_INC must still close at its own indent level');
  const body = turbo.slice(open + 1, close);
  /** @type {Record<string, number[]>} */
  const out = {};
  for (const line of body.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*\[([^\]]*)\],/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].split(',').map((v) => Number(v.trim()));
  }
  return out;
}

/** colors.inc names from the manifest. `value` covers the Gray05..Gray95 ramp,
 * which is declared as an expression (Grey*0.05) rather than a color literal. */
const incNames = (...kinds) =>
  manifest.symbols
    .filter((s) => s.file === 'colors.inc' && kinds.includes(s.kind))
    .map((s) => s.name);

test('turbo knows every color colors.inc declares', () => {
  const colors = turboColors();
  const declared = incNames('color', 'value');
  assert.ok(declared.length > 100, `sanity: colors.inc should be large, got ${declared.length}`);
  const missing = declared.filter((n) => !Object.hasOwn(colors, n));
  assert.deepEqual(
    missing,
    [],
    'these colors.inc names fall back to gray in turbo and get counted as an ' +
      'unsupported feature; add them to COLORS_INC'
  );
});

test('turbo invents no colors colors.inc does not have', () => {
  const known = new Set(incNames('color', 'value', 'macro', 'function'));
  const extra = Object.keys(turboColors()).filter((n) => !known.has(n));
  assert.deepEqual(extra, [], 'COLORS_INC must not define names the real tracer would reject');
});

test('every COLORS_INC entry is a usable rgb (or rgbft) tuple', () => {
  for (const [name, v] of Object.entries(turboColors())) {
    assert.ok(v.length === 3 || v.length === 5, `${name}: expected rgb or rgbft, got ${v.length}`);
    for (const c of v) {
      assert.ok(Number.isFinite(c), `${name}: non-numeric channel`);
      assert.ok(c >= 0 && c <= 1, `${name}: channel ${c} outside 0..1`);
    }
  }
});

test('the six names that drifted out are back, with their declared values', () => {
  const colors = turboColors();
  // Straight off the #declare lines in the include tree dist/povray.wasm embeds.
  const expected = {
    Bronze2: [0.65, 0.49, 0.24],
    DarkSlateGrey: [0.184314, 0.309804, 0.309804],
    Light_Purple: [0.87, 0.58, 0.98],
    Med_Purple: [0.73, 0.16, 0.96],
    Mica: [0, 0, 0], // colors.inc: `#declare Mica = color Black;`
    Very_Light_Purple: [0.94, 0.81, 0.99],
  };
  for (const [name, rgb] of Object.entries(expected)) {
    assert.deepEqual(colors[name], rgb, `${name} must match colors.inc`);
  }
  // DarkSlateGrey is the British spelling of an existing entry; POV-Ray declares
  // both, and they must not drift apart.
  assert.deepEqual(colors.DarkSlateGrey, colors.DarkSlateGray);
});
