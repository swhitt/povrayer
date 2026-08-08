import { exampleSearchText, matchesExampleFilters } from './example-filters.js';

export const GALLERY_BATCH_SIZE = 24;
const SCROLL_THRESHOLD = 320;

/**
 * One catalog record, as the gallery reads it. Taken from web/examples.js's own
 * Example typedef rather than restated, so a field that changes shape there is a
 * compile error here instead of an `undefined` in a card.
 */
export type GalleryExample = import('./examples.js').Example;

/** A CATEGORIES / DIFFICULTIES / RENDER_TIERS entry: the key and its UI label. */
export interface KeyedLabel {
  key: string;
  label: string;
}

export interface GalleryOptions {
  panel: HTMLElement;
  trigger: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  search: HTMLInputElement;
  type: HTMLSelectElement;
  difficulty: HTMLSelectElement;
  tier: HTMLSelectElement;
  license: HTMLSelectElement;
  clearButton: HTMLButtonElement;
  grid: HTMLElement;
  empty: HTMLElement;
  examples: readonly GalleryExample[];
  categories: readonly KeyedLabel[];
  difficulties: readonly KeyedLabel[];
  tiers: readonly KeyedLabel[];
  onSelect: (name: string) => void;
}

/** One record paired with the lowercased text the search box matches against. */
interface SearchableEntry {
  example: GalleryExample;
  haystack: string;
}

export function createGallery(options: GalleryOptions) {
  const {
    panel,
    trigger,
    closeButton,
    search,
    type,
    difficulty,
    tier,
    license,
    clearButton,
    grid,
    empty,
    examples,
    categories,
    difficulties,
    tiers,
    onSelect,
  } = options;

  // Asserted, not guarded: every record's category/difficulty/renderTier is one
  // of the keys in the matching list (test/node/examples.test.mjs pins that), so
  // the lookup cannot miss. A `?? ''` here would be an unreachable branch the
  // 100% gate would then owe a test for, and it would print a blank chip if it
  // ever did run, which is worse than failing loudly.
  const labelByKey = (items: readonly KeyedLabel[], key: string) =>
    (items.find((item) => item.key === key) as KeyedLabel).label;
  const searchable = examples.map((example) => ({
    example,
    haystack: exampleSearchText(example, {
      categoryLabel: labelByKey(categories, example.category),
      difficultyLabel: labelByKey(difficulties, example.difficulty),
      tierLabel: labelByKey(tiers, example.renderTier),
    }),
  }));

  let matches: SearchableEntry[] = [];
  let cards: HTMLElement[] = [];
  let rendered = 0;
  let built = false;
  let selectedName = '';

  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'gallery-more';
  moreButton.textContent = 'Load more examples';

  function hasFilters() {
    return (
      search.value.trim() !== '' ||
      type.value !== 'all' ||
      difficulty.value !== 'all' ||
      tier.value !== 'all' ||
      license.value !== 'all'
    );
  }

  function matchesFilters(example: GalleryExample) {
    return matchesExampleFilters(example, {
      type: type.value,
      difficulty: difficulty.value,
      tier: tier.value,
      license: license.value,
    });
  }

  function markLoaded(card: HTMLElement, loaded: boolean) {
    if (loaded) {
      card.dataset.loaded = 'true';
      card.setAttribute('aria-current', 'true');
    } else {
      delete card.dataset.loaded;
      card.removeAttribute('aria-current');
    }
  }

  function createCard(entry: SearchableEntry, position: number) {
    const { example } = entry;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card';
    card.dataset.name = example.name;
    card.setAttribute('aria-posinset', String(position + 1));
    card.setAttribute('aria-setsize', String(matches.length));
    markLoaded(card, example.name === selectedName);

    const img = document.createElement('img');
    img.src = example.thumbnail;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 160;
    img.height = 120;

    const body = document.createElement('span');
    const titleEl = document.createElement('span');
    titleEl.className = 'gallery-title';
    titleEl.textContent = example.title;
    const meta = document.createElement('span');
    meta.className = 'gallery-meta';
    meta.textContent = [
      labelByKey(categories, example.category),
      labelByKey(difficulties, example.difficulty),
      labelByKey(tiers, example.renderTier),
      example.animated ? 'Animated' : 'Still',
    ].join(' · ');
    const licenseEl = document.createElement('span');
    licenseEl.className = 'gallery-license';
    licenseEl.textContent = `${example.license} · ${example.author}`;
    body.append(titleEl, meta, licenseEl);
    card.append(img, body);
    return card;
  }

  function appendBatch() {
    if (rendered >= matches.length) return;
    moreButton.remove();
    const fragment = document.createDocumentFragment();
    const end = Math.min(rendered + GALLERY_BATCH_SIZE, matches.length);
    for (let index = rendered; index < end; index += 1) {
      const card = createCard(matches[index], index);
      cards.push(card);
      fragment.appendChild(card);
    }
    rendered = end;
    grid.appendChild(fragment);
    if (rendered < matches.length) grid.appendChild(moreButton);
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    clearButton.hidden = !hasFilters();
    matches = searchable.filter(
      ({ example, haystack }) =>
        (query === '' || haystack.includes(query)) && matchesFilters(example)
    );
    const selectedIndex = matches.findIndex(({ example }) => example.name === selectedName);
    if (selectedIndex > 0) {
      // splice(i, 1) at a found index always yields exactly one entry, so the
      // destructured element is asserted rather than checked.
      const [selected] = matches.splice(selectedIndex, 1) as [SearchableEntry];
      matches.unshift(selected);
    }
    empty.hidden = matches.length !== 0;
    cards = [];
    rendered = 0;
    grid.replaceChildren();
    grid.scrollTop = 0;
    appendBatch();
    built = true;
  }

  function resetFilters() {
    search.value = '';
    type.value = 'all';
    difficulty.value = 'all';
    tier.value = 'all';
    license.value = 'all';
  }

  /**
   * Show the gallery, optionally seeded with a search carried in from elsewhere.
   * The picker's empty state uses that: it holds a curated subset, so a query
   * naming a gallery-only scene has to hand off here WITH the query rather than
   * report that a scene the app ships does not exist.
   *
   * @param query replaces the gallery's own filters when non-empty
   */
  function open(query = '') {
    if (query === '') {
      if (!built) render();
    } else {
      resetFilters();
      search.value = query;
      render();
    }
    panel.hidden = false;
    search.focus();
  }

  function close() {
    panel.hidden = true;
    trigger.focus();
  }

  function setSelected(name: string) {
    selectedName = name;
    for (const card of cards) markLoaded(card, card.dataset.name === name);
  }

  function handleFilter() {
    render();
  }

  search.addEventListener('input', handleFilter);
  for (const filter of [type, difficulty, tier, license]) {
    filter.addEventListener('change', handleFilter);
  }
  clearButton.addEventListener('click', () => {
    resetFilters();
    render();
    search.focus();
  });
  closeButton.addEventListener('click', close);
  moreButton.addEventListener('click', appendBatch);
  grid.addEventListener('scroll', () => {
    const remaining = grid.scrollHeight - grid.clientHeight - grid.scrollTop;
    if (remaining <= SCROLL_THRESHOLD) appendBatch();
  });
  grid.addEventListener('click', (event) => {
    // A click inside the grid always originates on an element; the spec's wider
    // EventTarget is for the synthetic cases that never reach a DOM listener.
    const target = event.target as Element;
    const card = target.closest<HTMLElement>('.gallery-card');
    if (!card) return;
    // Every card is built by createCard, which always sets data-name.
    onSelect(card.dataset.name as string);
    close();
  });

  return { open, close, setSelected };
}
