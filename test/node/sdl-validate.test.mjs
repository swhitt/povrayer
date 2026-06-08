// Pure-data coverage for web/sdl-validate.js. The validity pre-check also runs
// in the browser (web/ui.js gates the live draft on it), but those runs depend
// on Playwright; this Node test pins sdl-validate.js to 100% on its own.
//
// The contract is intentionally permissive: ready:true means "looks complete
// enough to hand to POV-Ray", and the bar is low on purpose. It blocks only on
// the obvious mid-edit signals (dangling brace, open string/comment, missing
// #version, empty buffer), never on semantics. The first test is the
// over-eagerness regression guard: every shipped example must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateScene } from '../../web/sdl-validate.js';
import { EXAMPLES } from '../../web/examples.js';

test('every example scene is ready (the gate is not over-eager)', () => {
  for (const ex of EXAMPLES) {
    assert.deepEqual(
      validateScene(ex.source),
      { ready: true, reason: null },
      `${ex.name} must validate as ready`
    );
  }
});

test('ready:true returns reason:null for a minimal complete scene', () => {
  assert.deepEqual(validateScene('#version 3.8;\nbox{}'), { ready: true, reason: null });
});

test("'empty' covers blank, whitespace-only, and (closed) comment-only buffers", () => {
  assert.deepEqual(validateScene(''), { ready: false, reason: 'empty' });
  assert.deepEqual(validateScene('   \n\t '), { ready: false, reason: 'empty' });
  // A line comment with no trailing newline (runs to EOF) is still empty.
  assert.deepEqual(validateScene('// just a note'), { ready: false, reason: 'empty' });
  // A line comment that DOES close on a newline, then nothing, is empty too.
  assert.deepEqual(validateScene('// note\n'), { ready: false, reason: 'empty' });
  // A closed block comment with nothing else is empty.
  assert.deepEqual(validateScene('/* closed */'), { ready: false, reason: 'empty' });
});

test("'no-version' when structurally complete but the #version directive is absent", () => {
  // No '#' at all.
  assert.deepEqual(validateScene('box{}'), { ready: false, reason: 'no-version' });
  // A '#' that is not '#version' must not satisfy the check.
  assert.deepEqual(validateScene('#declare X = 1; box{}'), { ready: false, reason: 'no-version' });
});

test("'unbalanced' for every bracket mistake the scanner can see", () => {
  // Extra open: a leftover on the stack at EOF.
  assert.deepEqual(validateScene('#version 3.8; box{'), { ready: false, reason: 'unbalanced' });
  // Extra close with an empty stack.
  assert.deepEqual(validateScene('#version 3.8; box}'), { ready: false, reason: 'unbalanced' });
  // Wrong closer: '(' then '}' mismatches the expected ')'.
  assert.deepEqual(validateScene('#version 3.8; ( }'), { ready: false, reason: 'unbalanced' });
  // Unbalanced paren and bracket each count.
  assert.deepEqual(validateScene('#version 3.8; ('), { ready: false, reason: 'unbalanced' });
  assert.deepEqual(validateScene('#version 3.8; ['), { ready: false, reason: 'unbalanced' });
  // All three pairs nested and balanced -> ready (exercises push + correct pop
  // for {}, (), and []).
  assert.deepEqual(validateScene('#version 3.8; { ( [ ] ) }'), { ready: true, reason: null });
});

test("'unterminated-string' for EOF and raw-newline string breaks", () => {
  // Open at EOF.
  assert.deepEqual(validateScene('#version 3.8; "abc'), {
    ready: false,
    reason: 'unterminated-string',
  });
  // A raw newline before the closing quote means the string never closed.
  assert.deepEqual(validateScene('#version 3.8; "abc\ndef'), {
    ready: false,
    reason: 'unterminated-string',
  });
  // An escaped quote stays inside the string and lets it terminate cleanly.
  assert.deepEqual(validateScene('#version 3.8;\n#declare S = "a\\"b";\nbox{}'), {
    ready: true,
    reason: null,
  });
});

test("'unterminated-comment' for open and partially-nested block comments", () => {
  // Open block comment at EOF.
  assert.deepEqual(validateScene('#version 3.8; /* x'), {
    ready: false,
    reason: 'unterminated-comment',
  });
  // Nested open: '/* a /* b */' closes the inner but leaves the outer open
  // (depth 1 at EOF). POV-Ray block comments nest, so this is mid-edit.
  assert.deepEqual(validateScene('#version 3.8; /* a /* b */'), {
    ready: false,
    reason: 'unterminated-comment',
  });
  // A fully-closed nested comment inside an otherwise complete scene is ready
  // (exercises depth++ and the depth-back-to-zero return to code).
  assert.deepEqual(validateScene('#version 3.8;\nbox{}\n/* a /* b */ c */'), {
    ready: true,
    reason: null,
  });
  // A block comment with lone '/' and '*' that are NOT comment delimiters
  // (exercises the second-condition-false arms of the nested-open/close checks).
  assert.deepEqual(validateScene('#version 3.8;\nbox{}\n/* a / b * c */'), {
    ready: true,
    reason: null,
  });
});

test('comment- and string-awareness: brackets inside them never affect balance', () => {
  // '}' inside a line comment.
  assert.deepEqual(validateScene('#version 3.8;\nsphere{0,1} // }\n'), {
    ready: true,
    reason: null,
  });
  // '}' inside a block comment.
  assert.deepEqual(validateScene('#version 3.8;\nbox{} /* } */'), { ready: true, reason: null });
  // '}' inside a string.
  assert.deepEqual(validateScene('#version 3.8;\n#declare S = "}"; box{}'), {
    ready: true,
    reason: null,
  });
  // A line comment that closes on a newline, then real code, then a division
  // operator ('/' in code that is neither // nor /*).
  assert.deepEqual(validateScene('// c\n#version 3.8;\n#declare H = 1 / 2;\nbox{}'), {
    ready: true,
    reason: null,
  });
});

test('a #version inside a comment or string does NOT satisfy the version check', () => {
  assert.deepEqual(validateScene('/* #version 3.8; */ box{}'), {
    ready: false,
    reason: 'no-version',
  });
  assert.deepEqual(validateScene('"#version 3.8;" box{}'), { ready: false, reason: 'no-version' });
});

test('angle brackets and comparisons are never flagged as unbalanced', () => {
  // '<' and '>' are vector delimiters AND comparison operators, so the scanner
  // leaves them out of the balance entirely.
  assert.deepEqual(validateScene('#version 3.8;\n#if (A < B)\n  box{}\n#end'), {
    ready: true,
    reason: null,
  });
  assert.deepEqual(validateScene('#version 3.8;\nsphere{ <1,2,3>, 1 }'), {
    ready: true,
    reason: null,
  });
});

test('precedence: terminal comment/string outranks unbalanced and no-version', () => {
  // Unterminated comment wins over the missing #version and the open brace.
  assert.deepEqual(validateScene('box{ /* x'), { ready: false, reason: 'unterminated-comment' });
  // Unterminated string wins over the missing #version.
  assert.deepEqual(validateScene('box "abc'), { ready: false, reason: 'unterminated-string' });
});
