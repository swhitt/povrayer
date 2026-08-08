// The shared SDL comment/string-stripping primitive. POV-Ray scenes are full of
// `// ...`, nested `/* ... */`, and `"..."` strings, and several scanners need a
// view of the code with those blanked out so they don't trip over a keyword, a
// `#declare`, or a brace that only appears inside a comment or a string literal.
// This is the one low-level scanner worth sharing (per the architecture review):
// the manifest parser (tools/includes-manifest/parse.mjs) and the REPL scaffold
// probe (web/repl.js) both use it. Pure and DOM-free, so it node-tests to 100%.

/**
 * Replace comment and string CONTENT with spaces, leaving real code intact, so a
 * scan that only cares about code can't match a keyword inside a comment or a
 * `"..."`. Length and newlines are preserved (so nothing shifts and offsets stay
 * valid), the delimiters of strings are kept as `"` `"`, and comment bodies
 * become blanks. Block comments nest exactly like POV-Ray 3.8; an unterminated
 * comment or string runs to EOF/EOL.
 */
export function stripCommentsAndStrings(src: string): string {
  const n = src.length;
  let out = '';
  let i = 0;
  while (i < n) {
    if (src.startsWith('//', i)) {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (src.startsWith('/*', i)) {
      let depth = 1;
      out += '  ';
      i += 2;
      while (i < n && depth > 0) {
        if (src.startsWith('/*', i)) {
          depth++;
          out += '  ';
          i += 2;
        } else if (src.startsWith('*/', i)) {
          depth--;
          out += '  ';
          i += 2;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i++;
        }
      }
      continue;
    }
    if (src[i] === '"') {
      out += '"';
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          out += '"';
          i++;
          break;
        }
        if (src[i] === '\n') {
          out += '\n';
          i++;
          break;
        }
        out += ' ';
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}
