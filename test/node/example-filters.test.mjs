import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  exampleSearchText,
  licenseBucket,
  matchesExampleFilters,
} from '../../web/example-filters.js';

const still = {
  animated: false,
  difficulty: 'intro',
  renderTier: 'fast',
  license: 'CC0-1.0',
};

const animated = {
  animated: true,
  difficulty: 'advanced',
  renderTier: 'heavy',
  license: 'GPL-3.0-or-later',
};

test('licenseBucket maps shipped licenses to gallery filter buckets', () => {
  assert.equal(licenseBucket('CC0-1.0'), 'cc0');
  for (const license of [
    'CC-BY-3.0',
    'CC-BY-4.0',
    'CC-BY-SA-3.0',
    'CC-BY-SA-4.0',
    'MIT',
    'Apache-2.0',
    'BSD-3-Clause',
  ]) {
    assert.equal(licenseBucket(license), 'share-alike', license);
  }
  assert.equal(licenseBucket('GPL-3.0-or-later'), 'gpl');
  assert.equal(licenseBucket('LicenseRef-Unknown'), 'other');
});

test('matchesExampleFilters defaults to the unfiltered gallery view', () => {
  assert.equal(matchesExampleFilters(still), true);
  assert.equal(matchesExampleFilters(animated), true);
});

test('matchesExampleFilters filters by animation type', () => {
  assert.equal(matchesExampleFilters(still, { type: 'still' }), true);
  assert.equal(matchesExampleFilters(animated, { type: 'still' }), false);
  assert.equal(matchesExampleFilters(animated, { type: 'animated' }), true);
  assert.equal(matchesExampleFilters(still, { type: 'animated' }), false);
});

test('matchesExampleFilters intersects difficulty, render tier, and license', () => {
  assert.equal(
    matchesExampleFilters(still, {
      difficulty: 'intro',
      tier: 'fast',
      license: 'cc0',
    }),
    true
  );
  assert.equal(matchesExampleFilters(still, { difficulty: 'advanced' }), false);
  assert.equal(matchesExampleFilters(still, { tier: 'heavy' }), false);
  assert.equal(matchesExampleFilters(still, { license: 'gpl' }), false);
  assert.equal(matchesExampleFilters(animated, { license: 'gpl' }), true);
});

test('exampleSearchText includes all visible and useful hidden metadata', () => {
  const text = exampleSearchText(
    {
      name: 'sourced-test-scene',
      title: 'Crystal Tower',
      description: 'Layered glass and fog',
      author: 'Ada Renderer',
      license: 'CC-BY-SA-4.0',
      difficulty: 'advanced',
      renderTier: 'heavy',
      tags: ['caustics', 'architecture'],
    },
    {
      categoryLabel: 'Lighting & Atmosphere',
      difficultyLabel: 'Advanced',
      tierLabel: 'Heavy',
    }
  );
  for (const needle of [
    'sourced-test-scene',
    'crystal tower',
    'layered glass',
    'ada renderer',
    'cc-by-sa-4.0',
    'advanced',
    'heavy',
    'lighting & atmosphere',
    'caustics',
    'architecture',
  ]) {
    assert.ok(text.includes(needle), needle);
  }
});
