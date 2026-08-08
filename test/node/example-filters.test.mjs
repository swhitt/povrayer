import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import {
  exampleSearchText,
  licenseBucket,
  matchesExampleFilters,
} from '../../web/example-filters.js';
import { EXAMPLES } from '../../web/examples.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

// Every id here is also in examples.test.mjs's LICENSE_ALLOW: that set is what
// EXAMPLES may ship under, this one is how the gallery filter groups it. The
// bucket name is user-visible copy (index.html prints it in two <select>s), so
// each assertion below is a factual claim about the license, not just a mapping:
// CC-BY is attribution-only, CC-BY-SA is the share-alike one, and MIT/Apache/BSD
// are neither. Lumping all six into one 'share-alike' bucket labelled the 36
// CC-BY-3.0 scenes with an obligation their license does not carry.
test('licenseBucket groups shipped licenses by the obligation they actually carry', () => {
  assert.equal(licenseBucket('CC0-1.0'), 'cc0');
  for (const license of ['CC-BY-3.0', 'CC-BY-4.0']) {
    assert.equal(licenseBucket(license), 'cc-by', license);
  }
  for (const license of ['CC-BY-SA-3.0', 'CC-BY-SA-4.0']) {
    assert.equal(licenseBucket(license), 'cc-by-sa', license);
  }
  for (const license of ['MIT', 'Apache-2.0', 'BSD-3-Clause']) {
    assert.equal(licenseBucket(license), 'permissive', license);
  }
  assert.equal(licenseBucket('GPL-3.0-or-later'), 'gpl');
  assert.equal(licenseBucket('LicenseRef-Unknown'), 'other');
});

// Drift guard for the bug this file's mapping used to carry: the JS bucketed and
// index.html labelled, in two files, with nothing tying them together, so the
// gallery shipped cards printing "CC-BY-3.0" under a filter that said
// "share-alike". Both <select>s must offer exactly the buckets the catalog
// actually uses, and the option's LABEL must be the bucket id verbatim: the id is
// SPDX-shaped, which is the only wording guaranteed to stay true of everything in
// the bucket. A friendlier label is a deliberate change, so it fails here first.
test('both license filters offer exactly the buckets EXAMPLES lands in', () => {
  const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
  /** @param {string} id */
  const options = (id) => {
    const select = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    assert.ok(select, `web/index.html should carry a <select id="${id}">`);
    return [...select[1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({
      value: m[1],
      label: m[2].trim(),
    }));
  };
  const used = new Set(EXAMPLES.map((ex) => licenseBucket(ex.license)));
  assert.ok(!used.has('other'), 'every shipped license must be in the LICENSE_BUCKET map');
  for (const id of ['example-license', 'gallery-license']) {
    const opts = options(id);
    assert.deepEqual(
      opts[0],
      { value: 'all', label: 'any license' },
      `${id} leads with any license`
    );
    const buckets = opts.slice(1);
    assert.deepEqual(
      buckets.map((o) => o.value).sort(),
      [...used].sort(),
      `${id} must offer exactly the buckets in use (no dead option, nothing unreachable)`
    );
    for (const o of buckets) {
      assert.equal(
        o.label,
        o.value,
        `${id} option '${o.value}' must be labelled with its bucket id`
      );
    }
  }
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
