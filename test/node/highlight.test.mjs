// Pure-data coverage for web/highlight.js. The overlay highlighter also runs in
// the browser (web/ui.js imports it), but those runs depend on Playwright; this
// Node test pins highlight.js to 100% on its own so the gate never hinges on a
// browser driver happening to touch every token class.
//
// The load-bearing property is byte fidelity: the overlay <code> must hold text
// that, with the syntax spans stripped and HTML un-escaped, is identical to the
// textarea. If it drifts by even one character the colored layer slides out of
// alignment behind the caret, so the invariant below is the regression guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { highlight } from '../../web/highlight.js';
import { EXAMPLES } from '../../web/examples.js';

// Drop the only literal tags highlight emits (<span ...> / </span>). All real
// angle brackets in the source are escaped to &lt;/&gt;, so the only raw `<`
// in the output is a tag opener; this strip is exact.
function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

// Reverse highlight's escaping. `&amp;` is undone LAST so a source that already
// contained a literal `&lt;` (escaped to `&amp;lt;`) round-trips byte-for-byte.
function htmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

test('byte-faithful: strip+unescape reproduces every example source exactly', () => {
  for (const ex of EXAMPLES) {
    const html = highlight(ex.source);
    assert.equal(
      htmlUnescape(stripTags(html)),
      ex.source,
      `overlay text drifted from the textarea for ${ex.name}`
    );
    // With spans stripped, no raw angle bracket may survive: every `<`/`>` in a
    // vector or comparison must have become an entity, or the overlay markup
    // would break. (`&` legitimately survives inside `&amp;`/`&lt;`/`&gt;`.)
    assert.ok(
      !/[<>]/.test(stripTags(html)),
      `unescaped angle bracket leaked into the overlay for ${ex.name}`
    );
  }
});

test('HTML-escapes all three of & < > (the markup-injection guard)', () => {
  // One input that exercises every branch of the escape map.
  assert.equal(highlight('& < >'), '&amp; &lt; &gt;');
  // Vectors and rgb<...> are the real-world source of dense angle brackets.
  const vec = highlight('<1,2,3>');
  assert.ok(vec.includes('&lt;') && vec.includes('&gt;'), 'vector brackets must escape');
  assert.ok(!/[<>]/.test(stripTags(vec)), 'no raw angle bracket may remain in a vector');
  const rgb = highlight('rgb<1,1,1>');
  assert.ok(rgb.includes('class="tok-keyword"'), 'rgb should still be a keyword before the vector');
  assert.ok(rgb.includes('&lt;') && rgb.includes('&gt;'), 'the rgb vector brackets must escape');
  assert.ok(!/[<>]/.test(stripTags(rgb)), 'no raw angle bracket may remain in an rgb vector');
  assert.equal(
    htmlUnescape(stripTags(rgb)),
    'rgb<1,1,1>',
    'rgb vector round-trips byte-faithfully'
  );
  // Ampersand on its own.
  assert.ok(highlight('a & b').includes('&amp;'), 'a bare ampersand must escape');
});

test('directives: # + known word -> tok-directive', () => {
  for (const d of ['#version', '#declare', '#if', '#macro', '#for']) {
    const out = highlight(d);
    assert.ok(out.includes('class="tok-directive"'), `${d} should be a directive`);
    assert.ok(out.includes(d), `${d} text should survive`);
  }
});

test('keywords -> tok-keyword', () => {
  for (const k of ['sphere', 'pigment', 'camera']) {
    assert.ok(
      highlight(k).includes('<span class="tok-keyword">' + k + '</span>'),
      `${k} should be a keyword`
    );
  }
});

test('builtins: math/vector fns and coordinate/value ids -> tok-builtin', () => {
  for (const b of ['sin', 'sqrt', 'vnormalize', 'x', 'y', 'z', 'clock', 'pi']) {
    assert.ok(
      highlight(b).includes('<span class="tok-builtin">' + b + '</span>'),
      `${b} should be a builtin`
    );
  }
  // sin( keeps the paren as default text right after the builtin span.
  assert.ok(highlight('sin(').startsWith('<span class="tok-builtin">sin</span>('));
});

test('numbers: every accepted form -> tok-number, leading minus stays an operator', () => {
  for (const num of ['3.8', '1.0', '.5', '1e3', '1.5e-3', '2E10', '1.', '1']) {
    assert.ok(
      highlight(num).includes('<span class="tok-number">' + num + '</span>'),
      `${num} should be a number`
    );
  }
  // A leading '-' is NOT folded into the number (it's an operator), so the span
  // text is the bare magnitude.
  const neg = highlight('-0.5');
  assert.ok(neg.includes('<span class="tok-number">0.5</span>'), 'the magnitude is the number');
  assert.ok(!neg.includes('-0.5'), 'the minus must not join the number span');
  assert.ok(neg.startsWith('-'), 'the minus stays as default text');
});

test('strings: quoted text -> tok-string, with the escaped-quote and EOL/EOF arms', () => {
  assert.ok(
    highlight('"colors.inc"').includes('<span class="tok-string">"colors.inc"</span>'),
    'a closed string is one span'
  );
  // \" stays inside the string (escape branch); the closing quote then ends it.
  const esc = highlight('"a\\"b"');
  assert.ok(esc.includes('<span class="tok-string">"a\\"b"</span>'), 'escaped quote stays inside');
  // Unterminated to EOL: the span stops at the newline, the rest stays default.
  const eol = highlight('"abc\nmore');
  assert.ok(
    eol.includes('<span class="tok-string">"abc</span>'),
    'unterminated string stops at EOL'
  );
  assert.ok(eol.includes('\nmore'), 'text after the line break is outside the string');
  // Unterminated to EOF: the loop exhausts the buffer (no newline, no closer).
  assert.ok(
    highlight('"abc').includes('<span class="tok-string">"abc</span>'),
    'unterminated string runs to EOF'
  );
});

test('comments: line, block, nested block, and unterminated-to-EOF', () => {
  assert.ok(
    highlight('// foo').includes('<span class="tok-comment">// foo</span>'),
    'line comment to EOL'
  );
  // A line comment stops at the newline; the trailing text is outside.
  assert.ok(highlight('// foo\nbar').includes('<span class="tok-comment">// foo</span>\nbar'));
  assert.ok(
    highlight('/* x */').includes('<span class="tok-comment">/* x */</span>'),
    'block comment is one span'
  );
  // POV-Ray block comments nest: the whole depth-counted run is a single span.
  assert.ok(
    highlight('/* a /* b */ c */').includes('<span class="tok-comment">/* a /* b */ c */</span>'),
    'a nested block comment is one span'
  );
  // Unterminated block comment runs to EOF.
  assert.ok(
    highlight('/* unterminated').includes('<span class="tok-comment">/* unterminated</span>'),
    'unterminated block comment runs to EOF'
  );
});

test('user identifiers stay neutral; a stray # is bare; empty input is empty', () => {
  const out = highlight('PipR Die Mats GlossFinish');
  assert.ok(!/tok-keyword|tok-builtin|tok-directive/.test(out), 'user names get no span');
  assert.ok(out.includes('PipR') && out.includes('GlossFinish'), 'user names survive as text');
  // '#' not followed by a known directive emits a bare '#'; the word that
  // follows falls through as a plain identifier (no span).
  const stray = highlight('#nope');
  assert.ok(stray.startsWith('#'), 'a stray # is emitted bare');
  assert.ok(!stray.includes('tok-directive'), 'a stray # is not a directive');
  // '# ' (hash then space) exercises identAt returning '' (no word after #).
  assert.equal(highlight('# '), '# ');
  // Empty input yields empty output (the while loop never runs).
  assert.equal(highlight(''), '');
});

test('punctuation and operators are left unspanned (vectors never turn garish)', () => {
  // None of these need escaping, so the output is byte-identical and span-free.
  assert.equal(highlight('{}(),=*+-/'), '{}(),=*+-/');
  // A lone '/' (not // or /*) is a plain operator.
  assert.equal(highlight('a / b').includes('tok-'), false);
});
