// Lightweight, text-only scene history: a capped, consecutively-deduped list of
// scene-source snapshots taken at explicit-render milestones (never per keystroke,
// never on the live draft), so a user can jump back to a previously rendered
// version. Pure and DOM-free, the caller supplies `now` and owns storage + DOM, so
// it node-tests to 100%. Text only by design (no thumbnails) to stay lightweight.

/** @typedef {{ t: number, source: string }} Snapshot */

/**
 * Prepend a snapshot (newest-first), skipping the no-op when the source is
 * identical to the current newest entry, and capping the list to `max`.
 * Returns the SAME array reference on a dedup skip so the caller can avoid a
 * redundant save/re-render.
 * @param {Snapshot[]} list
 * @param {string} source
 * @param {number} now epoch ms
 * @param {number} max
 * @returns {Snapshot[]}
 */
export function addSnapshot(list, source, now, max) {
  if (list[0] && list[0].source === source) return list;
  return [{ t: now, source }, ...list].slice(0, max);
}

/**
 * A short human label for a snapshot: its first non-blank line with any leading
 * comment marker stripped, trimmed and truncated; '(blank scene)' if there is none.
 * @param {string} source
 * @returns {string}
 */
export function snapshotPreview(source) {
  const line = source.split('\n').find((l) => l.trim() !== '');
  if (line === undefined) return '(blank scene)';
  const text = line.replace(/^\s*(\/\/|\/\*)\s*/, '').trim();
  return text.length > 48 ? text.slice(0, 47) + '…' : text;
}

/**
 * Line-multiset delta between a snapshot's text and the current editor text,
 * shaped for a dim "+N −M" badge: `added` counts lines only in `current`,
 * `removed` lines only in `source`. Multiset counts per distinct line (no
 * LCS/ordering: a reordered scene legitimately reads "+0 −0"). Returns null
 * when the two texts are byte-identical so the caller can label the entry
 * "current" instead of "+0 −0".
 * @param {string} source the snapshot text
 * @param {string} current the current editor text
 * @returns {{ added: number, removed: number } | null}
 */
export function lineDelta(source, current) {
  if (source === current) return null;
  /** @param {string} text */
  const tally = (text) => {
    /** @type {Map<string, number>} */
    const m = new Map();
    for (const line of text.split('\n')) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const from = tally(source);
  const to = tally(current);
  let added = 0;
  let removed = 0;
  for (const [line, n] of to) added += Math.max(0, n - (from.get(line) ?? 0));
  for (const [line, n] of from) removed += Math.max(0, n - (to.get(line) ?? 0));
  return { added, removed };
}

/**
 * A coarse "2m ago"-style age. Pure: the caller passes the current time.
 * @param {number} then epoch ms
 * @param {number} now epoch ms
 * @returns {string}
 */
export function relativeTime(then, now) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
