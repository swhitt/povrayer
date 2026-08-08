// Exhaustive tests for web/gif.js, the pure GIF89a animated-GIF encoder. We
// build tiny RGBA frames by hand and assert on the byte structure of the output
// (header, logical screen descriptor, NETSCAPE loop block, per-frame Graphics
// Control + Image Descriptor, trailer), plus the two error branches.
//
// The LZW round-trip is the load-bearing test: a self-contained decoder below
// reads one frame's image-data sub-blocks back into indices and we assert they
// equal the indices the encoder's mapping produced. That proves compression
// correctness end-to-end without trusting the encoder to also decode.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeGif } from '../../_build/web/gif.js';

const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

/**
 * Build an RGBA frame from a flat list of [r,g,b,a] tuples (row-major).
 * @param {number[][]} pixels
 * @returns {{ data: Uint8Array }}
 */
function frameOf(pixels) {
  const data = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b, a] = pixels[i];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data };
}

/** A solid-color RGBA frame of `w*h` opaque pixels. */
function solidFrame(w, h, r, g, b) {
  const px = [];
  for (let i = 0; i < w * h; i++) px.push([r, g, b, 255]);
  return frameOf(px);
}

/** Read a little-endian u16 at offset `o`. */
function u16(bytes, o) {
  return bytes[o] | (bytes[o + 1] << 8);
}

// --- Structural parser ----------------------------------------------------
// Walk the GIF block stream so tests can assert on counts and locate the image
// data without hardcoding offsets. Returns the global-color-table size, the
// netscape loop count, and a list of frames (each with its GCE packed/transp
// fields and the raw LZW sub-block payload + min code size).

/**
 * @param {Uint8Array} g
 */
function parseGif(g) {
  let p = 0;
  const signature = Array.from(g.subarray(0, 6));
  p = 6;
  const width = u16(g, p);
  p += 2;
  const height = u16(g, p);
  p += 2;
  const packed = g[p];
  p += 1;
  const gctFlag = (packed & 0x80) !== 0;
  const gctSizeBits = (packed & 0x07) + 1;
  const gctLen = gctFlag ? 1 << gctSizeBits : 0;
  const bgIndex = g[p];
  p += 1;
  p += 1; // pixel aspect ratio
  const gct = [];
  for (let i = 0; i < gctLen; i++) {
    gct.push([g[p], g[p + 1], g[p + 2]]);
    p += 3;
  }

  let loopCount = null;
  let gceCount = 0;
  let imageDescriptorCount = 0;
  const frames = [];
  /** @type {{ packed: number, transparentIndex: number, delay: number } | null} */
  let pendingGce = null;

  const skipSubBlocks = () => {
    // Read length-prefixed sub-blocks until the 0 terminator; return the joined
    // payload bytes.
    /** @type {number[]} */
    const payload = [];
    for (;;) {
      const len = g[p++];
      if (len === 0) break;
      for (let i = 0; i < len; i++) payload.push(g[p++]);
    }
    return payload;
  };

  for (;;) {
    const block = g[p++];
    if (block === 0x3b) {
      // trailer
      break;
    } else if (block === 0x21) {
      const label = g[p++];
      if (label === 0xff) {
        const blockSize = g[p++];
        const ident = Array.from(g.subarray(p, p + blockSize));
        p += blockSize;
        const identStr = String.fromCharCode(...ident);
        // First sub-block of NETSCAPE2.0 carries the loop count.
        const subSize = g[p++];
        const subId = g[p++];
        if (identStr === 'NETSCAPE2.0' && subSize === 3 && subId === 1) {
          loopCount = u16(g, p);
        }
        p += subSize - 1; // already consumed subId
        // consume the rest of this app extension's sub-blocks
        for (;;) {
          const len = g[p++];
          if (len === 0) break;
          p += len;
        }
      } else if (label === 0xf9) {
        gceCount++;
        const blockSize = g[p++]; // 0x04
        assert.equal(blockSize, 0x04);
        const gcePacked = g[p++];
        const delay = u16(g, p);
        p += 2;
        const transparentIndex = g[p++];
        const term = g[p++];
        assert.equal(term, 0x00);
        pendingGce = { packed: gcePacked, transparentIndex, delay };
      } else {
        // unknown extension: skip its sub-blocks
        skipSubBlocks();
      }
    } else if (block === 0x2c) {
      imageDescriptorCount++;
      const left = u16(g, p);
      p += 2;
      const top = u16(g, p);
      p += 2;
      const fw = u16(g, p);
      p += 2;
      const fh = u16(g, p);
      p += 2;
      const imgPacked = g[p++];
      const lctFlag = (imgPacked & 0x80) !== 0;
      assert.equal(lctFlag, false, 'image should not declare a local color table');
      const minCodeSize = g[p++];
      const lzw = skipSubBlocks();
      frames.push({
        left,
        top,
        width: fw,
        height: fh,
        minCodeSize,
        lzw,
        gce: pendingGce,
      });
      pendingGce = null;
    } else {
      throw new Error(`unexpected block 0x${block.toString(16)} at ${p - 1}`);
    }
  }

  return {
    signature,
    width,
    height,
    bgIndex,
    gctSizeBits,
    gctLen,
    gct,
    loopCount,
    gceCount,
    imageDescriptorCount,
    frames,
  };
}

// --- Standalone LZW decoder ----------------------------------------------
// Minimal GIF LZW: read codes LSB-first at a growing width and rebuild the
// dictionary so we can verify the encoder's output decodes to the original
// indices. Kept independent of the encoder on purpose.

/**
 * @param {number[]} bytes the raw LZW byte stream (sub-blocks already joined)
 * @param {number} minCodeSize
 * @returns {number[]} decoded palette indices
 */
function lzwDecode(bytes, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let bitPos = 0;
  const readCode = (width) => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byteIndex = bitPos >> 3;
      const bit = (bytes[byteIndex] >> (bitPos & 7)) & 1;
      code |= bit << i;
      bitPos++;
    }
    return code;
  };

  /** @type {number[][]} */
  let dict = [];
  let codeWidth = minCodeSize + 1;

  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict[i] = [i];
    dict[clearCode] = [];
    dict[endCode] = [];
    codeWidth = minCodeSize + 1;
  };
  resetDict();

  /** @type {number[]} */
  const out = [];
  let prev = null;

  for (;;) {
    const code = readCode(codeWidth);
    if (code === endCode) break;
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }

    /** @type {number[]} */
    let entry;
    if (code < dict.length) {
      entry = dict[code];
    } else {
      // The classic KwKwK case: code not yet in dict, equals prev + prev[0].
      entry = prev.concat(prev[0]);
    }
    for (const v of entry) out.push(v);

    if (prev !== null) {
      dict.push(prev.concat(entry[0]));
      // Mirror the encoder's width-growth point exactly.
      if (dict.length === 1 << codeWidth && codeWidth < 12) codeWidth++;
    }
    prev = entry;
  }

  return out;
}

/**
 * Count how many clear codes the stream emits (decoding it the same way as
 * lzwDecode, but tallying resets). A mid-stream clear proves the encoder hit the
 * dictionary-overflow branch.
 * @param {number[]} bytes
 * @param {number} minCodeSize
 * @returns {number}
 */
function countClears(bytes, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let bitPos = 0;
  const readCode = (width) => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byteIndex = bitPos >> 3;
      const bit = (bytes[byteIndex] >> (bitPos & 7)) & 1;
      code |= bit << i;
      bitPos++;
    }
    return code;
  };
  let dictLen = endCode + 1;
  let codeWidth = minCodeSize + 1;
  let prevExisted = false;
  let clears = 0;
  for (;;) {
    const code = readCode(codeWidth);
    if (code === endCode) break;
    if (code === clearCode) {
      clears++;
      dictLen = endCode + 1;
      codeWidth = minCodeSize + 1;
      prevExisted = false;
      continue;
    }
    if (prevExisted) {
      dictLen++;
      if (dictLen === 1 << codeWidth && codeWidth < 12) codeWidth++;
    }
    prevExisted = true;
  }
  return clears;
}

// --- Tests ----------------------------------------------------------------

test('output starts with ASCII "GIF89a"', () => {
  const gif = encodeGif([solidFrame(2, 2, 10, 20, 30)], { width: 2, height: 2, delayCs: 5 });
  assert.deepEqual(Array.from(gif.subarray(0, 6)), GIF89A);
});

test('logical screen width/height are little-endian opts.width/height', () => {
  const gif = encodeGif([solidFrame(3, 7, 0, 0, 0)], { width: 3, height: 7, delayCs: 5 });
  assert.equal(u16(gif, 6), 3);
  assert.equal(u16(gif, 8), 7);
  const parsed = parseGif(gif);
  assert.equal(parsed.width, 3);
  assert.equal(parsed.height, 7);
});

test('NETSCAPE2.0 extension present and loop count matches numPlays', () => {
  const g0 = parseGif(encodeGif([solidFrame(2, 2, 1, 2, 3)], { width: 2, height: 2, delayCs: 5 }));
  assert.equal(g0.loopCount, 0, 'default numPlays is 0 (infinite)');

  const g7 = parseGif(
    encodeGif([solidFrame(2, 2, 1, 2, 3)], { width: 2, height: 2, delayCs: 5, numPlays: 7 })
  );
  assert.equal(g7.loopCount, 7);
});

test('exactly one Graphics Control Extension and one Image Descriptor per frame', () => {
  const frames = [
    solidFrame(2, 2, 255, 0, 0),
    solidFrame(2, 2, 0, 255, 0),
    solidFrame(2, 2, 0, 0, 255),
  ];
  const parsed = parseGif(encodeGif(frames, { width: 2, height: 2, delayCs: 4 }));
  assert.equal(parsed.gceCount, 3);
  assert.equal(parsed.imageDescriptorCount, 3);
  assert.equal(parsed.frames.length, 3);
  for (const f of parsed.frames) {
    assert.equal(f.gce.delay, 4);
    assert.equal(f.width, 2);
    assert.equal(f.height, 2);
  }
});

test('file ends with the 0x3B trailer', () => {
  const gif = encodeGif([solidFrame(2, 2, 9, 9, 9)], { width: 2, height: 2, delayCs: 5 });
  assert.equal(gif[gif.length - 1], 0x3b);
});

test('alpha < 128 sets the transparent-color flag and maps to the transparent index', () => {
  // 2x2: three opaque colors + one transparent (alpha 0) pixel.
  const frame = frameOf([
    [200, 0, 0, 255],
    [0, 200, 0, 255],
    [0, 0, 200, 255],
    [123, 45, 67, 0], // transparent
  ]);
  const gif = encodeGif([frame], { width: 2, height: 2, delayCs: 5 });
  const parsed = parseGif(gif);

  const gce = parsed.frames[0].gce;
  assert.equal(gce.packed & 0x01, 0x01, 'transparent-color flag set');
  // disposal method 1 lives in bits 4-2
  assert.equal((gce.packed >> 2) & 0x07, 1);

  // The transparent index is the last real palette slot (encoder appends it),
  // and with transparency the table is padded but background stays 0.
  const ti = gce.transparentIndex;
  const indices = lzwDecode(parsed.frames[0].lzw, parsed.frames[0].minCodeSize);
  assert.equal(indices.length, 4);
  assert.equal(indices[3], ti, 'the alpha-0 pixel decodes to the transparent index');
  // The three opaque pixels must NOT land on the transparent slot.
  assert.notEqual(indices[0], ti);
  assert.notEqual(indices[1], ti);
  assert.notEqual(indices[2], ti);
});

test('fully opaque animation does not set the transparent flag', () => {
  const gif = encodeGif([solidFrame(2, 2, 50, 60, 70)], { width: 2, height: 2, delayCs: 5 });
  const parsed = parseGif(gif);
  assert.equal(parsed.frames[0].gce.packed & 0x01, 0x00);
});

test('transparent:false keeps the flag off even with alpha-0 pixels', () => {
  const frame = frameOf([
    [200, 0, 0, 255],
    [0, 200, 0, 255],
    [0, 0, 200, 255],
    [10, 10, 10, 0],
  ]);
  const parsed = parseGif(
    encodeGif([frame], { width: 2, height: 2, delayCs: 5, transparent: false })
  );
  assert.equal(parsed.frames[0].gce.packed & 0x01, 0x00);
});

test('>256 distinct colors still yields a <=256-entry global color table', () => {
  // 20x20 = 400 pixels, a programmatic gradient with >256 unique RGB triples.
  const px = [];
  const seen = new Set();
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const r = (x * 13 + y * 7) & 0xff;
      const g = (x * 17 + y * 31) & 0xff;
      const b = (x * 23 + y * 11) & 0xff;
      px.push([r, g, b, 255]);
      seen.add(`${r},${g},${b}`);
    }
  }
  assert.ok(seen.size > 256, `gradient should have >256 unique colors (got ${seen.size})`);

  const gif = encodeGif([frameOf(px)], { width: 20, height: 20, delayCs: 5 });
  const parsed = parseGif(gif);
  assert.ok(parsed.gctLen <= 256, `global color table is ${parsed.gctLen} entries`);
  // Structure stays valid: one frame, one GCE, ends in trailer.
  assert.equal(parsed.frames.length, 1);
  assert.equal(parsed.gceCount, 1);
  assert.equal(gif[gif.length - 1], 0x3b);
  // And the image data round-trips to 400 indices, all within the table.
  const indices = lzwDecode(parsed.frames[0].lzw, parsed.frames[0].minCodeSize);
  assert.equal(indices.length, 400);
  for (const i of indices) assert.ok(i < parsed.gctLen);
});

test('encoding the same frames twice is byte-identical (deterministic)', () => {
  const px = [];
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      px.push([(x * 13 + y * 7) & 0xff, (x * 17 + y * 31) & 0xff, (x * 23 + y * 11) & 0xff, 255]);
    }
  }
  const frames = [frameOf(px), solidFrame(20, 20, 1, 2, 3)];
  const a = encodeGif(frames, { width: 20, height: 20, delayCs: 5, numPlays: 3 });
  const b = encodeGif(frames, { width: 20, height: 20, delayCs: 5, numPlays: 3 });
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('LZW round-trips a tiny hand-computable frame to the exact indices', () => {
  // 4x4 with two opaque colors arranged in a known pattern. The encoder builds a
  // 2-entry palette, color 0 = the average-nearest match for each pixel. With
  // just red and blue, every red pixel maps to one palette slot and every blue
  // to the other; we recover which-is-which from the decode and assert the
  // pattern matches.
  const R = [220, 10, 10, 255];
  const B = [10, 10, 220, 255];
  // pattern (row-major): R B R B / B R B R / R R B B / B B R R
  const pattern = [R, B, R, B, B, R, B, R, R, R, B, B, B, B, R, R];
  const gif = encodeGif([frameOf(pattern)], { width: 4, height: 4, delayCs: 5 });
  const parsed = parseGif(gif);
  const frame = parsed.frames[0];
  const indices = lzwDecode(frame.lzw, frame.minCodeSize);
  assert.equal(indices.length, 16);

  // Two distinct palette indices, one per source color, matching the layout.
  const wantRed = pattern.map((c) => (c === R ? 1 : 0));
  const redIndex = indices[0]; // pixel 0 is R
  const blueIndex = indices[1]; // pixel 1 is B
  assert.notEqual(redIndex, blueIndex);
  for (let i = 0; i < 16; i++) {
    const expectRed = wantRed[i] === 1;
    assert.equal(indices[i], expectRed ? redIndex : blueIndex, `pixel ${i}`);
  }
});

test('throws on empty frames array', () => {
  assert.throws(() => encodeGif([], { width: 2, height: 2, delayCs: 5 }), /no frames/);
});

test('throws when a frame data length does not match width*height*4', () => {
  const bad = { data: new Uint8Array(2 * 2 * 4 - 1) };
  assert.throws(() => encodeGif([bad], { width: 2, height: 2, delayCs: 5 }), /expected 16/);
  // Also when a later frame is the wrong size (exercises the loop index).
  const good = solidFrame(2, 2, 1, 1, 1);
  const bad2 = { data: new Uint8Array(2 * 2 * 4 + 4) };
  assert.throws(() => encodeGif([good, bad2], { width: 2, height: 2, delayCs: 5 }), /frame 1/);
});

test('a fully transparent frame still encodes and round-trips', () => {
  // Every pixel alpha 0: sampleOpaque finds nothing, palette falls back to a
  // single black entry, and every pixel maps to the transparent index.
  const px = [];
  for (let i = 0; i < 4; i++) px.push([5, 5, 5, 0]);
  const gif = encodeGif([frameOf(px)], { width: 2, height: 2, delayCs: 5 });
  const parsed = parseGif(gif);
  const f = parsed.frames[0];
  assert.equal(f.gce.packed & 0x01, 0x01);
  const indices = lzwDecode(f.lzw, f.minCodeSize);
  assert.equal(indices.length, 4);
  for (const i of indices) assert.equal(i, f.gce.transparentIndex);
});

test('a single-pixel frame (empty-after-first LZW path) round-trips', () => {
  // 1x1 means the index stream has length 1: the LZW loop body never runs, so
  // only the initial code + end code are emitted. Exercises that edge.
  const gif = encodeGif([solidFrame(1, 1, 100, 150, 200)], { width: 1, height: 1, delayCs: 5 });
  const parsed = parseGif(gif);
  const f = parsed.frames[0];
  const indices = lzwDecode(f.lzw, f.minCodeSize);
  assert.equal(indices.length, 1);
});

test('many-color frame forces LZW code-width growth and clears', () => {
  // A 1-row frame whose index stream is deliberately near-incompressible: an LCG
  // sprays grayscale values so substrings rarely repeat, filling the LZW
  // dictionary past 4095 and forcing a mid-stream clear. That exercises the full
  // width-growth ladder (3 -> 12 bits) AND the dictionary-reset branch, while
  // staying small/fast (8000 pixels, no quantization stride).
  const N = 8000;
  const px = [];
  let s = 12345;
  for (let i = 0; i < N; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const v = (s >>> 16) & 0xff;
    px.push([v, v, v, 255]);
  }
  const gif = encodeGif([frameOf(px)], { width: N, height: 1, delayCs: 5 });
  const parsed = parseGif(gif);
  const f = parsed.frames[0];
  const indices = lzwDecode(f.lzw, f.minCodeSize);
  assert.equal(indices.length, N);
  for (const i of indices) assert.ok(i < parsed.gctLen);
  // A clear code (value 2^minCodeSize) must appear at least twice: once at the
  // start, and again when the dictionary overflowed. countClears decodes the
  // stream the same way and tallies resets.
  const clears = countClears(f.lzw, f.minCodeSize);
  assert.ok(clears >= 2, `expected a mid-stream clear (saw ${clears})`);
});

test('a frame above the sample cap strides the quantization sample', () => {
  // > 100000 pixels makes sampleOpaque pick a stride of 2 (totalPixels /
  // MAX_SAMPLES), exercising the skip branch. A solid color keeps LZW trivial so
  // the test stays fast despite the large frame.
  const gif = encodeGif([solidFrame(400, 300, 12, 34, 56)], {
    width: 400,
    height: 300,
    delayCs: 5,
  });
  const parsed = parseGif(gif);
  assert.equal(parsed.frames.length, 1);
  const indices = lzwDecode(parsed.frames[0].lzw, parsed.frames[0].minCodeSize);
  assert.equal(indices.length, 400 * 300);
  // Solid color -> a single palette index everywhere.
  for (const i of indices) assert.equal(i, indices[0]);
});

test('a zero-pixel frame takes the empty-index LZW path', () => {
  // height 0 means width*height*4 === 0, so the frame data is empty and the
  // index stream has length 0: LZW emits just clear + end. Structurally still a
  // valid (if degenerate) GIF.
  const gif = encodeGif([{ data: new Uint8Array(0) }], { width: 4, height: 0, delayCs: 5 });
  const parsed = parseGif(gif);
  assert.equal(parsed.frames.length, 1);
  const indices = lzwDecode(parsed.frames[0].lzw, parsed.frames[0].minCodeSize);
  assert.equal(indices.length, 0);
  assert.equal(gif[gif.length - 1], 0x3b);
});
