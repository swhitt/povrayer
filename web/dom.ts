// Typed lookups for elements the page markup always ships.
//
// Before TypeScript, every one of these carried its own
// `/** @type {HTMLButtonElement} */ (document.getElementById('render-btn'))`
// cast: the type lived at the call site, repeated, and had to be re-stated
// whenever a lookup moved. Collapsing them here puts the assertion in ONE place
// and lets every downstream use be non-null, which is what makes strictNullChecks
// affordable across DOM-heavy code at all.
//
// Scope today is small on purpose: web/asset-drop.ts is the only .ts module that
// queries the page. The ~115 lookups in web/ui.js and web/repl.js are the intended
// clients, and both are still JavaScript for a coverage reason spelled out in
// tsconfig.build.json, not a typing one. This module is where they land.
//
// These ASSERT rather than check, exactly as the casts they replace did. The ids
// are static text matched against markup that ships in the same commit
// (web/index.html, web/repl.html), so a miss is a typo, not a runtime condition:
// it cannot be recovered from, it is caught the first time the browser suite
// drives the page, and a throwing guard here would only buy an unreachable branch
// that the 100% coverage gate would then demand a test for. A lookup that can
// genuinely miss is not this helper's job: model it as `Element | null` at the
// call site and handle the null.

/**
 * `document.getElementById`, pinned to the element subtype the markup declares.
 * Defaults to HTMLElement so the common "just need .hidden / .classList" case
 * stays untyped at the call site.
 */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
