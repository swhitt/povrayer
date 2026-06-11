const DRAFT_DEBOUNCE_MIN_MS = 250;
const DRAFT_DEBOUNCE_MAX_MS = 2000;
const DRAFT_DEBOUNCE_FACTOR = 0.75;

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
 */

/**
 * Owns live-draft scheduling and the explicit-render handoff. The page supplies
 * rendering/presentation hooks; this module owns timers, AbortControllers,
 * coalescing, superseding, and the "full render waits for draft abort" latch.
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

  function debounceMs() {
    return clamp(lastDraftMs * DRAFT_DEBOUNCE_FACTOR, DRAFT_DEBOUNCE_MIN_MS, DRAFT_DEBOUNCE_MAX_MS);
  }

  function clearTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (!hooks.enabled()) return;
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
    if (!hooks.enabled()) return;
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

  function isDrafting() {
    return ctl !== null;
  }

  function probe() {
    return {
      pending: timer !== null,
      inFlight: ctl !== null,
      source: draftingSource,
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
    isDrafting,
    probe,
  };
}
