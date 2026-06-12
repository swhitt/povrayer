const DRAFT_DEBOUNCE_MIN_MS = 250;
const DRAFT_DEBOUNCE_MAX_MS = 2000;
const DRAFT_DEBOUNCE_FACTOR = 0.75;

// A completed draft slower than this pauses auto-drafting: re-rendering a scene
// this heavy after every idle gap burns whole cores indefinitely without ever
// feeling live, so the user must ask for renders explicitly instead. The page
// is told through onAutoPause (so it can say why the preview stopped) and
// re-arms via resumeAuto(), on a scene replacement or when the user flips the
// live toggle back on. Deliberately well above the slowest draft a reasonable
// scene produces; only the truly pathological ones trip it.
const SLOW_DRAFT_PAUSE_MS = 20000;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @typedef {object} LiveDraftHooks
 * @property {() => boolean} enabled
 * @property {() => string} readSource
 * @property {(source: string) => boolean} sourceReady
 * @property {() => boolean} explicitInFlight
 * @property {() => boolean} renderBusy
 * @property {() => object} draftOptions
 * @property {(source: string, options: object, signal: AbortSignal) => Promise<{ elapsedMs: number, blobUrl?: string }>} renderDraft
 * @property {(source: string, options: object) => void} onStart
 * @property {(source: string, result: { elapsedMs: number, blobUrl?: string }, options: object) => void} onSuccess
 * @property {(source: string, err: unknown) => void} onError
 * @property {() => void} onSettled
 * @property {() => void} startFullRender
 * @property {(elapsedMs: number) => void} onAutoPause
 */

/**
 * Owns live-draft scheduling and the explicit-render handoff. The page supplies
 * rendering/presentation hooks; this module owns timers, AbortControllers,
 * coalescing, superseding, the "full render waits for draft abort" latch, and
 * the slow-draft auto-pause.
 *
 * @param {LiveDraftHooks} hooks
 */
export function createLiveDraftController(hooks) {
  let timer = null;
  let ctl = null;
  let draftingSource = '';
  let lastAttemptedSource = null;
  let lastDraftMs = 0;
  let pendingFull = false;
  let autoPaused = false;

  function debounceMs() {
    return clamp(lastDraftMs * DRAFT_DEBOUNCE_FACTOR, DRAFT_DEBOUNCE_MIN_MS, DRAFT_DEBOUNCE_MAX_MS);
  }

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (autoPaused || !hooks.enabled()) return;
    clearTimer();
    timer = setTimeout(fire, debounceMs());
  }

  function sourceChanged() {
    if (!hooks.enabled()) return;
    if (ctl) ctl.abort();
    schedule();
  }

  function fire() {
    timer = null;
    const source = hooks.readSource();
    if (autoPaused || !hooks.enabled()) return;
    if (source === lastAttemptedSource) return;
    if (!hooks.sourceReady(source)) return;
    if (hooks.explicitInFlight()) return;
    if (ctl) {
      if (source === draftingSource) return;
      ctl.abort();
      return;
    }
    if (hooks.renderBusy()) return;
    return run(source);
  }

  async function run(source) {
    ctl = new AbortController();
    const active = ctl;
    draftingSource = source;
    const options = hooks.draftOptions();
    hooks.onStart(source, options);
    try {
      const result = await hooks.renderDraft(source, options, active.signal);
      lastDraftMs = result.elapsedMs;
      lastAttemptedSource = source;
      hooks.onSuccess(source, result, options);
      if (lastDraftMs > SLOW_DRAFT_PAUSE_MS) {
        autoPaused = true;
        hooks.onAutoPause(lastDraftMs);
      }
    } catch (err) {
      if (!active.signal.aborted) {
        lastAttemptedSource = source;
        hooks.onError(source, err);
      }
    } finally {
      if (ctl === active) ctl = null;
      hooks.onSettled();
      if (pendingFull) {
        pendingFull = false;
        hooks.startFullRender();
      } else {
        schedule();
      }
    }
  }

  function requestFullRender() {
    clearTimer();
    if (!ctl) return false;
    pendingFull = true;
    ctl.abort();
    return true;
  }

  function cancel() {
    clearTimer();
    if (ctl) ctl.abort();
  }

  function markAttempted(source) {
    lastAttemptedSource = source;
  }

  function resetAttempted() {
    lastAttemptedSource = null;
  }

  function resumeAuto() {
    autoPaused = false;
  }

  function isDrafting() {
    return ctl !== null;
  }

  function probe() {
    return {
      pending: timer !== null,
      inFlight: ctl !== null,
      source: draftingSource,
      autoPaused,
    };
  }

  return {
    schedule,
    sourceChanged,
    fire,
    requestFullRender,
    cancel,
    markAttempted,
    resetAttempted,
    resumeAuto,
    isDrafting,
    probe,
  };
}
