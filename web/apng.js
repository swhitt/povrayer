// Pure, DOM-free APNG (animated PNG) encoder. No imports, no DOM, no re-encoding
// of pixels: it takes a list of already-complete PNG files (the per-frame
// raytraced output) and stitches them into one animated PNG by reusing each
// frame's already-zlib-compressed IDAT bytes verbatim. That keeps it lossless
// and preserves alpha, because we never touch the pixel data, only the chunk
// framing around it.
//
// PNG/APNG chunk layout we rely on (all multi-byte integers are big-endian):
//   signature: 8 bytes (137,80,78,71,13,10,26,10)
//   chunk:     length(4) | type(4 ASCII) | data(length) | crc(4)
//   crc covers type+data, CRC32 with polynomial 0xEDB88320.
// APNG adds three chunk types on top of a still PNG:
//   acTL (animation control): num_frames(4) | num_plays(4)
//   fcTL (frame control, 26 bytes): see fcTLData below
//   fdAT (frame data): sequence_number(4) | <frame's IDAT bytes>
// Frame 0's pixels stay in a normal IDAT (so non-APNG viewers show frame 0);
// frames 1..n-1 ride in fdAT chunks. A single sequence counter is shared by
// fcTL and fdAT chunks, so for N frames the last sequence number is 2N-2.

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** CRC32 lookup table (polynomial 0xEDB88320), built once at module load. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Standard PNG CRC32 over a byte range.
 * @param {Uint8Array} bytes the buffer to checksum (type+data, concatenated)
 * @returns {number} the unsigned 32-bit CRC
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * One parsed PNG chunk: its 4-char type and a view of its data payload.
 * @typedef {{ type: string, data: Uint8Array }} Chunk
 */

/**
 * Split a complete PNG file into its chunks (signature already validated by the
 * caller). Stops at the end of the buffer; a truncated trailing chunk is left
 * out rather than throwing, since callers only consume the chunks they need.
 * @param {Uint8Array} png a complete PNG file
 * @returns {Chunk[]} chunks in file order
 */
function parseChunks(png) {
  /** @type {Chunk[]} */
  const chunks = [];
  let pos = 8; // skip the 8-byte signature
  while (pos + 8 <= png.length) {
    const length = readUint32(png, pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) break; // not enough bytes for data + crc
    chunks.push({ type, data: png.subarray(dataStart, dataEnd) });
    pos = dataEnd + 4; // advance past data and the 4-byte crc
  }
  return chunks;
}

/**
 * Read a big-endian unsigned 32-bit integer.
 * @param {Uint8Array} bytes source buffer
 * @param {number} offset byte offset of the first (most significant) byte
 * @returns {number} the value as an unsigned integer
 */
function readUint32(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000 +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]) >>>
    0
  );
}

/**
 * Test whether a buffer begins with the 8-byte PNG signature.
 * @param {Uint8Array} png candidate buffer
 * @returns {boolean} true when the first 8 bytes are the PNG magic
 */
function hasPngSignature(png) {
  if (png.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Serialize one PNG chunk: length(4 BE) | type(4 ASCII) | data | crc(4 BE).
 * @param {string} type the 4-character chunk type
 * @param {Uint8Array} data the chunk payload (may be empty)
 * @returns {Uint8Array} the framed chunk with a correct trailing CRC
 */
function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  // CRC is taken over type+data, i.e. everything between the length and the CRC.
  const crc = crc32(out.subarray(4, 8 + data.length));
  writeUint32(out, 8 + data.length, crc);
  return out;
}

/**
 * Write a big-endian unsigned 32-bit integer in place.
 * @param {Uint8Array} bytes destination buffer
 * @param {number} offset byte offset to write the first (most significant) byte
 * @param {number} value the value to encode (truncated to 32 bits)
 * @returns {void}
 */
function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Write a big-endian unsigned 16-bit integer in place.
 * @param {Uint8Array} bytes destination buffer
 * @param {number} offset byte offset to write the high byte
 * @param {number} value the value to encode (truncated to 16 bits)
 * @returns {void}
 */
function writeUint16(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

/**
 * Concatenate the payloads of every IDAT chunk in a frame into one buffer. A
 * PNG may split its compressed stream across several IDAT chunks; the animated
 * output carries each frame's pixels as a single contiguous block.
 * @param {Chunk[]} chunks the frame's parsed chunks
 * @returns {Uint8Array} the joined IDAT bytes
 */
function joinIdat(chunks) {
  let total = 0;
  for (const c of chunks) {
    if (c.type === 'IDAT') total += c.data.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    if (c.type === 'IDAT') {
      out.set(c.data, pos);
      pos += c.data.length;
    }
  }
  return out;
}

/**
 * Build a 26-byte fcTL (frame control) payload.
 * @param {number} seq the shared sequence number for this chunk
 * @param {number} width frame width in pixels (from frame 0's IHDR)
 * @param {number} height frame height in pixels (from frame 0's IHDR)
 * @param {number} delayNum delay numerator, clamped to 16 bits
 * @param {number} delayDen delay denominator, clamped to 16 bits
 * @returns {Uint8Array} the fcTL data block
 */
function fcTLData(seq, width, height, delayNum, delayDen) {
  const data = new Uint8Array(26);
  writeUint32(data, 0, seq);
  writeUint32(data, 4, width);
  writeUint32(data, 8, height);
  writeUint32(data, 12, 0); // x_offset
  writeUint32(data, 16, 0); // y_offset
  writeUint16(data, 20, delayNum);
  writeUint16(data, 22, delayDen);
  data[24] = 0; // dispose_op = NONE
  data[25] = 0; // blend_op = SOURCE
  return data;
}

/**
 * Encode an array of complete PNG files into a single animated PNG (APNG),
 * reusing each frame's already-compressed IDAT bytes (lossless, alpha-safe).
 * @param {Uint8Array[]} frames each a complete PNG file; all must share
 *   dimensions, bit depth, and color type (frame 0's IHDR is copied verbatim)
 * @param {{ delayNum: number, delayDen?: number, numPlays?: number }} opts
 *   delayNum/delayDen express the per-frame delay as a fraction of a second
 *   (default den 1000 = milliseconds); numPlays 0 = loop forever
 * @returns {Uint8Array<ArrayBuffer>} a valid APNG
 */
export function encodeApng(frames, opts) {
  if (frames.length === 0) {
    throw new Error('encodeApng: frames must not be empty');
  }
  for (let i = 0; i < frames.length; i++) {
    if (!hasPngSignature(frames[i])) {
      throw new Error(`encodeApng: frame ${i} is not a PNG (bad signature)`);
    }
  }

  // Frame 0 supplies the IHDR (copied verbatim) and the canvas dimensions.
  const frame0Chunks = parseChunks(frames[0]);
  const ihdr = frame0Chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) {
    throw new Error('encodeApng: frame 0 has no IHDR chunk');
  }
  const hasIdat = frame0Chunks.some((c) => c.type === 'IDAT');
  if (!hasIdat) {
    throw new Error('encodeApng: frame 0 has no IDAT chunk');
  }

  // Width/height are the first two big-endian uint32s of the IHDR data.
  const width = readUint32(ihdr.data, 0);
  const height = readUint32(ihdr.data, 4);

  const delayNum = opts.delayNum & 0xffff;
  const delayDen = (opts.delayDen ?? 1000) & 0xffff;
  const numPlays = opts.numPlays ?? 0;

  /** @type {Uint8Array[]} */
  const out = [PNG_SIGNATURE, makeChunk('IHDR', ihdr.data)];

  // acTL: animation control. num_frames, then num_plays (0 = loop forever).
  const acTL = new Uint8Array(8);
  writeUint32(acTL, 0, frames.length);
  writeUint32(acTL, 4, numPlays);
  out.push(makeChunk('acTL', acTL));

  // One sequence counter shared by every fcTL and fdAT chunk, in emission order.
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    const idat = i === 0 ? joinIdat(frame0Chunks) : joinIdat(parseChunks(frames[i]));

    // Each frame opens with its fcTL, consuming one sequence number.
    out.push(makeChunk('fcTL', fcTLData(seq++, width, height, delayNum, delayDen)));

    if (i === 0) {
      // Frame 0's pixels stay in a plain IDAT so still viewers render it.
      out.push(makeChunk('IDAT', idat));
    } else {
      // Later frames ride in fdAT: sequence_number(4 BE) + the IDAT bytes.
      const fdAT = new Uint8Array(4 + idat.length);
      writeUint32(fdAT, 0, seq++);
      fdAT.set(idat, 4);
      out.push(makeChunk('fdAT', fdAT));
    }
  }

  out.push(makeChunk('IEND', new Uint8Array(0)));

  // Flatten the chunk list into the final contiguous buffer.
  let totalLength = 0;
  for (const part of out) totalLength += part.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of out) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}
