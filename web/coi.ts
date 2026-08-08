// Cross-origin-isolation boot helper shared by the editor and REPL pages.
// Emscripten pthreads require SharedArrayBuffer, so GitHub Pages gets COOP/COEP
// through coi-serviceworker.js. This helper owns the first-visit reload guard.

// Every collaborator is injectable so the whole helper node-tests without a
// browser: the tests hand it a fake Storage and ServiceWorkerContainer and assert
// on the reload callback instead of navigating.
interface CoiOptions {
  warningEl: HTMLElement;
  isolated?: boolean;
  session?: Storage;
  serviceWorker?: ServiceWorkerContainer;
  reload?: () => void;
}

/** @returns true when the page is already cross-origin isolated */
export function ensureCrossOriginIsolation({
  warningEl,
  isolated = globalThis.crossOriginIsolated,
  session = globalThis.sessionStorage,
  serviceWorker = globalThis.navigator?.serviceWorker,
  reload = () => globalThis.location.reload(),
}: CoiOptions): boolean {
  if (isolated) {
    session.removeItem('coi-retry');
    return true;
  }

  warningEl.hidden = false;

  const retry = () => {
    if (session.getItem('coi-retry')) return;
    session.setItem('coi-retry', '1');
    reload();
  };

  if (serviceWorker?.controller) retry();
  else serviceWorker?.addEventListener('controllerchange', retry);

  return false;
}
