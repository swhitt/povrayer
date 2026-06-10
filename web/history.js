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
