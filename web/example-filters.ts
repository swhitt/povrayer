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
const LICENSE_BUCKET: Readonly<Record<string, string | undefined>> = {
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

// The two interfaces below are structural SUBSETS of an EXAMPLES record
// (web/examples.js), and deliberately separate ones: examples.js is a 2.4k-line
// pure-data module that stays JavaScript, so naming only the fields each function
// reads keeps the contract narrow, lets a scene record grow fields without
// dragging the filters along, and lets a caller (or a test) hand over just the
// slice that is under test. `difficulty` and `renderTier` are optional because
// examples.js merges them in from EXAMPLE_META by name, so an unlisted scene has
// neither; both `undefined` paths are already handled ('all' matches anything,
// and the search haystack filters falsy entries out).

/** What exampleSearchText folds into its haystack. */
export interface SearchableExample {
  name: string;
  title: string;
  description: string;
  author: string;
  license: string;
  difficulty?: string;
  renderTier?: string;
  tags: readonly string[];
}

/** What matchesExampleFilters compares the four filter selections against. */
export interface FilterableExample {
  license: string;
  difficulty?: string;
  renderTier?: string;
  animated: boolean;
}

/** Optional label text folded into the search haystack alongside the record. */
export interface SearchLabels {
  categoryLabel?: string;
  difficultyLabel?: string;
  tierLabel?: string;
}

/** The four gallery/picker filter selections, each 'all' when unset. */
export interface ExampleFilters {
  type?: string;
  difficulty?: string;
  tier?: string;
  license?: string;
}

export function licenseBucket(license: string): string {
  return LICENSE_BUCKET[license] ?? 'other';
}

export function exampleSearchText(
  ex: SearchableExample,
  { categoryLabel = '', difficultyLabel = '', tierLabel = '' }: SearchLabels = {}
): string {
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
  ex: FilterableExample,
  { type = 'all', difficulty = 'all', tier = 'all', license = 'all' }: ExampleFilters = {}
): boolean {
  const typeMatch = type === 'all' || (type === 'animated' ? ex.animated : !ex.animated);
  return (
    typeMatch &&
    (difficulty === 'all' || ex.difficulty === difficulty) &&
    (tier === 'all' || ex.renderTier === tier) &&
    (license === 'all' || licenseBucket(ex.license) === license)
  );
}
