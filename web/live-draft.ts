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

/**
 * What a completed draft reports back. `elapsedMs` drives the next debounce, and
 * `blobUrl` is the image the page swaps in. Both required: the only producer is
 * render-client's renderScene, whose result always carries a blob URL, and the
 * optional spelling this replaces meant the page had to re-check a value that is
 * the entire point of a successful draft.
 */
export interface DraftResult {
  elapsedMs: number;
  blobUrl: string;
}

/**
 * `Options` is a type PARAMETER, not a fixed shape, because this scheduler never
 * reads a field of it: whatever draftOptions() produces is handed straight to
 * renderDraft and back to onStart/onSuccess untouched. Making that a parameter
 * says exactly that, and it still ties the four hooks to ONE shape, so the page
 * cannot produce options of one kind and print dimensions off another. (The
 * JSDoc it replaces said `object`, which is how "preview ready 320×240" could
 * have been printed off any object at all.) web/render-orchestrator.ts pins the
 * concrete shape, since that is where the options are built.
 */
export interface LiveDraftHooks<Options> {
  enabled: () => boolean;
  readSource: () => string;
  sourceReady: (source: string) => boolean;
  explicitInFlight: () => boolean;
  renderBusy: () => boolean;
  draftOptions: () => Options;
  renderDraft: (source: string, options: Options, signal: AbortSignal) => Promise<DraftResult>;
  onStart: (source: string, options: Options) => void;
  onSuccess: (source: string, result: DraftResult, options: Options) => void;
  onError: (source: string, err: unknown) => void;
  onSettled: () => void;
  startFullRender: () => void;
  onAutoPause: (elapsedMs: number) => void;
}

/** The scheduler's internal state, as the browser suite's probe reads it. */
export interface LiveDraftProbe {
  pending: boolean;
  inFlight: boolean;
  source: string;
  autoPaused: boolean;
}

/**
 * Owns live-draft scheduling and the explicit-render handoff. The page supplies
 * rendering/presentation hooks; this module owns timers, AbortControllers,
 * coalescing, superseding, the "full render waits for draft abort" latch, and
 * the slow-draft auto-pause.
 */
export function createLiveDraftController<Options>(hooks: LiveDraftHooks<Options>) {
  // `undefined` rather than `null` for "no timer pending": that is the spelling
  // clearTimeout()/setTimeout() already use, so clearing needs no guard branch.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctl: AbortController | null = null;
  let draftingSource = '';
  let lastAttemptedSource: string | null = null;
  let lastDraftMs = 0;
  let pendingFull = false;
  let autoPaused = false;

  // The next debounce is a fraction of the LAST draft's cost, held inside the
  // min/max window: a scene that takes a second to preview waits longer between
  // keystrokes than a sphere does.
  function debounceMs() {
    const scaled = lastDraftMs * DRAFT_DEBOUNCE_FACTOR;
    return Math.min(DRAFT_DEBOUNCE_MAX_MS, Math.max(DRAFT_DEBOUNCE_MIN_MS, scaled));
  }

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
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
    timer = undefined;
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

  async function run(source: string) {
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

  function markAttempted(source: string) {
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

  function probe(): LiveDraftProbe {
    return {
      pending: timer !== undefined,
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
