// Exhaustive tests for the DOM-free APNG encoder (web/apng.js). We synthesize
// REAL minimal PNGs here (a 2x2 RGBA image: IHDR + one zlib-deflated IDAT +
// IEND, every chunk with a correct CRC32) using node:zlib, hand them to
// encodeApng, then walk the output chunk-by-chunk and assert the full APNG
// structure: signature, exactly one acTL, one fcTL per frame, one IDAT plus
// (N-1) fdAT, contiguous shared sequence numbers 0..2N-2, valid CRCs on every
// chunk, and IEND last. The throw branches are each exercised directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { encodeApng } from '../../web/apng.js';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// --- A self-contained CRC32 / chunk toolkit for the test side ---------------
// Deliberately a second, independent implementation so the test does not lean
// on the module under test to build or validate its own fixtures.

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
 * @param {Uint8Array} bytes buffer to checksum
 * @returns {number} unsigned 32-bit PNG CRC over the whole buffer
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} bytes source buffer
 * @param {number} offset byte offset of the most significant byte
 * @returns {number} big-endian uint32 at offset
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
 * Frame one chunk: length(4 BE) | type(4) | data | crc(4 BE).
 * @param {string} type 4-character chunk type
 * @param {Uint8Array} data payload
 * @returns {Uint8Array} the framed chunk
 */
function makeChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Concatenate a list of byte buffers.
 * @param {Uint8Array[]} parts buffers in order
 * @returns {Uint8Array} the joined buffer
 */
function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/**
 * Build a real, minimal, valid PNG (width x height, 8-bit RGBA = color type 6).
 * Scanlines are filled with a solid color and each is prefixed with filter
 * byte 0, then the whole thing is zlib-deflated into a single IDAT.
 * @param {number} width image width in pixels
 * @param {number} height image height in pixels
 * @param {[number, number, number, number]} rgba the fill color
 * @returns {Uint8Array} a complete PNG file
 */
function makePng(width, height, rgba) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // ihdr[10..12] = compression/filter/interlace = 0

  const bytesPerPixel = 4;
  const rowBytes = 1 + width * bytesPerPixel; // 1 filter byte + pixels
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * bytesPerPixel;
      raw[p] = rgba[0];
      raw[p + 1] = rgba[1];
      raw[p + 2] = rgba[2];
      raw[p + 3] = rgba[3];
    }
  }
  const idat = new Uint8Array(zlib.deflateSync(raw));

  return concat([
    Uint8Array.from(PNG_SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * @typedef {{ type: string, data: Uint8Array, crcOk: boolean }} WalkedChunk
 */

/**
 * Walk every chunk of a PNG/APNG file, recomputing each CRC for validation.
 * @param {Uint8Array} png the file to enumerate
 * @returns {WalkedChunk[]} chunks in file order with a crcOk flag each
 */
function walkChunks(png) {
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature');
  /** @type {WalkedChunk[]} */
  const chunks = [];
  let pos = 8;
  while (pos + 8 <= png.length) {
    const length = readUint32(png, pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    const storedCrc = readUint32(png, dataEnd);
    const computed = crc32(png.subarray(pos + 4, dataEnd));
    chunks.push({ type, data: png.subarray(dataStart, dataEnd), crcOk: computed === storedCrc });
    pos = dataEnd + 4;
  }
  assert.equal(pos, png.length, 'chunks must tile the file exactly with no trailing bytes');
  return chunks;
}

/**
 * Collect the sequence numbers from every fcTL and fdAT chunk in walk order.
 * fcTL seq is the first uint32 of its data; fdAT seq is the first uint32 too.
 * @param {WalkedChunk[]} chunks the walked output chunks
 * @returns {number[]} sequence numbers in emission order
 */
function sequenceNumbers(chunks) {
  const seqs = [];
  for (const c of chunks) {
    if (c.type === 'fcTL' || c.type === 'fdAT') {
      seqs.push(readUint32(c.data, 0));
    }
  }
  return seqs;
}

test('output starts with the PNG signature and ends with IEND', () => {
  const frames = [makePng(2, 2, [255, 0, 0, 255]), makePng(2, 2, [0, 255, 0, 128])];
  const apng = encodeApng(frames, { delayNum: 100 });
  assert.deepEqual([...apng.subarray(0, 8)], PNG_SIGNATURE, 'signature');
  const chunks = walkChunks(apng);
  assert.equal(chunks[chunks.length - 1].type, 'IEND', 'last chunk must be IEND');
});

test('exactly one acTL with correct num_frames and num_plays', () => {
  const frames = [
    makePng(2, 2, [255, 0, 0, 255]),
    makePng(2, 2, [0, 255, 0, 255]),
    makePng(2, 2, [0, 0, 255, 255]),
  ];
  const apng = encodeApng(frames, { delayNum: 50, numPlays: 7 });
  const chunks = walkChunks(apng);
  const actl = chunks.filter((c) => c.type === 'acTL');
  assert.equal(actl.length, 1, 'exactly one acTL');
  assert.equal(readUint32(actl[0].data, 0), frames.length, 'num_frames === frames.length');
  assert.equal(readUint32(actl[0].data, 4), 7, 'num_plays === the numPlays passed');
});

test('chunk counts: one fcTL per frame, one IDAT, N-1 fdAT', () => {
  const frames = [
    makePng(2, 2, [255, 0, 0, 255]),
    makePng(2, 2, [0, 255, 0, 255]),
    makePng(2, 2, [0, 0, 255, 255]),
    makePng(2, 2, [255, 255, 0, 255]),
  ];
  const apng = encodeApng(frames, { delayNum: 33 });
  const chunks = walkChunks(apng);
  const count = (type) => chunks.filter((c) => c.type === type).length;
  assert.equal(count('fcTL'), frames.length, 'one fcTL per frame');
  assert.equal(count('IDAT'), 1, 'exactly one IDAT');
  assert.equal(count('fdAT'), frames.length - 1, 'N-1 fdAT');
});

test('every chunk CRC validates', () => {
  const frames = [makePng(3, 4, [10, 20, 30, 40]), makePng(3, 4, [200, 100, 50, 255])];
  const apng = encodeApng(frames, { delayNum: 100 });
  const chunks = walkChunks(apng);
  for (const c of chunks) {
    assert.ok(c.crcOk, `CRC must validate for chunk ${c.type}`);
  }
});

test('sequence numbers are contiguous 0..2N-2 across fcTL+fdAT', () => {
  const n = 5;
  const frames = Array.from({ length: n }, (_, i) => makePng(2, 2, [i * 10, 0, 0, 255]));
  const apng = encodeApng(frames, { delayNum: 20 });
  const chunks = walkChunks(apng);
  const seqs = sequenceNumbers(chunks);
  const expected = Array.from({ length: 2 * n - 1 }, (_, i) => i);
  assert.deepEqual(seqs, expected, 'sequence numbers must be 0,1,2,...,2N-2 contiguous');
});

test('fcTL carries frame 0 dimensions and the clamped delay', () => {
  const frames = [makePng(7, 5, [1, 2, 3, 4]), makePng(7, 5, [5, 6, 7, 8])];
  const apng = encodeApng(frames, { delayNum: 250, delayDen: 1000 });
  const chunks = walkChunks(apng);
  const fctl = chunks.find((c) => c.type === 'fcTL');
  assert.ok(fctl, 'fcTL present');
  assert.equal(fctl.data.length, 26, 'fcTL data is 26 bytes');
  assert.equal(readUint32(fctl.data, 4), 7, 'fcTL width === IHDR width');
  assert.equal(readUint32(fctl.data, 8), 5, 'fcTL height === IHDR height');
  assert.equal(readUint32(fctl.data, 12), 0, 'x_offset 0');
  assert.equal(readUint32(fctl.data, 16), 0, 'y_offset 0');
  const delayNum = (fctl.data[20] << 8) | fctl.data[21];
  const delayDen = (fctl.data[22] << 8) | fctl.data[23];
  assert.equal(delayNum, 250, 'delay_num');
  assert.equal(delayDen, 1000, 'delay_den');
  assert.equal(fctl.data[24], 0, 'dispose_op NONE');
  assert.equal(fctl.data[25], 0, 'blend_op SOURCE');
});

test('default delay_den is 1000 (milliseconds) and default numPlays is 0', () => {
  const frames = [makePng(2, 2, [0, 0, 0, 255]), makePng(2, 2, [255, 255, 255, 255])];
  const apng = encodeApng(frames, { delayNum: 16 });
  const chunks = walkChunks(apng);
  const actl = chunks.find((c) => c.type === 'acTL');
  assert.ok(actl);
  assert.equal(readUint32(actl.data, 4), 0, 'default numPlays 0 (loop forever)');
  const fctl = chunks.find((c) => c.type === 'fcTL');
  assert.ok(fctl);
  const delayDen = (fctl.data[22] << 8) | fctl.data[23];
  assert.equal(delayDen, 1000, 'default delay_den 1000');
});

test('delay numerator/denominator are clamped to 16 bits', () => {
  // 0x12345 -> low 16 bits 0x2345; den default 1000 stays as-is.
  const frames = [makePng(2, 2, [0, 0, 0, 255]), makePng(2, 2, [1, 1, 1, 255])];
  const apng = encodeApng(frames, { delayNum: 0x12345, delayDen: 0x1ffff });
  const chunks = walkChunks(apng);
  const fctl = chunks.find((c) => c.type === 'fcTL');
  assert.ok(fctl);
  const delayNum = (fctl.data[20] << 8) | fctl.data[21];
  const delayDen = (fctl.data[22] << 8) | fctl.data[23];
  assert.equal(delayNum, 0x2345, 'delay_num clamped to low 16 bits');
  assert.equal(delayDen, 0xffff, 'delay_den clamped to low 16 bits');
});

test('frame 0 IDAT bytes are reused verbatim (lossless, no re-encode)', () => {
  const frame0 = makePng(2, 2, [11, 22, 33, 44]);
  const apng = encodeApng([frame0, makePng(2, 2, [0, 0, 0, 0])], { delayNum: 100 });
  // Pull frame 0's original IDAT and the output IDAT and compare byte-for-byte.
  const srcIdat = walkChunks(frame0).find((c) => c.type === 'IDAT');
  const outIdat = walkChunks(apng).find((c) => c.type === 'IDAT');
  assert.ok(srcIdat && outIdat);
  assert.deepEqual([...outIdat.data], [...srcIdat.data], 'IDAT reused unchanged');
});

test('later-frame IDAT bytes are reused verbatim inside fdAT (after the seq)', () => {
  const frame1 = makePng(2, 2, [99, 88, 77, 66]);
  const apng = encodeApng([makePng(2, 2, [0, 0, 0, 255]), frame1], { delayNum: 100 });
  const srcIdat = walkChunks(frame1).find((c) => c.type === 'IDAT');
  const fdat = walkChunks(apng).find((c) => c.type === 'fdAT');
  assert.ok(srcIdat && fdat);
  // fdAT payload is seq(4) + the original IDAT bytes.
  assert.deepEqual([...fdat.data.subarray(4)], [...srcIdat.data], 'fdAT carries IDAT unchanged');
});

test('multi-IDAT source frame is joined into one block', () => {
  // Hand-build a PNG whose pixel stream is split across two IDAT chunks; the
  // encoder must concatenate them into a single IDAT in the output.
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 2);
  dv.setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowBytes = 1 + 2 * 4;
  const raw = new Uint8Array(rowBytes * 2);
  const compressed = new Uint8Array(zlib.deflateSync(raw));
  const half = Math.floor(compressed.length / 2);
  const splitPng = concat([
    Uint8Array.from(PNG_SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed.subarray(0, half)),
    makeChunk('IDAT', compressed.subarray(half)),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
  const apng = encodeApng([splitPng, makePng(2, 2, [1, 2, 3, 4])], { delayNum: 100 });
  const chunks = walkChunks(apng);
  const idats = chunks.filter((c) => c.type === 'IDAT');
  assert.equal(idats.length, 1, 'split IDATs are merged into one');
  assert.deepEqual([...idats[0].data], [...compressed], 'merged IDAT equals the full stream');
});

test('single-frame input yields a valid one-frame APNG', () => {
  const apng = encodeApng([makePng(2, 2, [255, 0, 0, 255])], { delayNum: 100, numPlays: 3 });
  const chunks = walkChunks(apng);
  const count = (type) => chunks.filter((c) => c.type === type).length;
  const actl = chunks.find((c) => c.type === 'acTL');
  assert.ok(actl);
  assert.equal(readUint32(actl.data, 0), 1, 'num_frames 1');
  assert.equal(count('fcTL'), 1, 'one fcTL');
  assert.equal(count('IDAT'), 1, 'one IDAT');
  assert.equal(count('fdAT'), 0, 'zero fdAT');
  assert.deepEqual(sequenceNumbers(chunks), [0], 'single fcTL has sequence number 0');
  for (const c of chunks) assert.ok(c.crcOk, `CRC ${c.type}`);
});

test('throws on empty frames array', () => {
  assert.throws(() => encodeApng([], { delayNum: 100 }), /must not be empty/);
});

test('throws when a frame has a bad PNG signature', () => {
  const good = makePng(2, 2, [0, 0, 0, 255]);
  const bad = new Uint8Array(good); // clone then corrupt the magic
  bad[1] = 0;
  assert.throws(() => encodeApng([good, bad], { delayNum: 100 }), /frame 1 is not a PNG/);
});

test('throws when frame 0 is missing IHDR', () => {
  // A "PNG" with a valid signature but no IHDR (jump straight to IEND).
  const noIhdr = concat([Uint8Array.from(PNG_SIGNATURE), makeChunk('IEND', new Uint8Array(0))]);
  assert.throws(() => encodeApng([noIhdr], { delayNum: 100 }), /no IHDR/);
});

test('throws when frame 0 is missing IDAT', () => {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 2);
  dv.setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const noIdat = concat([
    Uint8Array.from(PNG_SIGNATURE),
    makeChunk('IHDR', ihdr),
    makeChunk('IEND', new Uint8Array(0)),
  ]);
  assert.throws(() => encodeApng([noIdat], { delayNum: 100 }), /no IDAT/);
});

test('a truncated trailing chunk is ignored, not fatal', () => {
  // Exercises parseChunks' "not enough bytes for data + crc" break: a valid
  // IHDR+IDAT followed by a dangling chunk header whose declared length runs
  // past the buffer end. The good chunks still parse; the stub is dropped.
  const good = makePng(2, 2, [10, 20, 30, 40]);
  const truncated = walkChunks(good); // confirm `good` itself is well-formed
  assert.ok(truncated.length >= 2);
  // Append a chunk header claiming a huge length with no data/crc behind it.
  const stub = new Uint8Array(8);
  new DataView(stub.buffer).setUint32(0, 0xffff); // length far past EOF
  for (let i = 0; i < 4; i++) stub[4 + i] = 'tEXt'.charCodeAt(i);
  const withStub = concat([good, stub]);
  const apng = encodeApng([withStub, makePng(2, 2, [1, 2, 3, 4])], { delayNum: 100 });
  const chunks = walkChunks(apng);
  assert.equal(chunks.filter((c) => c.type === 'IDAT').length, 1, 'IDAT still found');
  for (const c of chunks) assert.ok(c.crcOk, `CRC ${c.type}`);
});

test('a sub-8-byte buffer is rejected as a bad signature', () => {
  // Exercises hasPngSignature's length guard via the public throw path.
  assert.throws(() => encodeApng([new Uint8Array([137, 80, 78])], { delayNum: 100 }), /not a PNG/);
});
