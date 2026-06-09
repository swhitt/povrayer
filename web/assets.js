// Drag-and-drop asset import: the pure helpers behind dropping files onto the
// editor. classifyAsset decides what a dropped file becomes (an image_map, an
// #include, or a replacement scene); the rest build the SDL snippet to insert
// and keep registry names valid + unique. DOM-free, so it node-tests to 100%;
// ui.js owns the drop events, the in-memory byte registry, and the render-time
// FS injection (the wrapper already stages a `files` map at /work/<name>).

// Raster formats this build can actually read, mapped to the POV-Ray image_map
// bitmap-type keyword. The wasm build is configured --without-libtiff and
// --without-openexr, so tiff/exr are deliberately absent; png/jpeg come from the
// libpng/libjpeg emscripten ports, gif/tga/ppm/pgm are POV-Ray built-ins.
const IMAGE_TYPE = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  tga: 'tga',
  ppm: 'ppm',
  pgm: 'pgm',
};

/** Lowercased extension of a filename, or '' if it has none. */
function extOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * What a dropped file should become in the editor.
 *   'image'   -> staged in the FS + an image_map pigment snippet inserted
 *   'include' -> staged in the FS + an #include line inserted (.inc)
 *   'scene'   -> offered as a full scene replacement (.pov)
 *   'unknown' -> rejected (unsupported type)
 *
 * @param {string} filename
 * @returns {'image' | 'include' | 'scene' | 'unknown'}
 */
export function classifyAsset(filename) {
  const ext = extOf(filename);
  if (ext in IMAGE_TYPE) return 'image';
  if (ext === 'inc') return 'include';
  if (ext === 'pov') return 'scene';
  return 'unknown';
}

/**
 * The POV-Ray image_map bitmap-type keyword for an image filename, or null when
 * the extension isn't a supported raster type.
 *
 * @param {string} filename
 * @returns {string | null}
 */
export function imageType(filename) {
  return IMAGE_TYPE[extOf(filename)] ?? null;
}

/**
 * Reduce a dropped filename to a safe basename used identically as the FS path,
 * the registry key, AND the SDL string that references it. Strips any directory
 * part (browsers usually omit it, but a programmatic DataTransfer can include
 * one) and replaces the `"` and newlines that would otherwise break out of the
 * image_map string or the inserted `//` comment (which has no escape) and inject
 * arbitrary SDL. Spaces and other characters are kept (valid in a quoted POV-Ray
 * filename and in MEMFS); empty input falls back to 'asset'.
 *
 * @param {string} filename
 * @returns {string}
 */
export function safeName(filename) {
  const base = filename.split(/[\\/]/).pop();
  const cleaned = base.replace(/["\r\n]/g, '_').trim();
  return cleaned || 'asset';
}

/**
 * A valid, readable SDL identifier derived from a filename: the base name with
 * every non-ASCII-word character collapsed to `_` (POV-Ray identifiers are
 * ASCII, so a Unicode-preserving form would be invalid), prefixed `P_` so it
 * always starts with a letter and reads as the pigment it declares.
 * `my image.png` -> `P_my_image`.
 *
 * @param {string} filename
 * @returns {string}
 */
export function identForFile(filename) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const cleaned = base.replace(/\W+/g, '_').replace(/^_+|_+$/g, '');
  return 'P_' + (cleaned || 'asset');
}

/**
 * A name unique within `existing` (a Set/Map of taken names): returns `name` if
 * free, else inserts `-2`, `-3`, ... before the extension (`foo.png` ->
 * `foo-2.png`) so dropping two different files with the same name never clobbers.
 *
 * @param {string} name
 * @param {{ has: (k: string) => boolean }} existing
 * @returns {string}
 */
export function uniqueName(name, existing) {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (existing.has(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}

/**
 * The SDL text to insert for a staged asset. Images become a reusable pigment
 * declare (with a one-line usage hint); includes become an `#include`. Returns
 * '' for kinds that don't insert text (a scene replaces the buffer instead).
 *
 * @param {string} name  the registry filename (as referenced in the FS)
 * @param {'image' | 'include' | 'scene' | 'unknown'} kind
 * @returns {string}
 */
export function assetSnippet(name, kind) {
  if (kind === 'image') {
    const id = identForFile(name);
    return (
      `// dropped image ${name} (use as: texture { pigment { ${id} } })\n` +
      `#declare ${id} = pigment { image_map { ${imageType(name)} "${name}" } }\n`
    );
  }
  if (kind === 'include') {
    return `#include "${name}"\n`;
  }
  return '';
}
