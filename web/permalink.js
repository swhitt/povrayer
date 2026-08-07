// Shareable-permalink codec: a scene + render settings round-tripped through a
// URL-hash-safe payload. JSON -> UTF-8 -> gzip -> base64url (and back). Pure,
// DOM-free, and node-unit-testable: CompressionStream/DecompressionStream,
// Response, Blob, atob/btoa, TextEncoder/TextDecoder are all built-ins on the
// supported runtimes. ui.js imports the two public functions; the helpers stay
// private so the surface is just encode/decode.

/**
 * The scene + render settings captured into a permalink. Mirrors the saveState
 * shape MINUS `liveDraft` (a permalink should not flip the recipient's
 * live-draft preference) and MINUS `example` (the link carries literal scene
 * text, not the sender's example selection). All control fields are the raw
 * input *strings* (same as localStorage), so hydration writes them straight
 * back into the inputs.
 * @typedef {Object} PermalinkState
 * @property {string} source
 * @property {string} width
 * @property {string} height
 * @property {string} quality
 * @property {string} antialias
 * @property {string} threads
 * @property {string} [flags] raw POV-Ray flags; optional so links predating the field still decode
 * @property {string} [draft] live-draft preview edge; optional so links predating the field still decode
 * @property {'still' | 'animate'} mode
 * @property {string} frames
 * @property {string} fps
 */

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url (no '=' padding, '+'->'-', '/'->'_')
 */
function bytesToBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} s
 * @returns {Uint8Array<ArrayBuffer>} the decoded bytes
 */
function base64urlToBytes(s) {
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
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {'CompressionStream' | 'DecompressionStream'} which
 * @param {'gzip'} format
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function pipe(bytes, which, format) {
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
 * @param {unknown} o
 * @returns {o is PermalinkState}
 */
function isPermalinkState(o) {
  if (!o || typeof o !== 'object') return false;
  const s = /** @type {Record<string, unknown>} */ (o);
  const str = (k) => typeof s[k] === 'string';
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
 * @param {PermalinkState} state
 * @returns {Promise<string>}
 */
export async function encodeState(state) {
  const json = JSON.stringify(state);
  const gz = await pipe(new TextEncoder().encode(json), 'CompressionStream', 'gzip');
  return bytesToBase64url(gz);
}

/**
 * Inverse of encodeState. Tolerant: returns null for any malformed input (bad
 * base64, non-gzip bytes, invalid JSON, wrong shape) instead of throwing.
 * @param {string} payload
 * @returns {Promise<PermalinkState | null>}
 */
export async function decodeState(payload) {
  try {
    const bytes = base64urlToBytes(payload);
    const raw = await pipe(bytes, 'DecompressionStream', 'gzip'); // throws on non-gzip
    const obj = JSON.parse(new TextDecoder().decode(raw)); // throws on bad JSON
    return isPermalinkState(obj) ? obj : null;
  } catch {
    return null;
  }
}
