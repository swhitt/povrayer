// Pure-data coverage for web/examples.js. The module is also exercised in the
// browser (the REPL and UI import it), but those runs depend on Playwright; this
// node test pins examples.js to 100% on its own so the gate never hinges on a
// browser driver happening to touch every branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAMPLES,
  FEATURED_EXAMPLE_NAMES,
  FEATURED_EXAMPLES,
  CATEGORIES,
  DIFFICULTIES,
  RENDER_TIERS,
  getExample,
  getExampleRecord,
  groupAllByCategory,
  groupByCategory,
} from '../../web/examples.js';

// SPDX ids the library is allowed to ship under.
const LICENSE_ALLOW = new Set([
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'GPL-3.0-or-later',
]);

test('EXAMPLES is a non-empty array of fully-specified records', () => {
  assert.ok(Array.isArray(EXAMPLES), 'EXAMPLES must be an array');
  assert.ok(EXAMPLES.length > 0, 'EXAMPLES must not be empty');

  const keys = new Set(CATEGORIES.map((c) => c.key));
  const difficultyKeys = new Set(DIFFICULTIES.map((d) => d.key));
  const renderTierKeys = new Set(RENDER_TIERS.map((t) => t.key));

  for (const ex of EXAMPLES) {
    assert.equal(typeof ex.name, 'string', 'name must be a string');
    assert.ok(ex.name.length > 0, `name must be non-empty (${JSON.stringify(ex)})`);
    assert.equal(typeof ex.title, 'string', `title must be a string (${ex.name})`);
    assert.ok(ex.title.length > 0, `title must be non-empty (${ex.name})`);
    assert.equal(typeof ex.source, 'string', `source must be a string (${ex.name})`);
    assert.ok(ex.source.length > 0, `source must be non-empty (${ex.name})`);
    // Every scene declares the SDL version it was authored against.
    assert.match(ex.source, /#version 3\.8;/, `source missing #version (${ex.name})`);

    // category is exactly one canonical CATEGORIES key.
    assert.ok(
      keys.has(ex.category),
      `category '${ex.category}' is not a CATEGORIES key (${ex.name})`
    );

    // tags: non-empty array of non-empty strings (filter fuel, never empty).
    assert.ok(
      Array.isArray(ex.tags) && ex.tags.length > 0,
      `tags must be a non-empty array (${ex.name})`
    );
    for (const t of ex.tags) {
      assert.ok(
        typeof t === 'string' && t.length > 0,
        `every tag must be a non-empty string (${ex.name})`
      );
    }

    // description: non-empty, sentence-cased (leads uppercase), no trailing
    // period, <= 100 chars.
    assert.equal(typeof ex.description, 'string', `description must be a string (${ex.name})`);
    assert.ok(ex.description.length > 0, `description must be non-empty (${ex.name})`);
    assert.ok(ex.description.length <= 100, `description must be <= 100 chars (${ex.name})`);
    assert.ok(!ex.description.endsWith('.'), `description must not end with a period (${ex.name})`);
    assert.match(ex.description, /^[A-Z]/, `description must be sentence case (${ex.name})`);
    assert.ok(
      difficultyKeys.has(ex.difficulty),
      `difficulty '${ex.difficulty}' is not a DIFFICULTIES key (${ex.name})`
    );
    assert.ok(
      renderTierKeys.has(ex.renderTier),
      `renderTier '${ex.renderTier}' is not a RENDER_TIERS key (${ex.name})`
    );
    assert.equal(
      ex.thumbnail,
      `example-thumbnails/${ex.name}.png`,
      `thumbnail path must be canonical (${ex.name})`
    );

    // author non-empty; sourceUrl is '' or an https URL; license is on the list.
    assert.ok(
      typeof ex.author === 'string' && ex.author.length > 0,
      `author must be non-empty (${ex.name})`
    );
    assert.equal(typeof ex.sourceUrl, 'string', `sourceUrl must be a string (${ex.name})`);
    assert.ok(
      ex.sourceUrl === '' || ex.sourceUrl.startsWith('https://'),
      `sourceUrl must be '' or an https:// URL (${ex.name})`
    );
    assert.ok(
      LICENSE_ALLOW.has(ex.license),
      `license '${ex.license}' not in the SPDX allow-list (${ex.name})`
    );

    // animated is a boolean; the frames/fps shape is gated on it.
    assert.equal(typeof ex.animated, 'boolean', `animated must be a boolean (${ex.name})`);
    if (ex.animated) {
      assert.ok(
        Number.isInteger(ex.frames) && ex.frames >= 1 && ex.frames <= 240,
        `animated scene frames must be an integer 1..240 (${ex.name})`
      );
      assert.ok(
        Number.isInteger(ex.fps) && ex.fps >= 1 && ex.fps <= 60,
        `animated scene fps must be an integer 1..60 (${ex.name})`
      );
    } else {
      assert.equal(ex.frames, null, `still scene frames must be null (${ex.name})`);
      assert.equal(ex.fps, null, `still scene fps must be null (${ex.name})`);
    }
  }
});

test('scene names are unique', () => {
  const names = EXAMPLES.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'duplicate scene name(s)');
});

test('csg-die leads (the UI default first impression)', () => {
  assert.equal(EXAMPLES[0].name, 'csg-die');
});

test('featured examples are a curated ordered subset of the full catalog', () => {
  assert.ok(Array.isArray(FEATURED_EXAMPLE_NAMES), 'featured names must be an array');
  assert.ok(FEATURED_EXAMPLE_NAMES.length > 0, 'featured names must not be empty');
  assert.equal(
    new Set(FEATURED_EXAMPLE_NAMES).size,
    FEATURED_EXAMPLE_NAMES.length,
    'featured names must be unique'
  );
  assert.deepEqual(
    FEATURED_EXAMPLES.map((ex) => ex.name),
    FEATURED_EXAMPLE_NAMES,
    'FEATURED_EXAMPLES must preserve FEATURED_EXAMPLE_NAMES order'
  );
  for (const ex of FEATURED_EXAMPLES) {
    assert.equal(getExampleRecord(ex.name), ex, `featured record ${ex.name} must be in EXAMPLES`);
    assert.equal(ex.featured, true, `featured record ${ex.name} must carry featured:true`);
  }
  for (const ex of EXAMPLES) {
    assert.equal(
      ex.featured,
      FEATURED_EXAMPLE_NAMES.includes(ex.name),
      `featured flag mismatch (${ex.name})`
    );
  }
});

test('CATEGORIES keys are unique and each homes at least one scene', () => {
  const keys = CATEGORIES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate category key(s)');
  for (const c of CATEGORIES) {
    assert.equal(typeof c.label, 'string', `category label must be a string (${c.key})`);
    assert.ok(c.label.length > 0, `category label must be non-empty (${c.key})`);
    const members = EXAMPLES.filter((e) => e.category === c.key);
    assert.ok(
      members.length >= 1,
      `category '${c.key}' has no scenes (the UI builds an empty group head)`
    );
  }
});

test('featured categories keep the compact dropdown useful', () => {
  for (const c of CATEGORIES) {
    const members = FEATURED_EXAMPLES.filter((e) => e.category === c.key);
    assert.ok(members.length >= 1, `category '${c.key}' has no featured scenes`);
  }
});

test('metadata taxonomies are unique and fully represented', () => {
  assert.equal(
    new Set(DIFFICULTIES.map((d) => d.key)).size,
    DIFFICULTIES.length,
    'duplicate difficulty key(s)'
  );
  assert.equal(
    new Set(RENDER_TIERS.map((t) => t.key)).size,
    RENDER_TIERS.length,
    'duplicate render tier key(s)'
  );

  for (const d of DIFFICULTIES) {
    assert.ok(
      EXAMPLES.some((e) => e.difficulty === d.key),
      `difficulty '${d.key}' is unused`
    );
  }
  for (const t of RENDER_TIERS) {
    assert.ok(
      EXAMPLES.some((e) => e.renderTier === t.key),
      `render tier '${t.key}' is unused`
    );
    assert.equal(typeof t.quality, 'string', `render tier quality must be a string (${t.key})`);
    assert.ok(t.quality.length > 0, `render tier quality must be non-empty (${t.key})`);
    assert.ok(
      Number(t.quality) >= 7,
      `automatic render tier '${t.key}' must default to q7 or higher`
    );
  }
});

test('groupAllByCategory mirrors CATEGORIES order and partitions every scene', () => {
  const groups = groupAllByCategory();
  assert.deepEqual(
    groups.map((g) => g.key),
    CATEGORIES.map((c) => c.key),
    'groups must be in CATEGORIES order'
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    CATEGORIES.map((c) => c.label),
    'group labels must mirror CATEGORIES'
  );
  // Sum of group sizes equals the library size: nothing misfiled or dropped.
  const sum = groups.reduce((acc, g) => acc + g.items.length, 0);
  assert.equal(sum, EXAMPLES.length, 'group items must partition EXAMPLES exactly');
});

test('groupByCategory mirrors CATEGORIES order and partitions featured scenes', () => {
  const groups = groupByCategory();
  assert.deepEqual(
    groups.map((g) => g.key),
    CATEGORIES.map((c) => c.key),
    'featured groups must be in CATEGORIES order'
  );
  assert.deepEqual(
    groups.map((g) => g.label),
    CATEGORIES.map((c) => c.label),
    'featured group labels must mirror CATEGORIES'
  );
  const sum = groups.reduce((acc, g) => acc + g.items.length, 0);
  assert.equal(
    sum,
    FEATURED_EXAMPLES.length,
    'featured group items must partition featured scenes'
  );
});

test('getExample returns the matching source for every known name', () => {
  for (const ex of EXAMPLES) {
    assert.equal(getExample(ex.name), ex.source, `getExample('${ex.name}') mismatch`);
  }
});

test('getExample returns undefined for an unknown name (?.source short-circuit)', () => {
  assert.equal(getExample('does-not-exist'), undefined);
  // Non-string inputs miss the strict === match too, exercising the same branch.
  assert.equal(getExample(undefined), undefined);
  assert.equal(getExample(''), undefined);
});

test('getExampleRecord returns the full record for known names, undefined otherwise', () => {
  for (const ex of EXAMPLES) {
    assert.equal(getExampleRecord(ex.name), ex, `getExampleRecord('${ex.name}') mismatch`);
  }
  assert.equal(getExampleRecord('does-not-exist'), undefined);
  assert.equal(getExampleRecord(undefined), undefined);
});
