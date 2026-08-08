// Drag-and-drop asset import, extracted from ui.js. Drop an image on the editor
// and it's staged into the render filesystem (the wrapper writes the `files` map
// to /work/<name>) with an image_map pigment declare inserted at the caret; drop a
// .inc to stage + #include it; drop a .pov to replace the scene. Assets are
// session-only (raw bytes, not part of the permalink) and shown as removable chips
// so it's always clear what's loaded.
//
// This module owns the staged-asset registry, the chips, the skip note, and the
// editor-wrap drag listeners. The two editor mutations (snippet insertion + scene
// replace) are injected so the single-source-of-truth editor stays owned by ui.js.
import { classifyAsset, assetSnippet, safeName, uniqueName } from './assets.js';

/**
 * Scan POV-Ray source for string literals that can name staged files. Comments
 * are skipped, block comments nest like POV-Ray's, and a non-literal #include
 * is reported so callers can fall back to staging everything rather than break
 * an include assembled through a variable/concat expression.
 *
 * @param {string} source
 * @returns {{ strings: string[], dynamicInclude: boolean }}
 */
function scanFileReferences(source) {
  const strings = [];
  let dynamicInclude = false;
  let i = 0;
  let blockDepth = 0;
  while (i < source.length) {
    if (blockDepth > 0) {
      if (source.startsWith('/*', i)) {
        blockDepth++;
        i += 2;
      } else if (source.startsWith('*/', i)) {
        blockDepth--;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (source.startsWith('//', i)) {
      const nl = source.indexOf('\n', i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      let value = '';
      i++;
      while (i < source.length && source[i] !== '"' && source[i] !== '\n') {
        if (source[i] === '\\' && i + 1 < source.length) i++;
        value += source[i++];
      }
      if (source[i] === '"') i++;
      strings.push(value);
      continue;
    }
    if (source[i] === '#') {
      const directive = /^#\s*include\b/i.exec(source.slice(i));
      if (directive) {
        let j = i + directive[0].length;
        while (/\s/.test(source[j] ?? '')) j++;
        if (source[j] !== '"') dynamicInclude = true;
      }
    }
    i++;
  }
  return { strings, dynamicInclude };
}

/** Normalize the harmless leading ./ form POV accepts for /work-relative files. */
function referenceName(value) {
  return value.replace(/^(?:\.\/)+/, '');
}

/**
 * Select only staged files referenced by the scene, following dropped text
 * includes transitively. A dynamic #include expression is deliberately
 * conservative and returns the whole registry: static analysis cannot know
 * which staged include it will choose at render time.
 *
 * @param {string} source
 * @param {ReadonlyMap<string, string | Uint8Array>} registry
 * @returns {Record<string, string | Uint8Array> | undefined}
 */
export function referencedAssetFiles(source, registry) {
  if (registry.size === 0) return undefined;
  const selected = new Map();
  const pending = [source];

  while (pending.length > 0) {
    const text = pending.pop();
    const { strings, dynamicInclude } = scanFileReferences(text);
    if (dynamicInclude) return Object.fromEntries(registry);
    for (const literal of strings) {
      const name = referenceName(literal);
      if (!registry.has(name) || selected.has(name)) continue;
      const data = registry.get(name);
      selected.set(name, data);
      if (typeof data === 'string') pending.push(data);
    }
  }

  return selected.size > 0 ? Object.fromEntries(selected) : undefined;
}

/**
 * The image files `source` references that are NOT staged: the drops a reload
 * lost. referencedAssetFiles cannot answer this, in two ways: it early-returns
 * on an empty registry, which is exactly the boot condition, and it returns the
 * referenced INTERSECTION rather than the complement.
 *
 * Scoped to image references on purpose. A blanket "referenced but not staged"
 * scan false-positives across most of the shipped catalog, which #includes
 * colors.inc / woods.inc / textures.inc / stones.inc / metals.inc / golds.inc /
 * glass.inc out of the wasm build's own include path (colors.inc alone appears in
 * 27 scenes). Text includes are not blanket-skipped by EXTENSION though, because
 * a staged colors.inc override deliberately wins over the stdlib copy; they are
 * skipped because a missing one still resolves, so its absence is not a failure
 * this scan could warn about. A missing image is: nothing else can supply it.
 *
 * @param {string} source
 * @param {ReadonlyMap<string, string | Uint8Array>} registry
 * @returns {string[]} the missing image names, in first-reference order
 */
export function missingImageReferences(source, registry) {
  const missing = [];
  for (const literal of scanFileReferences(source).strings) {
    const name = referenceName(literal);
    if (classifyAsset(name) !== 'image') continue;
    if (registry.has(name) || missing.includes(name)) continue;
    missing.push(name);
  }
  return missing;
}

/**
 * Self-queries its DOM contract from the page: #editor-wrap (drop target),
 * #asset-chips + #assets (the staged-asset strip), and #asset-note (skip feedback).
 * @param {{ insertSnippet: (text: string) => void, replaceScene: (text: string) => void }} hooks
 */
export function createAssetDrop({ insertSnippet, replaceScene }) {
  const editorWrap = document.getElementById('editor-wrap');
  const assetChips = document.getElementById('asset-chips');
  const assetsStrip = document.getElementById('assets');
  const assetNote = document.getElementById('asset-note');

  /** @type {Map<string, Uint8Array | string>} */
  const assetRegistry = new Map();
  const EMPTY_ASSET = new Uint8Array(0); // placeholder while a dropped file is being read

  // The referenced subset as the wrapper's `files` map. Text includes are
  // followed transitively; dynamic include expressions conservatively stage all.
  function assetFiles(source) {
    return referencedAssetFiles(source, assetRegistry);
  }

  // The images `source` references that this session has no bytes for. The
  // registry is memory-only, so the page asks on boot: the scene survives a
  // reload in localStorage, the dropped bytes never do.
  /** @param {string} source */
  function missingImages(source) {
    return missingImageReferences(source, assetRegistry);
  }

  function renderAssetChips() {
    assetChips.replaceChildren();
    for (const name of assetRegistry.keys()) {
      const chip = document.createElement('span');
      chip.className = 'asset-chip';
      const label = document.createElement('span');
      label.className = 'asset-name';
      label.textContent = name;
      chip.appendChild(label);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'asset-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `unload ${name}`);
      // Spell out that removal only unstages the bytes; the scene's snippet stays.
      remove.title = `Unload ${name} from the next render (its snippet stays in the scene)`;
      remove.addEventListener('click', () => {
        assetRegistry.delete(name);
        renderAssetChips();
      });
      chip.appendChild(remove);
      assetChips.appendChild(chip);
    }
    assetsStrip.hidden = assetRegistry.size === 0;
  }

  // Write the shared asset-status line, or clear it with ''. Exposed so the page
  // can post its own advisory (the boot "these images need re-dropping" note)
  // through the one element that owns this feedback; the strip has room for a
  // single message, so a later drop's skip report deliberately replaces it.
  /** @param {string} text */
  function showNote(text) {
    assetNote.textContent = text;
    assetNote.hidden = text === '';
  }

  // Report the files a drop couldn't import (unsupported type or unreadable), or
  // clear the note when the drop was fully clean.
  function showDropNote(skipped) {
    showNote(
      skipped.length > 0 ? `skipped (unsupported or unreadable): ${skipped.join(', ')}` : ''
    );
  }

  async function handleDrop(fileList) {
    const skipped = [];
    for (const file of fileList) {
      const kind = classifyAsset(file.name);
      if (kind === 'unknown') {
        skipped.push(file.name);
        continue;
      }
      if (kind === 'scene') {
        const text = await file.text();
        if (confirm(`Replace the scene with ${file.name}?`)) replaceScene(text);
        continue;
      }
      // Reserve the (sanitized, unique) name synchronously so a second drop racing
      // through here can't claim the same name before the async read finishes.
      const name = uniqueName(safeName(file.name), assetRegistry);
      assetRegistry.set(name, EMPTY_ASSET);
      let data;
      try {
        data = kind === 'image' ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      } catch {
        /* c8 ignore next 4 -- an in-memory dropped File doesn't reject on read in the harness; releases the reservation and reports */
        assetRegistry.delete(name);
        skipped.push(file.name);
        continue;
      }
      assetRegistry.set(name, data);
      insertSnippet(assetSnippet(name, kind));
      renderAssetChips();
    }
    showDropNote(skipped);
  }

  editorWrap.addEventListener('dragover', (e) => {
    e.preventDefault(); // allow the drop
    editorWrap.classList.add('drag-over');
  });
  editorWrap.addEventListener('dragleave', (e) => {
    // Ignore the dragleave fired when the pointer crosses onto a child (gutter,
    // overlay, textarea); only clear when the drag truly leaves the editor.
    if (!editorWrap.contains(/** @type {Node | null} */ (e.relatedTarget))) {
      editorWrap.classList.remove('drag-over');
    }
  });
  editorWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    editorWrap.classList.remove('drag-over');
    handleDrop(e.dataTransfer.files);
  });

  return { assetFiles, missingImages, showNote };
}
