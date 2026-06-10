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
 * @param {{ insertSnippet: (text: string) => void, replaceScene: (text: string) => void }} hooks
 * @returns {{ assetFiles: () => Record<string, Uint8Array | string> | undefined }}
 */
export function createAssetDrop({ insertSnippet, replaceScene }) {
  const editorWrap = document.getElementById('editor-wrap');
  const assetChips = document.getElementById('asset-chips');
  const assetsStrip = document.getElementById('assets');
  const assetNote = document.getElementById('asset-note');

  /** @type {Map<string, Uint8Array | string>} */
  const assetRegistry = new Map();
  const EMPTY_ASSET = new Uint8Array(0); // placeholder while a dropped file is being read

  // The staged assets as the wrapper's `files` map, or undefined when there are
  // none (so the render opts stay clean and the wrapper skips FS staging).
  function assetFiles() {
    return assetRegistry.size > 0 ? Object.fromEntries(assetRegistry) : undefined;
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

  // Report the files a drop couldn't import (unsupported type or unreadable), or
  // clear the note when the drop was fully clean.
  function showDropNote(skipped) {
    if (skipped.length > 0) {
      assetNote.textContent = `skipped (unsupported or unreadable): ${skipped.join(', ')}`;
      assetNote.hidden = false;
    } else {
      assetNote.hidden = true;
    }
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

  return { assetFiles };
}
