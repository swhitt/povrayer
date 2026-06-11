const LICENSE_BUCKET = {
  'CC0-1.0': 'cc0',
  'CC-BY-3.0': 'share-alike',
  'CC-BY-4.0': 'share-alike',
  'CC-BY-SA-3.0': 'share-alike',
  'CC-BY-SA-4.0': 'share-alike',
  MIT: 'share-alike',
  'Apache-2.0': 'share-alike',
  'BSD-3-Clause': 'share-alike',
  'GPL-3.0-or-later': 'gpl',
};

export function licenseBucket(license) {
  return LICENSE_BUCKET[license] ?? 'other';
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
