import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSceneState, displacesWork } from '../../web/scene-state.js';

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

test('example loads update provenance and dirty/reset queries', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  assert.equal(state.selectedExample, 'one');
  assert.equal(state.loadedSource, 'sphere');
  assert.equal(state.isDirty('sphere'), false);
  assert.equal(state.canReset('sphere'), false);
  assert.equal(state.sceneName('sphere'), 'one');

  state.loadExample('two', 'box');
  assert.equal(state.selectedExample, 'two');
  assert.equal(state.loadedSource, 'box');
  assert.equal(state.isDirty('edited box'), true);
  assert.equal(state.canReset('edited box'), true);
  assert.equal(state.resetSource(), 'box');
  assert.equal(state.sceneName('edited box'), 'edited scene');
});

test('an empty baseline cannot be reset and a permalink keeps the example name', () => {
  const state = createSceneState({ selectedExample: 'one' });
  assert.equal(state.canReset('edited'), false);
  state.adoptSource('shared scene');
  assert.equal(state.selectedExample, 'one');
  assert.equal(state.loadedSource, 'shared scene');
  assert.equal(state.isDirty('shared scene'), false);
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

test('gist pins survive pristine reads and clear on divergence', () => {
  const state = createSceneState({ selectedExample: 'one', loadedSource: 'sphere' });
  assert.equal(state.pinnedGistId('sphere'), null);
  state.pinGist('abc123', 'gist scene');
  assert.equal(state.pinnedGistId('gist scene'), 'abc123');
  assert.equal(state.pinnedGistId('edited gist'), null);
  assert.equal(state.pinnedGistId('gist scene'), null, 'a cleared pin does not revive');
});
