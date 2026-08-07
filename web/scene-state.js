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
 * Own the editor's source provenance without duplicating the textarea value.
 * Callers pass the current source into queries, keeping the DOM as the single
 * source of truth while this model tracks loaded, stashed, and gist baselines.
 *
 * @param {{ selectedExample: string, loadedSource?: string }} initial
 */
export function createSceneState({ selectedExample, loadedSource = '' }) {
  let exampleName = selectedExample;
  let exampleSource = loadedSource;
  let stashedSource = '';
  /** @type {string | null} */
  let gistId = null;
  /** @type {string | null} */
  let gistSource = null;

  function loadExample(name, source) {
    exampleName = name;
    exampleSource = source;
  }

  // A permalink becomes the dirty/reset baseline but deliberately keeps the
  // selected example name, matching the saved-state behavior of the editor.
  function adoptSource(source) {
    exampleSource = source;
  }

  function isDirty(source) {
    return source !== exampleSource;
  }

  function canReset(source) {
    return exampleSource !== '' && isDirty(source);
  }

  function resetSource() {
    return exampleSource;
  }

  function sceneName(source) {
    return source === exampleSource ? exampleName : 'edited scene';
  }

  function isPristineExample(source, getExampleSource) {
    return source === exampleSource && getExampleSource(exampleName) === exampleSource;
  }

  function stash(source) {
    stashedSource = source;
  }

  function restoreStash() {
    return stashedSource;
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
    loadExample,
    adoptSource,
    isDirty,
    canReset,
    resetSource,
    sceneName,
    isPristineExample,
    stash,
    restoreStash,
    pinGist,
    pinnedGistId,
  };
}
