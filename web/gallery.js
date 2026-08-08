import { exampleSearchText, matchesExampleFilters } from './example-filters.js';

export const GALLERY_BATCH_SIZE = 24;
const SCROLL_THRESHOLD = 320;

/** @typedef {typeof import('./examples.js').EXAMPLES[number]} GalleryExample */

/**
 * @typedef {object} GalleryOptions
 * @property {HTMLElement} panel
 * @property {HTMLButtonElement} trigger
 * @property {HTMLButtonElement} closeButton
 * @property {HTMLInputElement} search
 * @property {HTMLSelectElement} type
 * @property {HTMLSelectElement} difficulty
 * @property {HTMLSelectElement} tier
 * @property {HTMLSelectElement} license
 * @property {HTMLButtonElement} clearButton
 * @property {HTMLElement} grid
 * @property {HTMLElement} empty
 * @property {GalleryExample[]} examples
 * @property {Array<{key: string, label: string}>} categories
 * @property {Array<{key: string, label: string}>} difficulties
 * @property {Array<{key: string, label: string}>} tiers
 * @property {(name: string) => void} onSelect
 */

/** @param {GalleryOptions} options */
export function createGallery(options) {
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

  const labelByKey = (items, key) => items.find((item) => item.key === key).label;
  const searchable = examples.map((example) => ({
    example,
    haystack: exampleSearchText(example, {
      categoryLabel: labelByKey(categories, example.category),
      difficultyLabel: labelByKey(difficulties, example.difficulty),
      tierLabel: labelByKey(tiers, example.renderTier),
    }),
  }));

  /** @type {Array<{example: GalleryExample, haystack: string}>} */
  let matches = [];
  /** @type {HTMLElement[]} */
  let cards = [];
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

  function matchesFilters(example) {
    return matchesExampleFilters(example, {
      type: type.value,
      difficulty: difficulty.value,
      tier: tier.value,
      license: license.value,
    });
  }

  function markLoaded(card, loaded) {
    if (loaded) {
      card.dataset.loaded = 'true';
      card.setAttribute('aria-current', 'true');
    } else {
      delete card.dataset.loaded;
      card.removeAttribute('aria-current');
    }
  }

  function createCard(entry, position) {
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
      const [selected] = matches.splice(selectedIndex, 1);
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
   * @param {string} [query] replaces the gallery's own filters when non-empty
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

  function setSelected(name) {
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
    const target = /** @type {Element} */ (event.target);
    const card = /** @type {HTMLElement | null} */ (target.closest('.gallery-card'));
    if (!card) return;
    onSelect(card.dataset.name);
    close();
  });

  return { open, close, setSelected };
}
