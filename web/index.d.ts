// Type shim for the browser code's `./index.js` import.
//
// The deploy step bundles the built wrapper (dist/index.js) into the web root as
// `web/index.js`, so the page modules import it as `./index.js`. That file does
// not exist in the source tree (it only appears in the deployed layout), so this
// declaration mirrors the deployed module and hands the wrapper's real public
// types (render/renderAnimation/PovrayError/...) to checkJs. Runtime is
// unaffected: this is types-only.
export * from '../dist/index.js';
