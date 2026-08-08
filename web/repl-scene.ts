import { stripCommentsAndStrings } from './sdl-strip.js';

// Each scaffold line is injected only when its keyword test fails against the
// accumulated source (word-boundary regex), so a user-supplied camera never
// collides with the default one (POV-Ray errors on duplicate cameras). The
// probes run on comment/string-stripped source; a note like "// add camera" must
// not suppress the default camera.
const SCAFFOLD: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bglobal_settings\b/, 'global_settings { assumed_gamma 1.0 }'],
  [/\bcamera\b/, 'camera { location <0, 2, -5> look_at <0, 0.5, 0> }'],
  [/\blight_source\b/, 'light_source { <5, 10, -5> color rgb 1 }'],
  [/\bbackground\b/, 'background { color rgb <0.15, 0.15, 0.18> }'],
]);

// #version is NOT scaffold-conditional: POV-Ray fatals when a scene's first
// #version appears after any other statement, so injected scaffold lines above
// an entry that declares its own #version would break it (every standalone
// example does). A leading #version makes any later in-entry #version a legal
// mid-scene version change, so the assembled scene ALWAYS starts with one.
export const VERSION_LINE = '#version 3.8;';

export interface ReplSceneEntry {
  source: string;
}

export interface ReplSceneSpan {
  /** 1-based assembled-scene start line, inclusive. */
  start: number;
  /** 1-based assembled-scene end line, inclusive. */
  end: number;
}

export interface ReplSceneLocation {
  /** 1-based entry position in scene order. */
  entry: number;
  /** 1-based line within that entry's source. */
  line: number;
}

export interface ReplSceneAssembly {
  source: string;
  spans: readonly ReplSceneSpan[];
  mapLine: (line: number) => ReplSceneLocation | null;
}

/**
 * Assemble REPL entries into the POV-Ray scene handed to the renderer.
 *
 * Pure by design: callers pass the current entry list and receive the complete
 * source plus line-span metadata for mapping renderer errors back to entries.
 */
export function assembleReplScene(entries: readonly ReplSceneEntry[]): ReplSceneAssembly {
  const body = entries.map((e) => e.source).join('\n');
  const probe = stripCommentsAndStrings(body);
  const injected = SCAFFOLD.filter(([re]) => !re.test(probe)).map(([, line]) => line);
  const preamble = [VERSION_LINE, ...injected];

  // Span math mirrors the string assembly below: preamble lines, one blank
  // separator, then the entries joined by single newlines.
  let line = preamble.length + 2;
  const spans = entries.map((e) => {
    const n = e.source.split('\n').length;
    const span = Object.freeze({ start: line, end: line + n - 1 });
    line += n;
    return span;
  });

  return Object.freeze({
    source: preamble.join('\n') + '\n\n' + body,
    spans: Object.freeze(spans),
    mapLine(lineNumber: number) {
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (lineNumber >= span.start && lineNumber <= span.end) {
          return { entry: i + 1, line: lineNumber - span.start + 1 };
        }
      }
      return null;
    },
  });
}
