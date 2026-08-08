// SPDX id -> the gallery's license filter bucket. The bucket name is what the
// two <select>s in index.html print, so it has to be TRUE of every license in
// it: CC-BY carries no share-alike obligation, and MIT/Apache/BSD carry neither,
// so the single 'share-alike' bucket these used to share was a factual claim
// about other people's licenses that the cards underneath it (which print the
// real SPDX id) openly contradicted. Attribution-only and share-alike are now
// separate buckets, which is also the distinction a reuser actually filters on.
//
// The 4.0 CC ids and the three permissive ids are a forward-looking allowlist
// (test/node/examples.test.mjs pins the same set): nothing in EXAMPLES ships
// under them yet, which is why 'permissive' is deliberately NOT offered as a
// filter option. Adding the first such example means adding that option.
const LICENSE_BUCKET = {
  'CC0-1.0': 'cc0',
  'CC-BY-3.0': 'cc-by',
  'CC-BY-4.0': 'cc-by',
  'CC-BY-SA-3.0': 'cc-by-sa',
  'CC-BY-SA-4.0': 'cc-by-sa',
  MIT: 'permissive',
  'Apache-2.0': 'permissive',
  'BSD-3-Clause': 'permissive',
  'GPL-3.0-or-later': 'gpl',
};

export function licenseBucket(license) {
  return LICENSE_BUCKET[license] ?? 'other';
}

export function exampleSearchText(
  ex,
  { categoryLabel = '', difficultyLabel = '', tierLabel = '' } = {}
) {
  return [
    ex.name,
    ex.title,
    ex.description,
    ex.author,
    ex.license,
    ex.difficulty,
    difficultyLabel,
    ex.renderTier,
    tierLabel,
    categoryLabel,
    ...ex.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function matchesExampleFilters(
  ex,
  { type = 'all', difficulty = 'all', tier = 'all', license = 'all' } = {}
) {
  const typeMatch = type === 'all' || (type === 'animated' ? ex.animated : !ex.animated);
  return (
    typeMatch &&
    (difficulty === 'all' || ex.difficulty === difficulty) &&
    (tier === 'all' || ex.renderTier === tier) &&
    (license === 'all' || licenseBucket(ex.license) === license)
  );
}
