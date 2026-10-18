// Drift guard for EVERYTHING inlined into povrayer turbo.
//
// turbo ships as one self-contained HTML file, but none of its JavaScript is
// written there. tools/gen-turbo.mjs fills two generated regions: gen:lang bundles
// web/{highlight,context,complete,glsl-highlight}.js (the SAME modules the web app
// imports) into the POVLang/GLSLLang globals, and gen:app inlines web/turbo-app.js,
// turbo's own ~5.5k-line application script, verbatim.
//
// The equality check below is what makes that arrangement safe: turbo.html cannot
// be committed stale, so the two editors can never silently diverge AND the app
// code can never drift away from the file that Oxlint/Prettier/tsc actually see.
//
// The last two tests defend the arrangement itself. Every serious turbo bug (a
// Space handler that cancelled activation on 16 buttons, a visibility deadlock, an
// inverted play glyph, a number-jitter feature that rewrote `#version 3.8`) got in
// because that code sat in a <script> tag no static analysis could reach. Nothing
// stops someone re-opening that hole by hand except a test that says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Script, runInNewContext } from 'node:vm';

import { render } from '../../tools/gen-turbo.mjs';

const TURBO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'turbo.html');
const TURBO_APP = join(dirname(TURBO), 'turbo-app.js');

// The SDL parser and the scene compiler are everything in turbo-app.js before
// the GLSL renderer (`shaderSource`), and none of it touches the DOM. Slice that
// out of the IIFE and run it in a bare context, so SDL semantics have unit tests
// instead of relying on the browser suite to notice a mis-compiled scene.
function loadTurboCore() {
  const src = readFileSync(TURBO_APP, 'utf8');
  const USE_STRICT = "'use strict';";
  const start = src.indexOf(USE_STRICT) + USE_STRICT.length;
  const end = src.indexOf('  function shaderSource(');
  assert.ok(
    start > USE_STRICT.length && end > start,
    'turbo-app.js layout changed: the parser/compiler slice markers were not found'
  );
  return runInNewContext(
    `(function () { 'use strict';\n${src.slice(start, end)}\nreturn { Parser, compileScene, ParseError }; })()`,
    { window: {} }
  );
}
const core = loadTurboCore();

/** Parse + compile one scene the way buildScene() does, at clock 0. */
function build(sdl) {
  const parser = new core.Parser(sdl, { clock: 0, width: 800, height: 450 });
  const scene = parser.parseScene();
  return { parser, scene, comp: core.compileScene(scene, parser) };
}
// Values come back from the vm realm with its own Array prototype, which strict
// deepEqual rejects; JSON round-trips them into plain host values.
const plain = (v) => JSON.parse(JSON.stringify(v));
const prims = (comp) => plain(comp.leaves.map((l) => l.node.prim));

test('turbo compiler: only union-like kids fold into a group loop', () => {
  // an intersection's kids must each be intersected; a group is a min(), i.e.
  // a union, so six planes used to come out as "everything but a box"
  const planes = ['y', '-y', 'x', '-x', 'z', '-z'].map((n) => `plane { ${n}, 1 }`).join(' ');
  const cube = build(`intersection { ${planes} pigment { color rgb 1 } }`).comp;
  assert.equal(cube.leaves.length, 6);
  assert.doesNotMatch(cube.glsl, /vec2 g0\(/, 'intersection kids must not be grouped');
  assert.equal((cube.glsl.match(/iOp\(/g) || []).length, 5);
  // the grouping itself still happens where it is valid
  const four = [0, 1, 2, 3].map((i) => `sphere { <${i}, 0, 0>, 0.4 }`).join(' ');
  assert.match(build(`union { ${four} pigment { color rgb 1 } }`).comp.glsl, /vec2 g0\(/);
  const cut = build(`difference { box { -2, 2 } ${four} pigment { color rgb 1 } }`).comp.glsl;
  assert.match(cut, /r = dOp\(r, g0\(p\)\);/, 'difference cutters still group');
  // an intersection nested under a union groups its own subtrees, not itself
  const nested = build(`intersection { union { ${four} } sphere { 0, 3 } pigment { color rgb 1 } }`)
    .comp.glsl;
  assert.match(nested, /vec2 g0\(/);
  assert.match(nested, /r = iOp\(r, o\d\(p\)\);/);
});

test('turbo parser: #elseif chains take exactly one branch', () => {
  const chain = (a) =>
    `#declare A = ${a};
     #if (A = 1) sphere { 0, 1 }
     #elseif (A = 2) box { -1, 1 }
     #elseif (A = 3) cylinder { 0, y, 1 }
     #else torus { 1, 0.2 }
     #end`;
  assert.deepEqual(prims(build(chain(1)).comp), ['sphere']);
  assert.deepEqual(prims(build(chain(2)).comp), ['box']);
  assert.deepEqual(prims(build(chain(3)).comp), ['cylinder']);
  assert.deepEqual(prims(build(chain(4)).comp), ['torus']);
  // no #else: an untaken chain renders nothing, and nested #ifs stay balanced
  assert.deepEqual(prims(build(`#if (0) sphere { 0, 1 } #elseif (0) box { -1, 1 } #end`).comp), []);
  assert.deepEqual(
    prims(
      build(
        `#if (0) #if (1) sphere { 0, 1 } #elseif (1) box { -1, 1 } #end
         #elseif (1) #if (0) cone { 0, 1, y, 0 } #else torus { 1, 0.2 } #end
         #end`
      ).comp
    ),
    ['torus']
  );
});

test('turbo parser: a #declared material{} keeps its interior', () => {
  const declared = build(
    `#include "glass.inc"
     #declare M = material { texture { T_Glass1 } interior { I_Glass } }
     sphere { 0, 1 material { M } }`
  );
  assert.equal(declared.comp.materials[0].ior, 1.5);
  assert.ok(
    !declared.parser.warnings.some((w) => w.includes('interior')),
    `no bogus CPU-only warning: ${declared.parser.warnings}`
  );
  // a texture identifier directly inside material{}, and ior via the bare name
  const byName = build(
    `#include "glass.inc"
     #declare M = material { T_Glass1 interior { ior 1.33 } }
     sphere { 0, 1 M }`
  );
  assert.equal(byName.comp.materials[0].ior, 1.33);
  assert.equal(byName.comp.materials[0].pig.c1[4], 0.85, 'T_Glass1 pigment came through');
});

test('turbo parser: idioms that used to hard-error now parse', () => {
  // #debug with a string function call
  assert.equal(
    build(`#debug concat("n=", str(3, 0, 0), "\\n")\nsphere { 0, 1 }`).comp.leaves.length,
    1
  );
  assert.throws(() => build(`#error concat("boom")`), core.ParseError);
  // a macro that opens with #local, used as a value
  const mac = build(`#macro F(a) #local b = a * 2; b #end\nsphere { 0, F(0.5) }`);
  assert.equal(mac.comp.leaves[0].node.a.r, 1);
  // #declare Copy = Original; for objects and textures
  const alias = build(
    `#declare O1 = sphere { 0, 1 }
     #declare O2 = O1;
     #declare T1 = texture { pigment { color rgb <1, 0, 0> } }
     #declare T2 = T1;
     object { O2 texture { T2 } }`
  );
  assert.deepEqual(prims(alias.comp), ['sphere']);
  assert.deepEqual(plain(alias.comp.materials[0].pig.c1), [1, 0, 0, 0, 0]);
  // a modifier under a directive after a CSG's children lands on the CSG
  const csg = build(`union { sphere { 0, 1 } #if (1) translate y #end }`);
  assert.deepEqual(plain(csg.comp.leaves[0].chain.map((e) => [e.k, e.v])), [['t', [0, 1, 0]]]);
  // a comparison inside a call inside a vector literal
  const vec = build(`#declare V = <1, select(2 > 1, 0, 1), 3>;\nsphere { V, 1 }`);
  assert.deepEqual(plain(vec.comp.leaves[0].node.a.c), [1, 1, 3]);
});

test('turbo compiler: a child with its own pigment does not inherit the CSG finish', () => {
  const own = build(`union { sphere { 0, 1 pigment { color rgb 1 } } finish { reflection 0.5 } }`);
  assert.equal(own.comp.materials[0].fin.reflection, null);
  const bare = build(`union { sphere { 0, 1 } pigment { color rgb 1 } finish { reflection 0.5 } }`);
  assert.ok(bare.comp.materials[0].fin.reflection, 'a bare leaf still inherits both');
  // the same cut applies one CSG level up
  const nested = build(
    `union { union { sphere { 0, 1 } pigment { color rgb 1 } } finish { reflection 0.5 } }`
  );
  assert.equal(nested.comp.materials[0].fin.reflection, null);
});

test('turbo app remains valid as a classic script', () => {
  assert.doesNotThrow(
    () => new Script(readFileSync(TURBO_APP, 'utf8'), { filename: TURBO_APP }),
    'turbo-app.js is inlined into a classic script and cannot contain import/export syntax'
  );
});

test('the inlined lang bundle and app script are up to date with their sources', async () => {
  const committed = readFileSync(TURBO, 'utf8');
  const fresh = await render(committed);
  assert.equal(
    fresh,
    committed,
    'turbo.html is stale: run `npm run gen:turbo` after editing web/turbo-app.js or web/{highlight,context,complete,glsl-highlight}.js'
  );
});

test('turbo.html exposes the shared globals', () => {
  const html = readFileSync(TURBO, 'utf8');
  assert.match(html, /window\.POVLang = /, 'POVLang global must be assigned');
  assert.match(html, /window\.GLSLLang = /, 'GLSLLang global must be assigned');
});

test('every script in turbo.html comes from a generated region', () => {
  const html = readFileSync(TURBO, 'utf8');
  const outside = html
    .replace(/<!-- gen:lang:start -->[\s\S]*?<!-- gen:lang:end -->/, '')
    .replace(/<!-- gen:app:start -->[\s\S]*?<!-- gen:app:end -->/, '');
  assert.ok(
    !/<script/i.test(outside),
    'hand-written <script> in turbo.html is invisible to Oxlint, Prettier, and checkJs. ' +
      'Put the code in web/turbo-app.js and run `npm run gen:turbo` instead.'
  );
  // Both regions must still be there to strip, or the check above passes vacuously.
  assert.match(html, /<!-- gen:lang:start -->[\s\S]*<script/);
  assert.match(html, /<!-- gen:app:start -->[\s\S]*<script/);
});

test('turbo.html stays self-contained enough to open from file://', () => {
  const html = readFileSync(TURBO, 'utf8');
  assert.ok(
    !/<script[^>]*\ssrc=/i.test(html),
    'an external script would 404 on a file:// open; turbo inlines its JS on purpose'
  );
  assert.ok(
    !/<script[^>]*\stype\s*=\s*["']module["']/i.test(html),
    "file:// blocks ES module loading, so turbo's scripts must stay classic scripts"
  );
});
