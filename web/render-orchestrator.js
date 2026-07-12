import { createLiveDraftController } from './live-draft.js';

export const DRAFT_MAX_QUALITY = 5;
export const DRAFT_MAX_THREADS = 4;

/**
 * Build the deliberately cheap options used by live preview without mutating
 * the full-render controls.
 *
 * @param {{
 *   width: number,
 *   height: number,
 *   quality?: number,
 *   threads?: number,
 *   maxEdge: number,
 *   hardwareConcurrency: number,
 *   files?: Record<string, string | Uint8Array>
 * }} input
 */
export function buildDraftOptions(input) {
  const scale = Math.min(1, input.maxEdge / Math.max(input.width, input.height));
  return {
    width: Math.max(8, Math.round(input.width * scale)),
    height: Math.max(8, Math.round(input.height * scale)),
    quality: Math.min(input.quality ?? Infinity, DRAFT_MAX_QUALITY),
    threads: input.threads ?? Math.min(DRAFT_MAX_THREADS, input.hardwareConcurrency),
    antialias: false,
    files: input.files,
  };
}

export function previewReadyStatus(width, height) {
  return `preview ready · ${width}×${height}`;
}

/**
 * @param {number} elapsedMs
 * @param {{ width: number, height: number }} options
 * @param {number | null} [frameCount]
 */
export function renderDoneStatus(elapsedMs, options, frameCount = null) {
  const base = `done in ${(elapsedMs / 1000).toFixed(2)}s · ${options.width}×${options.height}`;
  return frameCount === null ? base : `${base} · ${frameCount} frames`;
}

/**
 * @typedef {object} RenderOrchestratorHooks
 * @property {() => 'still' | 'animate'} mode
 * @property {() => boolean} liveEnabled
 * @property {() => boolean} isolated
 * @property {() => string} readSource
 * @property {(source: string) => boolean} canAutoDraft
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
 * Compose the low-level live-draft scheduler with page-level policy: whether a
 * source may auto-preview and where an explicit render should route. DOM work
 * stays in injected presentation hooks.
 *
 * @param {RenderOrchestratorHooks} hooks
 */
export function createRenderOrchestrator(hooks) {
  const draft = createLiveDraftController({
    enabled: () => hooks.mode() === 'still' && hooks.liveEnabled() && hooks.isolated(),
    readSource: hooks.readSource,
    sourceReady: (source) => hooks.canAutoDraft(source) && hooks.sourceReady(source),
    explicitInFlight: hooks.explicitInFlight,
    renderBusy: hooks.renderBusy,
    draftOptions: hooks.draftOptions,
    renderDraft: hooks.renderDraft,
    onStart: hooks.onStart,
    onSuccess: hooks.onSuccess,
    onError: hooks.onError,
    onSettled: hooks.onSettled,
    startFullRender: hooks.startFullRender,
    onAutoPause: hooks.onAutoPause,
  });

  function schedule({ sourceChanged = false } = {}) {
    if (!hooks.canAutoDraft(hooks.readSource())) {
      draft.cancel();
      return false;
    }
    if (sourceChanged) draft.sourceChanged();
    else draft.schedule();
    return true;
  }

  function requestExplicitRender() {
    if (draft.requestFullRender()) return 'deferred';
    if (hooks.explicitInFlight() || hooks.renderBusy()) return 'busy';
    if (!hooks.isolated()) return 'unisolated';
    return hooks.mode();
  }

  return {
    schedule,
    requestExplicitRender,
    cancel: draft.cancel,
    fire: draft.fire,
    markAttempted: draft.markAttempted,
    resetAttempted: draft.resetAttempted,
    resumeAuto: draft.resumeAuto,
    isDrafting: draft.isDrafting,
    probe: draft.probe,
  };
}
