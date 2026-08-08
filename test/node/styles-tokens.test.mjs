// Drift guard for the CSS design tokens.
//
// A var() naming a custom property nobody defines is silent: the declaration is
// dropped as "invalid at computed-value time", so the element falls back to the
// initial or inherited value and usually still looks plausible. Nothing in the
// toolchain catches it. prettier and eslint don't read CSS semantics, and the
// 100% coverage gate measures JS, so #example-clear shipped `background:
// var(--panel-2)` and `font-size: var(--fs-ui)` against two properties that were
// never defined in any commit.
//
// Also guards the near-miss duplication between the two stylesheets: turbo.html
// keeps its own :root because it is a fullscreen canvas with floating glass
// chrome (a genuinely different design problem from body.ui / body.repl), but its
// comment claims the SYNTAX palette is "shared with the web editor ... so the
// SDL/GLSL overlays light up with the same colors". Shared-by-copy silently
// drifts, so assert the copies still agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(resolve(root, 'web/styles.css'), 'utf8');
const turbo = readFileSync(resolve(root, 'web/turbo.html'), 'utf8');

// Set from JS at runtime rather than declared in the stylesheet, so a static
// scan cannot see their definition. Each must stay genuinely JS-driven.
const RUNTIME_SET = new Map([
  ['--pct', 'web/render-feedback + web/repl set it on the progress bar'],
  ['--split', 'web/ui sets it on <main> for the draggable split'],
]);

/**
 * Read a web module by base name, whichever language it is currently written in.
 * Extension-agnostic on purpose: web/ is mid-migration to TypeScript, and a
 * hardcoded `.js` here would silently stop reading a module the day it is
 * renamed, which is exactly how the allowlist above becomes a hiding place for
 * dead tokens again.
 *
 * @param {string} base repo-relative path with no extension, e.g. 'web/ui'
 */
function readModule(base) {
  for (const ext of ['.ts', '.js']) {
    const path = resolve(root, base + ext);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  throw new Error(`${base} has neither a .ts nor a .js`);
}

/** @param {string} text */
function referencedVars(text) {
  return new Set([...text.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].map((m) => m[1]));
}

/** @param {string} text */
function definedVars(text) {
  return new Set([...text.matchAll(/^\s*(--[A-Za-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}

test('every custom property styles.css references is defined or set from JS', () => {
  const defined = definedVars(css);
  const dangling = [...referencedVars(css)].filter((v) => !defined.has(v) && !RUNTIME_SET.has(v));
  assert.deepEqual(
    dangling,
    [],
    `styles.css references custom properties nothing defines: ${dangling.join(', ')}. ` +
      'Define them in :root, or add them to RUNTIME_SET here with the JS site that sets them.'
  );
});

test('the runtime-set custom properties really are set from JS', () => {
  // Otherwise this allowlist becomes a place for dead tokens to hide.
  const code = ['web/render-feedback', 'web/repl', 'web/ui'].map(readModule).join('\n');
  for (const [name, why] of RUNTIME_SET) {
    assert.ok(code.includes(`'${name}'`), `${name} is allowlisted (${why}) but no module names it`);
  }
});

test('turbo.html and styles.css agree on the syntax palette they claim to share', () => {
  const SYNTAX = [
    '--syn-comment',
    '--syn-keyword',
    '--syn-builtin',
    '--syn-string',
    '--syn-number',
    '--syn-directive',
  ];
  /** @param {string} text @param {string} name */
  const valueOf = (text, name) => {
    const m = text.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    return m ? m[1].trim().toLowerCase() : null;
  };
  for (const name of SYNTAX) {
    const a = valueOf(css, name);
    const b = valueOf(turbo, name);
    assert.ok(a, `${name} should be defined in web/styles.css`);
    assert.ok(b, `${name} should be defined in web/turbo.html`);
    assert.equal(b, a, `${name} drifted: styles.css has ${a}, turbo.html has ${b}`);
  }
});
