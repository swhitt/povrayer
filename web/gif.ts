// Pure, DOM-free GIF89a animated-GIF encoder. Turns an array of RGBA frame
// buffers (the raytracer's animation output) into one looping animated GIF.
//
// Fully deterministic: no Math.random, no Date. The same frames in always
// produce byte-identical bytes out, which keeps tests reproducible and lets the
// page cache results by content hash.
//
// Pipeline: build ONE global palette (median-cut quantization over a stride
// sample of opaque pixels), map every pixel to a palette index (RGB555-cached
// nearest-color search so a 512x384x24-frame encode stays well under a second),
// LZW-compress each frame's index stream, then assemble the GIF89a container.

/**
 * One RGBA frame: `data` is width*height*4 bytes, row-major, top-to-bottom,
 * channels R,G,B,A.
 */
export interface RgbaFrame {
  data: Uint8Array;
}

export interface GifOptions {
  width: number;
  height: number;
  /** per-frame delay in centiseconds (1/100 s) */
  delayCs: number;
  /** loop count; 0 (default) loops forever */
  numPlays?: number;
  /** reserve a palette slot for alpha < 128 (default true) */
  transparent?: boolean;
}

/**
 * One palette entry. A fixed-length tuple rather than `number[]`: every read
 * below is `c[0]`/`c[1]`/`c[2]`, and the GIF global color table is defined as
 * exactly three bytes per slot, so the length is part of the contract.
 */
type Rgb = [number, number, number];

/** Pixels with alpha below this count as transparent. */
const ALPHA_THRESHOLD = 128;

/** Cap on sampled opaque pixels fed to median-cut, to bound quantization cost. */
const MAX_SAMPLES = 50000;

/**
 * A median-cut box: a contiguous slice [lo, hi) of the shared sample array plus
 * the cached per-channel min/max of the colors in that slice.
 */
interface Box {
  /** inclusive start index into the sample array */
  lo: number;
  /** exclusive end index */
  hi: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

/**
 * Encode RGBA frames into one looping GIF89a animated GIF.
 * @param frames each `.data` is RGBA, length width*height*4
 * @returns the GIF89a bytes
 */
export function encodeGif(frames: readonly RgbaFrame[], opts: GifOptions): Uint8Array<ArrayBuffer> {
  const { width, height, delayCs } = opts;
  const numPlays = opts.numPlays ?? 0;
  const wantTransparent = opts.transparent ?? true;
  const expectedLen = width * height * 4;

  if (frames.length === 0) throw new Error('encodeGif: no frames');
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].data.length !== expectedLen) {
      throw new Error(
        `encodeGif: frame ${i} has ${frames[i].data.length} bytes, expected ${expectedLen}`
      );
    }
  }

  // Transparency only kicks in if the caller wants it AND some pixel is actually
  // see-through. A fully opaque animation keeps all 256 palette slots for color.
  let transparencyNeeded = false;
  if (wantTransparent) {
    outer: for (const frame of frames) {
      const d = frame.data;
      for (let p = 3; p < d.length; p += 4) {
        if (d[p] < ALPHA_THRESHOLD) {
          transparencyNeeded = true;
          break outer;
        }
      }
    }
  }

  const maxColors = transparencyNeeded ? 255 : 256;
  const samples = sampleOpaque(frames, expectedLen);
  const palette = medianCut(samples, maxColors);

  // Transparent index is appended last so the color slots keep their indices.
  const transparentIndex = transparencyNeeded ? palette.length : -1;
  if (transparencyNeeded) palette.push([0, 0, 0]);

  // GIF global color table length must be a power of two; pad up with black.
  const sizeBits = tableSizeBits(palette.length);
  const tableLen = 1 << sizeBits;
  while (palette.length < tableLen) palette.push([0, 0, 0]);

  const indexer = makeIndexer(palette, transparencyNeeded ? transparentIndex : -1);

  const out = new ByteWriter();
  writeHeader(out, width, height, sizeBits);
  writeGlobalColorTable(out, palette);
  writeNetscapeLoop(out, numPlays);

  // min code size is the table's bit-width but never below 2 (GIF requires it).
  const minCodeSize = Math.max(2, sizeBits);
  for (const frame of frames) {
    const indices = mapFrame(frame.data, indexer, transparencyNeeded ? transparentIndex : -1);
    writeGraphicsControl(out, delayCs, transparencyNeeded, transparentIndex);
    writeImageDescriptor(out, width, height);
    out.byte(minCodeSize);
    writeSubBlocks(out, lzwCompress(indices, minCodeSize));
  }

  out.byte(0x3b); // trailer
  return out.take();
}

/**
 * Collect an evenly-strided sample of opaque pixels across all frames, capped at
 * MAX_SAMPLES so quantization cost is independent of resolution and frame count.
 * @param frameLen bytes per frame (width*height*4)
 * @returns packed RGB triples (length is a multiple of 3)
 */
function sampleOpaque(frames: readonly RgbaFrame[], frameLen: number): Uint8Array {
  const totalPixels = (frameLen / 4) * frames.length;
  // Stride so we visit at most ~MAX_SAMPLES pixels, spread evenly.
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLES));

  const acc: number[] = [];
  let pixel = 0;
  for (const frame of frames) {
    const d = frame.data;
    for (let off = 0; off < d.length; off += 4, pixel++) {
      if (pixel % stride !== 0) continue;
      if (d[off + 3] < ALPHA_THRESHOLD) continue;
      acc.push(d[off], d[off + 1], d[off + 2]);
    }
  }

  // If every sampled pixel was transparent (or there were none), fall back to a
  // single black sample so median-cut always has something to average.
  if (acc.length === 0) acc.push(0, 0, 0);
  return Uint8Array.from(acc);
}

/**
 * Deterministic median-cut quantization.
 *
 * Start with one box over every sampled color. Repeatedly take the box with the
 * largest single-channel range, sort its slice by that (longest) channel, and
 * split it at the median, until we reach maxColors boxes or no box can split
 * further (a box of one color has zero range). Each final color is the average
 * of its box's pixels. Sorting is a stable comparator on the chosen channel, so
 * the result is fully determined by the input.
 * @param samples packed RGB triples
 * @param maxColors target palette size (<= 256)
 */
function medianCut(samples: Uint8Array, maxColors: number): Rgb[] {
  const count = samples.length / 3;
  // Index array we permute in place; the actual RGB bytes stay put in `samples`.
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;

  const boxes: Box[] = [makeBox(samples, idx, 0, count)];

  while (boxes.length < maxColors) {
    // Pick the box whose longest channel has the largest range. Ties resolve to
    // the earliest box, keeping the split order deterministic.
    let target = -1;
    let bestRange = 0;
    for (let i = 0; i < boxes.length; i++) {
      const range = boxRange(boxes[i]);
      if (range > bestRange) {
        bestRange = range;
        target = i;
      }
    }
    if (target === -1) break; // every box is a single color; nothing to split

    const box = boxes[target];
    const channel = longestChannel(box);

    // Sort this box's slice by the chosen channel. Insertion sort is stable and
    // fine here (boxes shrink fast), so equal keys keep their input order.
    sortSliceByChannel(samples, idx, box.lo, box.hi, channel);

    const mid = (box.lo + box.hi) >> 1;
    boxes[target] = makeBox(samples, idx, box.lo, mid);
    boxes.push(makeBox(samples, idx, mid, box.hi));
  }

  return boxes.map((b) => boxAverage(samples, idx, b));
}

/** Build a box over the slice [lo, hi) and cache its per-channel extents. */
function makeBox(samples: Uint8Array, idx: Uint32Array, lo: number, hi: number): Box {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (let i = lo; i < hi; i++) {
    const o = idx[i] * 3;
    const r = samples[o];
    const g = samples[o + 1];
    const b = samples[o + 2];
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  return { lo, hi, rMin, rMax, gMin, gMax, bMin, bMax };
}

/** Largest single-channel range in the box (its splittability score). */
function boxRange(box: Box): number {
  return Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
}

/**
 * Channel (0=R, 1=G, 2=B) with the widest range. Ties prefer R then G, which is
 * deterministic.
 */
function longestChannel(box: Box): number {
  const dr = box.rMax - box.rMin;
  const dg = box.gMax - box.gMin;
  const db = box.bMax - box.bMin;
  if (dr >= dg && dr >= db) return 0;
  if (dg >= db) return 1;
  return 2;
}

/**
 * Stable counting sort of idx[lo..hi) by the given color channel. The channel is
 * one byte, so 256 buckets sort the slice in O(n) and, because we scan the slice
 * in order and emit buckets in order, equal keys keep their input order (stable,
 * hence deterministic). This replaces an insertion sort that went quadratic on
 * the first ~50000-sample box and dominated encode time.
 * @param channel 0=R, 1=G, 2=B
 */
function sortSliceByChannel(
  samples: Uint8Array,
  idx: Uint32Array,
  lo: number,
  hi: number,
  channel: number
): void {
  const n = hi - lo;
  // Histogram of the 256 possible channel values across the slice.
  const counts = new Uint32Array(256);
  for (let i = lo; i < hi; i++) counts[samples[idx[i] * 3 + channel]]++;
  // Prefix-sum into start offsets so each value writes into its own run.
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    const c = counts[v];
    counts[v] = acc;
    acc += c;
  }
  // Stable scatter into scratch, then copy back over the original slice.
  const scratch = new Uint32Array(n);
  for (let i = lo; i < hi; i++) {
    const key = samples[idx[i] * 3 + channel];
    scratch[counts[key]++] = idx[i];
  }
  for (let i = 0; i < n; i++) idx[lo + i] = scratch[i];
}

/**
 * Average color of a box, rounded. A box always holds >= 1 sample: the initial
 * box covers the (non-empty) sample array, and a box is only ever split when its
 * range > 0, which needs >= 2 pixels, so the median split leaves each side
 * non-empty. Thus n is never 0 and the division is safe.
 */
function boxAverage(samples: Uint8Array, idx: Uint32Array, box: Box): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = box.hi - box.lo;
  for (let i = box.lo; i < box.hi; i++) {
    const o = idx[i] * 3;
    r += samples[o];
    g += samples[o + 1];
    b += samples[o + 2];
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Smallest power-of-two exponent whose table holds `n` entries, clamped to the
 * GIF range [1, 8] (table length 2..256).
 * @returns sizeBits where table length === 1 << sizeBits
 */
function tableSizeBits(n: number): number {
  let bits = 1;
  while (1 << bits < n) bits++;
  return Math.min(8, Math.max(1, bits));
}

/**
 * Build a nearest-palette-color mapper backed by an RGB555 cache. The cache has
 * at most 32768 keys (top 5 bits of each channel), so the linear nearest search
 * runs at most 32768 times no matter how many pixels we map.
 * @param palette padded power-of-two palette
 * @param transparentIndex palette slot for transparent pixels, or -1
 */
function makeIndexer(
  palette: readonly Rgb[],
  transparentIndex: number
): (r: number, g: number, b: number) => number {
  // Search only real color entries, never the padding or the transparent slot,
  // so opaque pixels never quantize onto a placeholder.
  const searchLen = transparentIndex >= 0 ? transparentIndex : palette.length;
  // -1 marks an unfilled cache slot.
  const cache = new Int16Array(32768).fill(-1);

  return function nearest(r: number, g: number, b: number) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit !== -1) return hit;

    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < searchLen; i++) {
      const c = palette[i];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

/**
 * Map one frame's RGBA bytes to palette indices. Pixels below the alpha
 * threshold map to `transparentIndex` (when >= 0); opaque pixels go through the
 * nearest-color indexer.
 * @param data RGBA bytes
 * @param transparentIndex palette slot for transparent pixels, or -1
 * @returns one index per pixel
 */
function mapFrame(
  data: Uint8Array,
  indexer: (r: number, g: number, b: number) => number,
  transparentIndex: number
): Uint8Array {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (transparentIndex >= 0 && data[i + 3] < ALPHA_THRESHOLD) {
      out[p] = transparentIndex;
    } else {
      out[p] = indexer(data[i], data[i + 1], data[i + 2]);
    }
  }
  return out;
}

/**
 * GIF variable-width LZW compression of an index stream.
 *
 * Codes start `minCodeSize + 1` bits wide. The dictionary seeds with the
 * literal codes plus a clear code (2^minCodeSize) and an end code (clear + 1);
 * new strings get codes from clear + 2 upward. When the next code would need a
 * wider field we bump the width, up to 12 bits; when it would exceed 4095 we
 * emit a clear code and reset the dictionary. Codes pack LSB-first into bytes.
 * @param indices palette indices, one per pixel
 * @returns the raw LZW byte stream (not yet sub-blocked)
 */
function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  const bits = new BitWriter();
  let dict = new Map<string, number>();
  let codeWidth = minCodeSize + 1;
  let nextCode = endCode + 1;

  const resetDict = () => {
    dict = new Map();
    codeWidth = minCodeSize + 1;
    nextCode = endCode + 1;
  };

  bits.write(clearCode, codeWidth);
  resetDict();

  if (indices.length === 0) {
    bits.write(endCode, codeWidth);
    return bits.take();
  }

  // `current` is the longest dictionary string matched so far, as a packed key.
  let current = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combined = current + ',' + k;
    if (dict.has(combined)) {
      current = combined;
      continue;
    }

    // Emit the code for `current` (a literal index if it never entered dict).
    bits.write(codeFor(dict, current), codeWidth);

    if (nextCode <= 4095) {
      dict.set(combined, nextCode);
      nextCode++;
      // Widen the code field one assignment LATER than naive arithmetic suggests
      // (at 2^width + 1, not 2^width). A GIF decoder adds its dictionary entry
      // one code behind the encoder, so it only reaches 2^width entries (and
      // bumps its own width) on the following code. Matching that delayed point
      // keeps the bit widths in exact lock-step; growing a step early corrupts
      // the stream even though the code values look right.
      if (nextCode === (1 << codeWidth) + 1 && codeWidth < 12) codeWidth++;
    } else {
      bits.write(clearCode, codeWidth);
      resetDict();
    }
    current = String(k);
  }

  bits.write(codeFor(dict, current), codeWidth);
  bits.write(endCode, codeWidth);
  return bits.take();
}

/**
 * Resolve a dictionary string to its code. Single-index strings are literals
 * (the index value itself); multi-index strings live in the dictionary.
 * @param key comma-joined indices
 */
function codeFor(dict: ReadonlyMap<string, number>, key: string): number {
  const code = dict.get(key);
  if (code !== undefined) return code;
  // A bare literal index never gets inserted into dict; its code is its value.
  return Number(key);
}

/** Append `bytes` to `out` as GIF sub-blocks: <=255-byte chunks, length-prefixed, 0-terminated. */
function writeSubBlocks(out: ByteWriter, bytes: Uint8Array): void {
  let off = 0;
  while (off < bytes.length) {
    const chunk = Math.min(255, bytes.length - off);
    out.byte(chunk);
    out.bytes(bytes.subarray(off, off + chunk));
    off += chunk;
  }
  out.byte(0x00); // block terminator
}

/**
 * GIF header + Logical Screen Descriptor.
 * @param sizeBits global color table size exponent
 */
function writeHeader(out: ByteWriter, width: number, height: number, sizeBits: number): void {
  out.bytes(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])); // "GIF89a"
  out.u16(width);
  out.u16(height);
  // packed: GCT flag (bit7=1), color resolution = sizeBits-1 (bits6-4),
  // sort flag 0, GCT size = sizeBits-1 (bits2-0). Table length is 2^sizeBits.
  out.byte(0x80 | ((sizeBits - 1) << 4) | (sizeBits - 1));
  out.byte(0x00); // background color index
  out.byte(0x00); // pixel aspect ratio (none)
}

/**
 * Global color table: 3 RGB bytes per entry. The palette is already padded to
 * the power-of-two length.
 */
function writeGlobalColorTable(out: ByteWriter, palette: readonly Rgb[]): void {
  for (const c of palette) out.bytes(Uint8Array.from([c[0], c[1], c[2]]));
}

/**
 * NETSCAPE2.0 application extension that drives looping.
 * @param loopCount 0 = infinite
 */
function writeNetscapeLoop(out: ByteWriter, loopCount: number): void {
  out.byte(0x21); // extension introducer
  out.byte(0xff); // application extension label
  out.byte(0x0b); // block size: 11 bytes of identifier+auth
  out.bytes(Uint8Array.from([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30])); // NETSCAPE2.0
  out.byte(0x03); // sub-block size
  out.byte(0x01); // sub-block id: looping
  out.u16(loopCount);
  out.byte(0x00); // block terminator
}

/**
 * Graphics Control Extension preceding a frame's image.
 * @param delayCs delay in centiseconds
 */
function writeGraphicsControl(
  out: ByteWriter,
  delayCs: number,
  useTransparent: boolean,
  transparentIndex: number
): void {
  out.byte(0x21); // extension introducer
  out.byte(0xf9); // graphic control label
  out.byte(0x04); // block size
  // packed: disposal method 1 (restore-to-nothing, leave prior frame) in bits
  // 4-2, transparent-color flag in bit 0.
  out.byte((1 << 2) | (useTransparent ? 1 : 0));
  out.u16(delayCs);
  out.byte(useTransparent ? transparentIndex : 0);
  out.byte(0x00); // block terminator
}

/** Image Descriptor: full-frame image, no local color table. */
function writeImageDescriptor(out: ByteWriter, width: number, height: number): void {
  out.byte(0x2c); // image separator
  out.u16(0); // left
  out.u16(0); // top
  out.u16(width);
  out.u16(height);
  out.byte(0x00); // packed: no local color table, not interlaced
}

/** Growable little-endian byte buffer. */
class ByteWriter {
  buf: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  len = 0;

  /** @param extra bytes about to be appended */
  ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    // Grow to at least double, but never short of what this append needs, so a
    // single large append can't outrun the new capacity.
    const cap = Math.max(this.buf.length * 2, need);
    const grown = new Uint8Array(cap);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  /** @param b a single byte (0-255) */
  byte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  /** @param v a 16-bit value written little-endian */
  u16(v: number): void {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }

  /** @param arr bytes to append */
  bytes(arr: Uint8Array): void {
    this.ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }

  /** @returns the exact-length written bytes */
  take(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.len);
  }
}

/** Packs variable-width codes LSB-first into a byte stream. */
class BitWriter {
  bytes_: number[] = [];
  acc = 0; // bit accumulator
  nbits = 0; // valid bits currently in acc

  /**
   * @param code the value to emit
   * @param width number of bits to emit (LSB-first)
   */
  write(code: number, width: number): void {
    this.acc |= (code << this.nbits) >>> 0;
    this.nbits += width;
    // Flush whole bytes off the low end as they fill up.
    while (this.nbits >= 8) {
      this.bytes_.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.nbits -= 8;
    }
  }

  /** @returns the packed bytes, flushing any partial final byte */
  take(): Uint8Array {
    if (this.nbits > 0) {
      this.bytes_.push(this.acc & 0xff);
      this.acc = 0;
      this.nbits = 0;
    }
    return Uint8Array.from(this.bytes_);
  }
}
