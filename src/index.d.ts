// Type shim for the CLI's `./index.js` import.
//
// At runtime `src/index.js` is a gitignored symlink to the built wrapper
// (dist/index.js), created by tools/link-wrapper.mjs. checkJs would otherwise
// follow that symlink and try to type-check the emitted wrapper bundle (which
// imports the untyped ./povray.mjs glue). This declaration shadows the symlink
// for type resolution only, handing the CLI the wrapper's real public types.
export * from '../dist/index.js';
