// Shareable-permalink codec: a scene + render settings round-tripped through a
// URL-hash-safe payload. JSON -> UTF-8 -> gzip -> base64url (and back). Pure,
// DOM-free, and node-unit-testable: CompressionStream/DecompressionStream,
// Response, Blob, atob/btoa, TextEncoder/TextDecoder are all built-ins on the
// supported runtimes. ui.ts imports the two public functions; the helpers stay
// private so the surface is just encode/decode.

/**
 * The scene + render settings captured into a permalink. Mirrors the saveState
 * shape MINUS `liveDraft` (a permalink should not flip the recipient's
 * live-draft preference) and MINUS `example` (the link carries literal scene
 * text, not the sender's example selection). All control fields are the raw
 * input *strings* (same as localStorage), so hydration writes them straight
 * back into the inputs.
 *
 * A type ALIAS rather than an interface for the same reason as url-params'
 * RenderParams: web/ui.ts hydrates it through applyControls(), whose source is an
 * open `{ [key: string]: string | undefined }`, and TypeScript infers an implicit
 * index signature for an object type alias but never for an interface.
 */
export type PermalinkState = {
  source: string;
  width: string;
  height: string;
  quality: string;
  antialias: string;
  threads: string;
  /** raw POV-Ray flags; optional so links predating the field still decode */
  flags?: string;
  /** live-draft preview edge; optional so links predating the field still decode */
  draft?: string;
  /**
   * Which handoff minted the link, when it wasn't the editor's own Copy Link. The
   * reader needs it because a foreign scene has to be LABELED as one: the editor
   * used to name every hydrated link after whatever example the recipient last
   * selected. Optional, so an ordinary shared link (and every link predating the
   * field) still decodes.
   */
  origin?: PermalinkOrigin;
  mode: 'still' | 'animate';
  frames: string;
  fps: string;
};

/**
 * The handoff producers allowed to stamp `origin`: web/turbo.html's Ray-trace
 * button and the REPL's `:editor`. Copy Link inside the editor leaves it off,
 * and the reader treats a missing origin as a plain shared scene.
 */
export type PermalinkOrigin = 'turbo' | 'repl';

// Spelled out as a literal tuple so the runtime list and PermalinkOrigin cannot
// drift: isOrigin() is what decides whether a decoded tag survives, and a value
// missing here would be silently dropped from an otherwise valid link.
const ORIGINS: readonly PermalinkOrigin[] = ['turbo', 'repl'];

function isOrigin(value: unknown): value is PermalinkOrigin {
  return ORIGINS.includes(value as PermalinkOrigin);
}

/** @returns base64url (no '=' padding, '+'->'-', '/'->'_') */
function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @returns the decoded bytes */
function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  // Restore the standard alphabet; atob tolerates missing '=' padding but
  // throws on out-of-alphabet chars, so the caller's try/catch turns garbage
  // into a null decode (the tolerance contract).
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std); // may throw -> caught by decodeState
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Run bytes through a gzip (de)compression stream.
 *
 * The buffers are spelled `Uint8Array<ArrayBuffer>` rather than plain
 * `Uint8Array` because this page runs cross-origin-isolated: with
 * SharedArrayBuffer in scope, a bare `Uint8Array` widens to `ArrayBufferLike`,
 * which the stream writer (BufferSource) won't accept.
 */
async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  which: 'CompressionStream' | 'DecompressionStream',
  format: 'gzip'
): Promise<Uint8Array<ArrayBuffer>> {
  const Ctor = which === 'CompressionStream' ? CompressionStream : DecompressionStream;
  const stream = new Ctor(format);
  const writer = stream.writable.getWriter();
  // Drive the writable side as a side promise: on invalid gzip bytes BOTH the
  // write/close and the read reject, so we swallow the writer rejection here and
  // let the read be the single thrower the caller's try/catch sees (otherwise
  // the unawaited writer rejection surfaces as an unhandled rejection).
  const written = (async () => {
    await writer.write(bytes);
    await writer.close();
  })().catch(() => {});
  const buf = await new Response(stream.readable).arrayBuffer();
  await written;
  return new Uint8Array(buf);
}

/**
 * Shape guard so a structurally-valid-but-wrong payload decodes to null (never
 * a half-applied state). The flat `&&` chain short-circuits; branch coverage
 * needs each operand seen true and false across the suite, not one test each.
 */
function isPermalinkState(o: unknown): o is PermalinkState {
  if (!o || typeof o !== 'object') return false;
  const s = o as Record<string, unknown>;
  const str = (k: string) => typeof s[k] === 'string';
  return (
    str('source') &&
    str('width') &&
    str('height') &&
    str('quality') &&
    str('antialias') &&
    str('threads') &&
    str('frames') &&
    str('fps') &&
    (s.mode === 'still' || s.mode === 'animate')
  );
}

/**
 * Compress a state object to a URL-hash-safe base64url payload. Async because
 * the gzip stream is async; never throws for a well-formed state object.
 */
export async function encodeState(state: PermalinkState): Promise<string> {
  const json = JSON.stringify(state);
  const gz = await pipe(new TextEncoder().encode(json), 'CompressionStream', 'gzip');
  return bytesToBase64url(gz);
}

/**
 * Inverse of encodeState. Tolerant: returns null for any malformed input (bad
 * base64, non-gzip bytes, invalid JSON, wrong shape) instead of throwing.
 */
export async function decodeState(payload: string): Promise<PermalinkState | null> {
  try {
    const bytes = base64urlToBytes(payload);
    const raw = await pipe(bytes, 'DecompressionStream', 'gzip'); // throws on non-gzip
    const obj = JSON.parse(new TextDecoder().decode(raw)); // throws on bad JSON
    if (!isPermalinkState(obj)) return null;
    // An `origin` this build doesn't recognize is DROPPED rather than rejected,
    // unlike a bad `mode`: a newer producer must not brick an older reader's
    // link over a provenance tag it can simply treat as a plain shared scene.
    if (obj.origin !== undefined && !isOrigin(obj.origin)) delete obj.origin;
    return obj;
  } catch {
    return null;
  }
}
