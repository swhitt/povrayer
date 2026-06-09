// Turn a parsed render-stats object (render-client's parseStats output) plus the
// render dimensions and wall-clock time into a flat list of label/value rows for
// the stats readout under the image. Pure and DOM-free so it node-unit-tests
// without a browser; ui.js owns the chip markup.
//
// The render log always carries Trace Time / Rays / threads on the shipped dist,
// but each numeric is treated as optional here: a row whose source datum is
// missing (or a derived value that would divide by zero) is omitted entirely, so
// the readout never shows a blank, NaN, or Infinity.

/**
 * @param {number} n
 * @returns {string} a compact magnitude: 1.2M, 13.8k, or a bare integer
 */
function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * @param {{ traceSeconds?: number, parseSeconds?: number, rays?: number, threads?: number, warnings?: number }} stats
 * @param {{ width: number, height: number, elapsedMs: number }} meta
 * @returns {{ label: string, value: string }[]}
 */
export function formatStats(stats, meta) {
  /** @type {{ label: string, value: string }[]} */
  const rows = [];
  const { width, height, elapsedMs } = meta;

  rows.push({ label: 'resolution', value: `${width} × ${height}` });
  rows.push({ label: 'pixels', value: (width * height).toLocaleString('en-US') });
  rows.push({ label: 'total', value: `${(elapsedMs / 1000).toFixed(2)}s` });

  if (stats.parseSeconds != null) {
    rows.push({ label: 'parse', value: `${stats.parseSeconds.toFixed(2)}s` });
  }
  if (stats.traceSeconds != null) {
    rows.push({ label: 'trace', value: `${stats.traceSeconds.toFixed(2)}s` });
  }
  if (stats.rays != null) {
    rows.push({ label: 'rays', value: stats.rays.toLocaleString('en-US') });
  }
  // Rays per traced second is the headline "how fast" number, but it needs both
  // the ray count and a non-zero trace time (a sub-millisecond trace prints
  // 0.000s and would divide to Infinity).
  if (stats.rays != null && stats.traceSeconds != null && stats.traceSeconds > 0) {
    rows.push({ label: 'rays/s', value: `${compact(stats.rays / stats.traceSeconds)}` });
  }
  if (stats.threads != null) {
    rows.push({ label: 'threads', value: String(stats.threads) });
  }
  // Warnings only earn a chip when there are some; a clean render stays quiet.
  if (stats.warnings != null && stats.warnings > 0) {
    rows.push({ label: 'warnings', value: String(stats.warnings) });
  }

  return rows;
}
