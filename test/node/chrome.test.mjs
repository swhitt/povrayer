// Drift guard for the chrome the three surfaces share: the brand mark, the nav
// graph between them, the <title> pattern, and the social/meta block.
//
// povrayer ships three pages that are one product (the editor, the repl, turbo)
// and they have no way to import each other's markup: turbo cannot import ESM at
// all (tools/gen-turbo.mjs), and the other two only share a stylesheet. So the
// chrome is duplicated by hand, and everything below is a comparison, not a
// preference.
//
// ---- the brand mark ----
// The orb has to exist in five places that share no runtime: the two
// `<link rel="icon">` hrefs (parsed before any script runs), the .orb wordmark
// background in web/styles.css, the same wordmark in turbo.html (which cannot
// import ESM, see tools/gen-turbo.mjs), and the render-time favicon swap in
// web/render-feedback.ts. Only the last one can import web/orb.ts, so the other
// four are copies and this test is what keeps them honest.
//
// It exists because they HAD drifted. index.html carried r='.75' and repl.html
// r='.72' (invisible at 16px, max channel delta 34), but styles.css was a
// hand-written `radial-gradient(circle at 33% 28%, ...)`, and `circle
// farthest-corner` from that origin computes a ~31% wider falloff than the SVG's
// r='.75' (max channel delta 109, mean 36.9). The favicon and the wordmark sit
// 16px apart at the same size and were visibly different drawings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// The compiled artifact, not the .ts source: Node 20 cannot import .ts, so the
// suite loads what tools/build-web.mjs emits (see build-web.mjs for the whole
// argument). Coverage still keys on web/orb.ts through the inline source map.
import { ORB_CORE, ORB_BUSY_CORE, orbSvg, orbDataUri } from '../../_build/web/orb.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const index = read('web/index.html');
const repl = read('web/repl.html');
const css = read('web/styles.css');
const turbo = read('web/turbo.html');
const feedback = read('web/render-feedback.ts');

const READY = orbDataUri(ORB_CORE);

test('the orb URI is a data: URI whose only escapes are the three it needs', () => {
  assert.ok(READY.startsWith('data:image/svg+xml,'), 'must be an inline SVG data URI');
  // <, > and # are escaped; the single-quoted attributes, spaces and slashes
  // stay literal so the URI is still readable in a diff.
  assert.doesNotMatch(READY, /[<>#]/, 'no raw <, > or # may survive');
  assert.match(READY, /%3Csvg /, 'the opening tag is percent-escaped');
  assert.match(READY, /viewBox='0 0 16 16'/, 'spaces and quotes stay literal');
  assert.equal(READY.includes(`%23${ORB_CORE}`), true, 'the core stop carries the accent hex');
});

test('orbSvg is one circle filled by one radial gradient', () => {
  const svg = orbSvg(ORB_CORE);
  assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 16 16'>/);
  assert.match(svg, /<circle cx='8' cy='8' r='8' fill='url\(#g\)'\/>/);
  assert.equal((svg.match(/<radialGradient /g) ?? []).length, 1);
  assert.equal((svg.match(/<stop /g) ?? []).length, 3, 'core, accent, terminator');
  assert.ok(svg.endsWith('</svg>'));
});

test('the busy orb differs from the resting orb in exactly the core stop', () => {
  assert.notEqual(ORB_CORE, ORB_BUSY_CORE);
  assert.equal(
    orbSvg(ORB_BUSY_CORE),
    orbSvg(ORB_CORE).replace(ORB_CORE, ORB_BUSY_CORE),
    'the busy variant is a tint, not a second drawing'
  );
});

test('the two core colors are the palette tokens they claim to be', () => {
  // --accent for the resting orb, --dim for the in-flight one, both read off
  // :root in web/styles.css so the favicon can never disagree with the UI.
  const tokenValue = (name) => {
    const m = new RegExp(`^\\s*${name}:\\s*(#[0-9a-f]{6})`, 'm').exec(css);
    assert.ok(m, `${name} should be defined in web/styles.css`);
    return m[1].slice(1);
  };
  assert.equal(ORB_CORE, tokenValue('--accent'));
  assert.equal(ORB_BUSY_CORE, tokenValue('--dim'));
});

test('every hand-copied orb is byte-identical to orbDataUri(ORB_CORE)', () => {
  for (const [name, text] of [
    ['web/index.html', index],
    ['web/repl.html', repl],
    ['web/styles.css', css],
    ['web/turbo.html', turbo],
  ]) {
    assert.ok(
      text.includes(READY),
      `${name} does not carry the canonical orb; copy orbDataUri(ORB_CORE) from web/orb.ts`
    );
  }
});

test('no surface hand-rolls a second version of the mark', () => {
  // Any other inline radial gradient or icon href in these files is a fork of
  // the mark. Count the orb URI's own occurrences and require that they account
  // for every radialGradient and every rel="icon" data URI in the file.
  const occurrences = (text, needle) => text.split(needle).length - 1;
  for (const [name, text] of [
    ['web/index.html', index],
    ['web/repl.html', repl],
    ['web/styles.css', css],
    ['web/turbo.html', turbo],
  ]) {
    assert.equal(
      occurrences(text, '%3CradialGradient'),
      occurrences(text, READY),
      `${name} has a radial-gradient SVG that is not the canonical orb`
    );
    assert.equal(
      occurrences(text, 'radial-gradient('),
      0,
      `${name} draws the orb as a CSS gradient again; use the shared SVG`
    );
  }
});

// ---- the nav graph ---------------------------------------------------------
// turbo had ZERO <a> elements, so it was a one-way door; the REPL's <footer> was
// its live status readout, so two of the three surfaces could not reach the
// source or the POV-Ray docs. Every surface now names itself, links its two
// siblings and nothing else, and carries the two external links.
const SURFACES = [
  { file: 'web/index.html', text: index, self: 'editor', page: 'index.html' },
  { file: 'web/repl.html', text: repl, self: 'repl', page: 'repl.html' },
  { file: 'web/turbo.html', text: turbo, self: 'turbo', page: 'turbo.html' },
];
const SIBLING_LABEL = { 'index.html': 'editor', 'repl.html': 'repl', 'turbo.html': 'turbo' };

test('every surface links its two siblings, by the same name, and never itself', () => {
  for (const { file, text, page } of SURFACES) {
    for (const [target, label] of Object.entries(SIBLING_LABEL)) {
      const link = new RegExp(`<a href="\\./${target.replace('.', '\\.')}"[^>]*>${label}<`);
      if (target === page) {
        assert.doesNotMatch(text, link, `${file} must not link itself`);
        continue;
      }
      assert.match(text, link, `${file} must link ${target} and call it "${label}"`);
    }
  }
});

test('the sibling hrefs keep the .html suffix', () => {
  // The ONLY form that works in all four contexts povrayer is served from:
  // Vercel (cleanUrls 308s to the extensionless path and preserves the
  // fragment), the GitHub Pages /povrayer/ subpath (200, no redirect, where a
  // bare /repl is a 404), `python3 -m http.server`, and file://. See
  // .github/workflows/pages.yml. Do not "tidy" these.
  for (const { file, text } of SURFACES) {
    assert.doesNotMatch(
      text,
      /href="\.?\/(repl|turbo|index)"/,
      `${file} uses an extensionless internal href, which 404s on GitHub Pages`
    );
  }
});

test('every surface names itself in its own wordmark', () => {
  for (const { file, text, self } of SURFACES) {
    assert.ok(
      text.includes(`>${self}<`) || text.includes(`povrayer ${self}`),
      `${file} must say which surface it is`
    );
  }
  // The editor and the repl use the shared .brand-page suffix; index.html used to
  // be the one page that never named itself at all.
  assert.match(index, /<span class="brand-page">editor<\/span>/);
  assert.match(repl, /<span class="brand-page">repl<\/span>/);
});

test('every surface can reach the source and the POV-Ray docs', () => {
  for (const { file, text } of SURFACES) {
    assert.ok(text.includes('https://github.com/swhitt/povrayer'), `${file} has no source link`);
    assert.ok(
      text.includes('https://www.povray.org/documentation/'),
      `${file} has no scene-docs link`
    );
  }
});

test('the REPL status readout is no longer the page footer', () => {
  // It is a status (role="status", rewritten on every settings change), and while
  // it WAS the <footer> the REPL had nowhere to put real footer links.
  assert.doesNotMatch(repl, /<footer id="repl-status"/, '#repl-status must not be the <footer>');
  assert.match(repl, /<div id="repl-status" role="status">/);
  assert.match(repl, /<footer>/, 'the REPL needs a real footer');
});

// ---- titles + meta ---------------------------------------------------------

test('every title starts with the brand, and the page name matches the wordmark', () => {
  const titleOf = (text) => /<title>([^<]+)<\/title>/.exec(text)?.[1] ?? '';
  for (const { file, text } of SURFACES) {
    assert.match(titleOf(text), /^povrayer\b/, `${file}: the title must lead with the brand`);
  }
  // "povrayer REPL" fought this page's own lowercase wordmark. The middot is the
  // separator web/render-feedback.ts splits on to build "rendering… · povrayer
  // repl", so the page name has to sit in the FIRST segment.
  assert.equal(titleOf(repl), 'povrayer repl · a POV-Ray command line');
  assert.equal(titleOf(turbo), 'povrayer turbo', 'turbo pins a stable title; the gag is #fileName');
  // Exact, not a [,·] alternation: all three surfaces now use the middot, so the
  // comma form has no remaining holdout to tolerate. test/browser/ui/output-mobile.mjs
  // hardcodes this same string as BASE_TITLE and moved with it.
  assert.equal(titleOf(index), 'povrayer · POV-Ray in the browser');
});

test('every surface carries a description and a social card', () => {
  const REQUIRED = [
    /<meta\s+name="description"/,
    /<meta\s+name="theme-color"/,
    /<meta property="og:type"/,
    /<meta property="og:site_name"/,
    /<meta property="og:title"/,
    /<meta\s+property="og:description"/,
    /<meta property="og:url"/,
    /<meta\s+property="og:image"/,
    /<meta\s+property="og:image:alt"/,
    /<meta name="twitter:card"/,
  ];
  for (const { file, text } of SURFACES) {
    for (const re of REQUIRED) assert.match(text, re, `${file} is missing ${re}`);
  }
});

test('theme-color matches the background each surface actually paints', () => {
  const themeOf = (text) => /<meta name="theme-color" content="([^"]+)"/.exec(text)?.[1];
  const bg = /^\s*--bg:\s*(#[0-9a-f]{6})/m.exec(css)?.[1];
  assert.equal(themeOf(index), bg, 'the editor tints the browser chrome with --bg');
  assert.equal(themeOf(repl), bg);
  // turbo is a fullscreen canvas with its own near-black backdrop, declared in
  // its own :root; it is not a body.ui/body.repl page.
  assert.equal(themeOf(turbo), '#06070d');
  assert.match(turbo, /background: #06070d;/, "turbo's theme-color must match what it paints");
});

test('render-feedback.ts derives its favicons from web/orb.ts', () => {
  // The one copy that does not have to be a copy: it imports the module, so it
  // must not restate the URI or the hexes.
  assert.match(feedback, /import \{[^}]*orbDataUri[^}]*\} from '\.\/orb\.js'/);
  assert.doesNotMatch(feedback, /radialGradient/, 'no inline SVG belongs here anymore');
  assert.doesNotMatch(
    feedback,
    new RegExp(`'${ORB_CORE}'|'${ORB_BUSY_CORE}'`),
    'the core hexes come from ORB_CORE / ORB_BUSY_CORE, not from literals'
  );
});
