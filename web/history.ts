// Lightweight, text-only scene history: a capped, consecutively-deduped list of
// scene-source snapshots taken at explicit-render milestones (never per keystroke,
// never on the live draft), so a user can jump back to a previously rendered
// version. Pure and DOM-free: callers supply `now`, storage, and any DOM rendering,
// so it node-tests to 100%. Text only by design (no thumbnails) to stay lightweight.

export interface Snapshot {
  /** epoch ms the snapshot was taken */
  t: number;
  source: string;
}

/**
 * Prepend a snapshot (newest-first), skipping the no-op when the source is
 * identical to the current newest entry, and capping the list to `max`.
 * Returns the SAME array reference on a dedup skip so the caller can avoid a
 * redundant save/re-render.
 * @param now epoch ms
 */
export function addSnapshot(
  list: Snapshot[],
  source: string,
  now: number,
  max: number
): Snapshot[] {
  if (list[0] && list[0].source === source) return list;
  return [{ t: now, source }, ...list].slice(0, max);
}

/**
 * Load history snapshots from best-effort string storage. Malformed JSON starts
 * fresh, and mixed arrays keep only records that match the snapshot shape.
 */
export function loadSnapshots(
  storage: { getItem(key: string): string | null },
  key: string
): Snapshot[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) || '[]');
    // The filter IS the validation, and saying so as a type PREDICATE is what
    // keeps JSON.parse's `any` from leaking into the return type: `unknown` goes
    // in, a real Snapshot[] comes out, with no assertion anywhere. The narrowing
    // is spelled out (`typeof`/`in`) rather than reaching straight for `.source`
    // on an untrusted value, which is the same check the JSDoc version made,
    // just one tsc believes.
    return Array.isArray(raw)
      ? raw.filter(
          (e: unknown): e is Snapshot =>
            typeof e === 'object' &&
            e !== null &&
            'source' in e &&
            typeof e.source === 'string' &&
            't' in e &&
            typeof e.t === 'number'
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Persist history snapshots to best-effort string storage.
 * @returns true when storage accepted the write
 */
export function saveSnapshots(
  storage: { setItem(key: string, value: string): void },
  key: string,
  list: Snapshot[]
): boolean {
  try {
    storage.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * A short human label for a snapshot: its first non-blank line with any leading
 * comment marker stripped, trimmed and truncated; '(blank scene)' if there is none.
 */
export function snapshotPreview(source: string): string {
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
 *
 * @param source the snapshot text
 * @param current the current editor text
 */
export function lineDelta(
  source: string,
  current: string
): { added: number; removed: number } | null {
  if (source === current) return null;
  const tally = (text: string) => {
    const m = new Map<string, number>();
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
 * @param then epoch ms
 * @param now epoch ms
 */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
