// Pure-data coverage for web/glsl-highlight.js, the GLSL sibling of the SDL
// highlighter (povrayer turbo shows the fragment shader it compiles). Same
// load-bearing property as highlight.test.mjs: byte fidelity, so the overlay
// <code> holds text that, spans stripped and HTML un-escaped, is identical to
// what it highlights. GLSL is full of `<`, `>`, `&` (`a < b`, `x >> 1`, `&&`),
// so the escape arm is the markup-injection guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { highlight } from '../../web/glsl-highlight.js';

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}
function htmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// A spread of real generated-shader shapes: directives, types, builtins, the
// comparison/shift operators that produce raw angle brackets, comments, strings.
const SAMPLES = [
  '#version 300 es\nprecision highp float;\nout vec4 frag;',
  'void main(){ vec3 c = normalize(vec3(1.0, 2.0, 3.0)); float l = dot(c, c); }',
  'for (int i = 0; i < 8; i++) { if (a < b && b > c) x >>= 1u; }',
  'float v = texture(uP, uv).r; // sample\n/* block */ gl_FragCoord.xy;',
  'vec3 p = mix(a, b, smoothstep(0.5, 0.9, t)) * 0.4545 + .5;',
];

test('byte-faithful: strip+unescape reproduces every GLSL sample exactly', () => {
  for (const src of SAMPLES) {
    const html = highlight(src);
    assert.equal(
      htmlUnescape(stripTags(html)),
      src,
      `overlay text drifted for: ${src.slice(0, 30)}`
    );
    assert.ok(!/[<>]/.test(stripTags(html)), `unescaped angle bracket leaked: ${src.slice(0, 30)}`);
  }
});

test('HTML-escapes & < > (the markup-injection guard)', () => {
  assert.equal(highlight('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  const shift = highlight('x >> 1');
  assert.ok(!/[<>]/.test(stripTags(shift)), 'no raw angle bracket may remain in a shift');
});

test('directives: # + known word -> tok-directive', () => {
  for (const d of ['#version', '#define', '#ifdef', '#endif', '#extension']) {
    assert.ok(highlight(d).includes('class="tok-directive"'), `${d} should be a directive`);
  }
  // A bare # (no known word) stays unspanned, the word falls through.
  assert.ok(!highlight('#nope').includes('tok-directive'), 'a stray # is not a directive');
});

test('keywords: types, qualifiers, control flow -> tok-keyword', () => {
  for (const k of [
    'void',
    'float',
    'vec3',
    'mat4',
    'sampler2D',
    'uniform',
    'const',
    'for',
    'if',
    'return',
  ]) {
    assert.ok(
      highlight(k).includes('<span class="tok-keyword">' + k + '</span>'),
      `${k} should be a keyword`
    );
  }
});

test('builtins: functions and gl_* variables -> tok-builtin', () => {
  for (const b of [
    'sin',
    'normalize',
    'dot',
    'cross',
    'mix',
    'clamp',
    'texture',
    'gl_FragCoord',
    'gl_Position',
  ]) {
    assert.ok(
      highlight(b).includes('<span class="tok-builtin">' + b + '</span>'),
      `${b} should be a builtin`
    );
  }
});

test('numbers: float/int/hex/suffixed forms -> tok-number, leading minus stays an operator', () => {
  for (const num of ['1.0', '.5', '1e3', '1.5e-3', '0x1F', '10u', '1.0f', '42']) {
    assert.ok(
      highlight(num).includes('<span class="tok-number">' + num + '</span>'),
      `${num} should be a number`
    );
  }
  const neg = highlight('-0.5');
  assert.ok(neg.includes('<span class="tok-number">0.5</span>'), 'the magnitude is the number');
  assert.ok(neg.startsWith('-'), 'the minus stays as default text');
});

test('comments: line, block (NON-nesting), unterminated; strings', () => {
  assert.ok(
    highlight('// foo').includes('<span class="tok-comment">// foo</span>'),
    'line comment'
  );
  assert.ok(
    highlight('/* x */').includes('<span class="tok-comment">/* x */</span>'),
    'block comment'
  );
  // GLSL block comments do NOT nest: the first */ closes it (unlike POV-Ray).
  const nested = highlight('/* a /* b */ c */');
  assert.ok(
    nested.includes('<span class="tok-comment">/* a /* b */</span>'),
    'block comment ends at the first */'
  );
  assert.ok(
    highlight('/* eof').includes('<span class="tok-comment">/* eof</span>'),
    'unterminated block runs to EOF'
  );
  assert.ok(
    highlight('"path"').includes('<span class="tok-string">"path"</span>'),
    'a quoted string is one span'
  );
  assert.ok(
    highlight('"a\\"b"').includes('<span class="tok-string">"a\\"b"</span>'),
    'an escaped quote stays inside the string'
  );
  assert.ok(
    highlight('"eol\nnext').startsWith('<span class="tok-string">"eol</span>\n'),
    'an unterminated string stops at a newline'
  );
  assert.ok(
    highlight('"eof').includes('<span class="tok-string">"eof</span>'),
    'an unterminated string may run to EOF'
  );
});

test('user identifiers stay neutral; empty input is empty', () => {
  const out = highlight('myUniform fooBar shadeLocal');
  assert.ok(!/tok-keyword|tok-builtin|tok-directive/.test(out), 'user names get no span');
  assert.ok(out.includes('shadeLocal'), 'user names survive as text');
  assert.equal(highlight(''), '');
});
