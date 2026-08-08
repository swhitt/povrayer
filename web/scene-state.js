/**
 * True when replacing `current` with `incoming` would actually cost the visitor
 * something, so the caller should stash a recovery copy first.
 *
 * The example picker asks before it replaces edited text, but the deep-link
 * paths (#hash permalink, ?gist=, ?example=) replace it unasked, and a shared
 * link can be the last thing that ever touches a scene the visitor typed. Those
 * paths cannot reasonably confirm (the replacement is the whole point of the
 * link), so they stash instead and let the existing restore offer undo it.
 * Whitespace-only text and a no-op replacement are not worth an offer.
 *
 * @param {string} current the text about to be displaced
 * @param {string} incoming the text replacing it
 */
export function displacesWork(current, incoming) {
  return current.trim() !== '' && current !== incoming;
}

/**
 * Where the scene in the editor CAME FROM. Everything except 'example' is
 * FOREIGN: text this page received rather than loaded out of the catalog, with
 * no catalog entry behind it to name it after or to reset it to.
 *
 *   'example'   a scene from the shipped catalog (the picker or the gallery)
 *   'permalink' a #hash link, from anyone
 *   'gist'      a ?gist= link
 *   'turbo'     handed off by the turbo GPU preview's Ray-trace button
 *   'repl'      handed off by the REPL's :editor command
 *   'custom'    arrived with no upstream identity at all (a dropped .pov)
 *
 * @typedef {'example' | 'permalink' | 'gist' | 'turbo' | 'repl' | 'custom'} Provenance
 */

// What to call a foreign scene in the UI. 'gist' is absent because its label
// carries the id (see originLabel).
const FOREIGN_LABELS = {
  permalink: 'shared scene',
  turbo: 'from turbo',
  repl: 'from the REPL',
  custom: 'custom scene',
};

/** @type {Provenance[]} */
const FOREIGN_PROVENANCES = ['permalink', 'gist', 'turbo', 'repl', 'custom'];

/**
 * The foreign provenance a persisted blob or a decoded link names, or null when
 * it names a catalog example (or carries a value this build doesn't know).
 * Persisted state is visitor-editable and a link can be minted by a newer
 * producer, so an unrecognized tag has to degrade rather than be trusted.
 *
 * @param {unknown} value
 * @returns {Provenance | null}
 */
export function foreignProvenance(value) {
  return FOREIGN_PROVENANCES.find((p) => p === value) ?? null;
}

/**
 * Own the editor's source provenance without duplicating the textarea value.
 * Callers pass the current source into queries, keeping the DOM as the single
 * source of truth while this model tracks loaded, stashed, and gist baselines.
 *
 * @param {{ selectedExample: string, loadedSource?: string }} initial
 */
export function createSceneState({ selectedExample, loadedSource = '' }) {
  let exampleName = selectedExample;
  let exampleSource = loadedSource;
  /** @type {Provenance} */
  let provenance = 'example';
  // Extra identity the label needs, currently only the gist id. Kept apart from
  // the gist PIN below because the pin dies on the first edit while the scene
  // still came from that gist (a label reading `gist null` was the alternative).
  let originDetail = '';
  // One-deep undo for a wholesale replacement. It rewinds identity as well as
  // text: a restored scene that came from an example must not keep claiming it
  // came from the link that displaced it.
  /** @type {{ source: string, provenance: Provenance, originDetail: string, exampleName: string, exampleSource: string }} */
  let stashed = { source: '', provenance, originDetail, exampleName, exampleSource };
  /** @type {string | null} */
  let gistId = null;
  /** @type {string | null} */
  let gistSource = null;

  function loadExample(name, source) {
    exampleName = name;
    exampleSource = source;
    provenance = 'example';
    originDetail = '';
  }

  /**
   * Adopt a scene this page RECEIVED (a #hash permalink, a ?gist, a turbo or
   * REPL handoff, a dropped .pov) as the loaded scene. It becomes its own
   * dirty/reset baseline, and the example selection is CLEARED: the trigger
   * label, the dirty chip and Reset all read provenance, so leaving a stale
   * example name standing is exactly how a handed-off scene got labeled with
   * whatever the recipient last picked and then armed Reset to destroy it.
   *
   * @param {string} source
   * @param {Provenance} origin
   * @param {string} [detail] the gist id, which the 'gist' label carries
   */
  function adoptSource(source, origin, detail = '') {
    exampleName = '';
    exampleSource = source;
    provenance = origin;
    originDetail = detail;
  }

  function isDirty(source) {
    return source !== exampleSource;
  }

  function canReset(source) {
    // Reset means "back to the loaded example", which is what the control says
    // it does, so it stays disabled for a foreign scene: one click must never be
    // able to replace a handed-off scene (whose only copy can be this editor)
    // with whichever example the picker happens to be pointing at.
    return provenance === 'example' && exampleSource !== '' && isDirty(source);
  }

  function resetSource() {
    return exampleSource;
  }

  /**
   * What the UI should CALL this scene: null for a catalog example (the caller
   * has the record's title for that), else where the scene came from.
   * @returns {string | null}
   */
  function originLabel() {
    if (provenance === 'example') return null;
    if (provenance === 'gist') return `gist ${originDetail}`;
    return FOREIGN_LABELS[provenance];
  }

  /**
   * The dirty-chip text. 'current' means "matches the catalog example", so a
   * foreign scene cannot use it: it has no catalog entry to be current against,
   * only the state it arrived in.
   * @param {string} source
   */
  function dirtyLabel(source) {
    if (isDirty(source)) return 'modified';
    return provenance === 'example' ? 'current' : 'as received';
  }

  function sceneName(source) {
    if (isDirty(source)) return 'edited scene';
    return originLabel() ?? exampleName;
  }

  function isPristineExample(source, getExampleSource) {
    return source === exampleSource && getExampleSource(exampleName) === exampleSource;
  }

  function stash(source) {
    stashed = { source, provenance, originDetail, exampleName, exampleSource };
  }

  function restoreStash() {
    ({ provenance, originDetail, exampleName, exampleSource } = stashed);
    return stashed.source;
  }

  function pinGist(id, source) {
    gistId = id;
    gistSource = source;
  }

  // Reading a pin after the source diverges invalidates it. The caller uses
  // this from both address synchronization and Copy Link, so stale gist URLs
  // cannot survive an edit.
  function pinnedGistId(source) {
    if (!gistId) return null;
    if (source === gistSource) return gistId;
    gistId = null;
    gistSource = null;
    return null;
  }

  return {
    get selectedExample() {
      return exampleName;
    },
    get loadedSource() {
      return exampleSource;
    },
    get provenance() {
      return provenance;
    },
    loadExample,
    adoptSource,
    isDirty,
    canReset,
    resetSource,
    originLabel,
    dirtyLabel,
    sceneName,
    isPristineExample,
    stash,
    restoreStash,
    pinGist,
    pinnedGistId,
  };
}
