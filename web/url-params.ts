// Parse render-setting query params (e.g. ?width=1200&q=11&mode=animate) into a
// partial settings object that ui.js applies to the controls on load. Pure and
// node-testable; the DOM-dependent bits (matching quality/antialias against the
// actual <select> options) stay in ui.js.
//
// Both full names and short aliases are accepted (width|w, height|h, quality|q,
// antialias|aa, threads|t; frames/fps/mode are full-name only). Numeric params
// are clamped to the same ranges the controls enforce; anything non-numeric or a
// mode that isn't still|animate is dropped (its key omitted) so a junk param
// never clobbers a good control value.

/** @returns the clamped integer, or null when v is absent/non-numeric */
function clampInt(v: string | null, lo: number, hi: number): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

// Every value is a STRING because these land in <input>/<select> .value. The keys
// mirror settings.ts's CONTROL_FIELDS plus `mode`; each is optional because an
// absent (or rejected) param must leave the control alone, which is why the
// parser omits keys rather than writing null or ''.
export interface RenderParams {
  width?: string;
  height?: string;
  quality?: string;
  antialias?: string;
  draft?: string;
  threads?: string;
  mode?: 'still' | 'animate';
  frames?: string;
  fps?: string;
  flags?: string;
}

/** @param search a `location.search` string (the leading `?` is optional) */
export function parseRenderParams(search: string): RenderParams {
  const p = new URLSearchParams(search);
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = p.get(k);
      if (v !== null) return v;
    }
    return null;
  };
  const out: RenderParams = {};

  const w = clampInt(pick('width', 'w'), 8, 2048);
  if (w !== null) out.width = String(w);
  const h = clampInt(pick('height', 'h'), 8, 2048);
  if (h !== null) out.height = String(h);
  const t = clampInt(pick('threads', 't'), 1, 32);
  if (t !== null) out.threads = String(t);
  const f = clampInt(pick('frames'), 1, 240);
  if (f !== null) out.frames = String(f);
  const fps = clampInt(pick('fps'), 1, 60);
  if (fps !== null) out.fps = String(fps);

  // quality/antialias are validated against the live <select> options by the
  // caller (that option set lives in the DOM), so pass the raw string through.
  // For quality that option set is the twelve POV-Ray +Q levels, '0'..'11' (the
  // range dist/ itself validates), so ?q=9 and ?q=11 both land now; an empty
  // ?q= is the legacy spelling of 9 and settings.ts migrates it.
  const q = pick('quality', 'q');
  if (q !== null) out.quality = q;
  const aa = pick('antialias', 'aa');
  if (aa !== null) out.antialias = aa;
  // Live-draft preview edge, validated against its <select> options like the two
  // above (full-name only; 'd' would read ambiguously next to w/h).
  const draft = pick('draft');
  if (draft !== null) out.draft = draft;

  // Raw extra flags (matches the saved-state + permalink field set), passed
  // through verbatim like quality/antialias.
  const flags = pick('flags');
  if (flags !== null) out.flags = flags;

  const m = pick('mode');
  if (m === 'still' || m === 'animate') out.mode = m;

  return out;
}

// Hosts whose serving layer rewrites /e/<name> back to /?example=<name>:
// vercel.json redirects in production (the apex plus *.vercel.app previews) and
// serve.mjs locally. Plain static hosting (GitHub Pages) has no redirect layer,
// so everywhere else keeps the ?example= query form, which works on any host.
const EXAMPLE_SHORT_LINK_HOSTS = new Set(['povrayer.com', 'localhost', '127.0.0.1']);

/**
 * Routes an example share link onto `url`: the pretty /e/<name> path form on
 * hosts that can redirect it, the ?example= query form everywhere else.
 * Mutates and returns `url` (render params are appended by the caller either way).
 *
 * @param url the app-root base URL to share
 * @param name the example slug
 */
export function applyExampleShareTarget(url: URL, name: string): URL {
  if (EXAMPLE_SHORT_LINK_HOSTS.has(url.hostname) || url.hostname.endsWith('.vercel.app')) {
    url.pathname = `/e/${name}`;
  } else {
    url.searchParams.set('example', name);
  }
  return url;
}
