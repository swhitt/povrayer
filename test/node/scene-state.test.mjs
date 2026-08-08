import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSceneState,
  displacesWork,
  foreignProvenance,
} from '../../_build/web/scene-state.js';

test('displacesWork only offers a restore when real text is actually being lost', () => {
  // The deep-link paths (#hash, ?gist=, ?example=) stash on this verdict, so
  // both refusal arms matter: no offer for an empty plate, none for a re-load of
  // identical text, and an offer whenever typed work would vanish.
  assert.equal(displacesWork('', 'sphere {}'), false);
  assert.equal(displacesWork('   \n\t ', 'sphere {}'), false, 'whitespace is not work');
  assert.equal(displacesWork('sphere {}', 'sphere {}'), false, 'a no-op replacement');
  assert.equal(displacesWork('// MY WORK', 'sphere {}'), true);
  // Whitespace-only incoming text still displaces real work.
  assert.equal(displacesWork('// MY WORK', ''), true);
});

test('foreignProvenance accepts every foreign tag and rejects everything else', () => {
  // The gate between a persisted/decoded value and the model. Every foreign tag
  // has to survive a round trip through localStorage, and anything else has to
  // degrade to "a catalog example" (the state the editor can actually verify).
  for (const tag of ['permalink', 'gist', 'turbo', 'repl', 'custom']) {
    assert.equal(foreignProvenance(tag), tag);
  }
  assert.equal(foreignProvenance('example'), null, 'an example is not foreign');
  assert.equal(foreignProvenance(undefined), null, 'a blob predating the field');
  assert.equal(foreignProvenance('TURBO'), null, 'no case folding: tags are exact');
  assert.equal(foreignProvenance({ provenance: 'turbo' }), null, 'a hand-edited blob');
});

test('example loads update provenance and dirty/reset queries', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  assert.equal(state.selectedExample, 'one');
  assert.equal(state.loadedSource, 'sphere');
  assert.equal(state.provenance, 'example');
  assert.equal(state.isDirty('sphere'), false);
  assert.equal(state.canReset('sphere'), false);
  assert.equal(state.originLabel(), null, 'a catalog example is named by its record');
  assert.equal(state.dirtyLabel('sphere'), 'current');
  assert.equal(state.sceneName('sphere'), 'one');

  state.loadExample('two', 'box');
  assert.equal(state.selectedExample, 'two');
  assert.equal(state.loadedSource, 'box');
  assert.equal(state.isDirty('edited box'), true);
  assert.equal(state.canReset('edited box'), true);
  assert.equal(state.resetSource(), 'box');
  assert.equal(state.dirtyLabel('edited box'), 'modified');
  assert.equal(state.sceneName('edited box'), 'edited scene');
});

test('an empty baseline cannot be reset', () => {
  const state = createSceneState({ selectedExample: 'one' });
  assert.equal(state.canReset('edited'), false);
});

// One case per foreign provenance: the label is what the picker trigger shows in
// place of an example title, and getting it from a stale exampleName is the bug
// (a turbo handoff came back labeled with whatever the recipient last selected).
test('a foreign scene is labeled by its origin and clears the example selection', () => {
  const cases = [
    { origin: 'permalink', label: 'shared scene' },
    { origin: 'turbo', label: 'from turbo' },
    { origin: 'repl', label: 'from the REPL' },
    { origin: 'custom', label: 'custom scene' },
  ];
  for (const { origin, label } of cases) {
    const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
    state.adoptSource('shared', /** @type {any} */ (origin));
    assert.equal(state.provenance, origin);
    assert.equal(state.originLabel(), label);
    assert.equal(state.selectedExample, '', `${origin} clears the stale example name`);
    assert.equal(state.loadedSource, 'shared', `${origin} becomes its own baseline`);
    assert.equal(state.isDirty('shared'), false);
    assert.equal(state.dirtyLabel('shared'), 'as received');
    assert.equal(state.sceneName('shared'), label, 'the alt text names the origin too');
    // The whole point: an edited foreign scene reports modified but Reset stays
    // disabled, because there is no example behind it to reset TO.
    assert.equal(state.dirtyLabel('shared + edit'), 'modified');
    assert.equal(state.canReset('shared + edit'), false);
    assert.equal(state.sceneName('shared + edit'), 'edited scene');
    assert.equal(
      state.isPristineExample('shared', () => 'sphere'),
      false,
      'a foreign scene never qualifies for a short ?example link'
    );
  }
});

test('a gist label carries the id it was adopted with, not the live pin', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  state.pinGist('a1b2c3', 'gist scene');
  state.adoptSource('gist scene', 'gist', 'a1b2c3');
  assert.equal(state.originLabel(), 'gist a1b2c3');
  // Editing invalidates the shareable ?gist URL, but the scene still CAME from
  // that gist, so the label must not follow the pin into null.
  assert.equal(state.pinnedGistId('edited gist'), null);
  assert.equal(state.originLabel(), 'gist a1b2c3');
});

test('loading an example clears a foreign origin again', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  state.adoptSource('shared', 'gist', 'a1b2c3');
  state.loadExample('two', 'box');
  assert.equal(state.provenance, 'example');
  assert.equal(state.originLabel(), null, 'the gist label does not outlive the gist');
  assert.equal(state.dirtyLabel('box'), 'current');
  assert.equal(state.canReset('edited box'), true);
});

test('pristine-example checks require both the baseline and catalog source', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  assert.equal(
    state.isPristineExample('sphere', () => 'sphere'),
    true
  );
  assert.equal(
    state.isPristineExample('edited', () => 'sphere'),
    false
  );
  assert.equal(
    state.isPristineExample('sphere', () => 'changed catalog source'),
    false
  );
});

test('stash preserves the latest replaceable source', () => {
  const state = createSceneState({ selectedExample: 'one' });
  assert.equal(state.restoreStash(), '');
  state.stash('first edit');
  state.stash('latest edit');
  assert.equal(state.restoreStash(), 'latest edit');
});

test('restoring a stash rewinds the scene identity, not just the text', () => {
  // Undoing a permalink/handoff replacement has to put the example baseline back:
  // otherwise the restored work keeps wearing the link's label and Reset stays
  // disabled for a scene that does have an example behind it.
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  state.stash('my edited sphere');
  state.adoptSource('a stranger scene', 'permalink');
  assert.equal(state.originLabel(), 'shared scene');
  assert.equal(state.restoreStash(), 'my edited sphere');
  assert.equal(state.provenance, 'example');
  assert.equal(state.selectedExample, 'one');
  assert.equal(state.loadedSource, 'sphere');
  assert.equal(state.canReset('my edited sphere'), true, 'Reset is armed again, for the example');
});

test('gist pins survive pristine reads and clear on divergence', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  assert.equal(state.pinnedGistId('sphere'), null);
  state.pinGist('abc123', 'gist scene');
  assert.equal(state.pinnedGistId('gist scene'), 'abc123');
  assert.equal(state.pinnedGistId('edited gist'), null);
  assert.equal(state.pinnedGistId('gist scene'), null, 'a cleared pin does not revive');
});
