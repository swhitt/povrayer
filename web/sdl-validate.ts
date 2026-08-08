// Cheap, synchronous "is this buffer worth handing to POV-Ray yet?" pre-check.
// Pure data module, no DOM. This is NOT a parser and never tries to be: it only
// answers whether the source looks structurally complete enough to attempt a
// render, so the live-draft auto-render can stay quiet while the user is visibly
// mid-keystroke (a dangling brace, a half-typed string, an open /* block).
//
// Bias is intentionally toward ALLOWING renders: a scene with a bogus keyword,
// an undefined identifier, a missing `;`, or any real parse error still returns
// ready:true. POV-Ray surfaces those, and the live-draft's non-destructive error
// handling keeps the last good image. We only block on the handful of obvious
// mid-edit signals below, and never on semantics. All shipped EXAMPLES return
// ready:true (the regression guard that this gate isn't over-eager).
//
// One forward character scan with a tiny state machine (code / line-comment /
// block-comment(depth) / string), so braces inside comments or strings can't
// throw off the balance and a `#version` inside a comment or string can't
// falsely satisfy the version check.

/** Anchored at a chosen index (lastIndex) to spot a `#version` directive in code. */
const VERSION_RE = /version(?!\w)/y;

/** Opening bracket -> the closer we expect for it. Angle brackets are absent on
 * purpose: `<` and `>` are both vector delimiters AND comparison operators, so
 * balancing them would false-reject perfectly valid scenes. */
const CLOSERS: Readonly<Record<string, string | undefined>> = { '{': '}', '(': ')', '[': ']' };

const STATE_CODE = 0;
const STATE_LINE = 1; // inside a // line comment, runs to end of line
const STATE_BLOCK = 2; // inside a /* */ block comment (POV-Ray block comments nest)
const STATE_STRING = 3; // inside a "..." string

/**
 * Why a buffer is not worth rendering yet. A stable machine code, not copy:
 * web/render-orchestrator.ts switches on these to decide whether the live-draft
 * preview may still run, and ui.ts maps them to user-facing text.
 */
export type NotReadyReason =
  'empty' | 'no-version' | 'unterminated-comment' | 'unterminated-string' | 'unbalanced';

/**
 * A discriminated union rather than `{ ready: boolean, reason: string | null }`:
 * the two fields were never independent, and pairing them makes `reason`
 * non-null exactly where a caller has already established it is there.
 */
export type SceneValidation =
  { ready: true; reason: null } | { ready: false; reason: NotReadyReason };

/** @param source POV-Ray SDL buffer. */
export function validateScene(source: string): SceneValidation {
  let state = STATE_CODE;
  let depth = 0; // block-comment nesting depth (POV-Ray 3.8 comments nest)
  const stack: string[] = []; // expected closers for the open {}, (), [] seen so far
  let sawContent = false; // any non-whitespace, non-comment code (or a string)
  let sawVersion = false; // a `#version` directive seen in code state
  let mismatch = false; // a wrong closer or an extra close was seen

  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i];

    if (state === STATE_CODE) {
      // Comment openers are checked before content so a comment-only buffer
      // still reads as "empty" (nothing to render), not as code.
      if (ch === '/' && source[i + 1] === '/') {
        state = STATE_LINE;
        i += 2;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        state = STATE_BLOCK;
        depth = 1;
        i += 2;
        continue;
      }
      if (ch === '"') {
        sawContent = true;
        state = STATE_STRING;
        i += 1;
        continue;
      }

      // Any other non-whitespace character is real code content.
      if (!/\s/.test(ch)) sawContent = true;

      // Looked up once, into a local, so the `push` below sees the narrowed
      // `string` rather than the map's honest `string | undefined`.
      const closer = CLOSERS[ch];
      if (ch === '#') {
        VERSION_RE.lastIndex = i + 1;
        if (VERSION_RE.test(source)) sawVersion = true;
      } else if (closer) {
        stack.push(closer);
      } else if (ch === '}' || ch === ')' || ch === ']') {
        if (stack.length === 0 || stack[stack.length - 1] !== ch) {
          mismatch = true; // a wrong closer or a stray extra close
        } else {
          stack.pop();
        }
      }
      i += 1;
      continue;
    }

    if (state === STATE_LINE) {
      if (ch === '\n') state = STATE_CODE;
      i += 1;
      continue;
    }

    if (state === STATE_BLOCK) {
      if (ch === '/' && source[i + 1] === '*') {
        depth += 1; // nested open
        i += 2;
        continue;
      }
      if (ch === '*' && source[i + 1] === '/') {
        depth -= 1;
        i += 2;
        if (depth === 0) state = STATE_CODE;
        continue;
      }
      i += 1;
      continue;
    }

    // STATE_STRING
    if (ch === '\\') {
      i += 2; // skip the escaped char, so \" stays inside the string
      continue;
    }
    if (ch === '"') {
      state = STATE_CODE;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      // A raw newline before the closing quote means the string never closed.
      // Stop scanning: the buffer is clearly mid-edit and leaving state at
      // STATE_STRING below classifies it as 'unterminated-string'.
      break;
    }
    i += 1;
  }

  const terminalComment = state === STATE_BLOCK; // depth > 0 at EOF (or broken nest)
  const terminalString = state === STATE_STRING; // open at EOF or broken by a newline
  const unbalanced = mismatch || stack.length > 0;

  // 'empty' covers a blank, whitespace-only, or (closed) comment-only buffer:
  // no code content and not sitting inside an unterminated block comment. An
  // unterminated comment has no content either, but it's mid-edit, so it falls
  // through to the terminal-state check below rather than reading as empty.
  if (!sawContent && !terminalComment) return { ready: false, reason: 'empty' };
  if (terminalComment) return { ready: false, reason: 'unterminated-comment' };
  if (terminalString) return { ready: false, reason: 'unterminated-string' };
  if (unbalanced) return { ready: false, reason: 'unbalanced' };
  if (!sawVersion) return { ready: false, reason: 'no-version' };
  return { ready: true, reason: null };
}
