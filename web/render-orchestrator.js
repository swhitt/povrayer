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

/**
 * The draft's IN-FLIGHT line. Separate from previewReadyStatus because the
 * onStart and onSuccess hooks used to call the identical helper, so "preview
 * ready" was printed the instant a draft STARTED: measured 1,650ms of "preview
 * ready" sitting next to a running spinner with the PREVIOUS scene in the plate.
 * @param {number} width
 * @param {number} height
 */
export function previewingStatus(width, height) {
  return `previewing… ${width}×${height}`;
}

/**
 * @param {number} width
 * @param {number} height
 */
export function previewReadyStatus(width, height) {
  return `preview ready · ${width}×${height}`;
}

/**
 * @typedef {{ ready: true, reason: null, status: null }
 *   | { ready: false, reason: string, status: string }} PreviewGate
 */

/**
 * Preview-path policy for a validateScene() reason: may the auto-preview run,
 * and if not, what does the footer say while it stays parked? The page used to
 * throw the reason away, so a buffer the pre-check rejected produced no preview,
 * no error, and no status change: the plate just kept narrating a scene that was
 * no longer in the editor.
 *
 * 'no-version' is deliberately NOT a blocker. It is the one validateScene code
 * that is neither a mid-edit signal nor something POV-Ray rejects (clicking
 * Render on a version-less scene succeeds, POV-Ray only warns and assumes an
 * older language version), and sdl-validate's stated bias is toward ALLOWING
 * renders. Parking on it would make the live preview and the Render button
 * disagree about what is renderable, which is what left version-less scenes
 * sitting in silence.
 *
 * @param {string | null} reason a validateScene() reason (null when ready)
 * @returns {PreviewGate}
 */
export function previewGate(reason) {
  switch (reason) {
    // Wording is deliberately uniform: what stopped, then the mid-edit thing to
    // finish. The dim 'draft' status state carries the "this is preview chatter,
    // not a render verdict" styling.
    case 'empty':
      return { ready: false, reason, status: 'preview paused · empty scene' };
    case 'unbalanced':
      return { ready: false, reason, status: 'preview paused · unbalanced { } ( ) [ ]' };
    case 'unterminated-comment':
      return { ready: false, reason, status: 'preview paused · unterminated comment' };
    case 'unterminated-string':
      return { ready: false, reason, status: 'preview paused · unterminated string' };
    default:
      return { ready: true, reason: null, status: null };
  }
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
 * @property {(source: string) => { ready: boolean, reason: string | null }} validateSource
 * @property {(parked: { reason: string, status: string }) => void} onPreviewParked
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
    // Readiness is also where the page learns WHY a preview isn't coming: the
    // scheduler only wants a boolean, so the reason is reported out through
    // onPreviewParked instead of being dropped on the floor.
    sourceReady: (source) => {
      if (!hooks.canAutoDraft(source)) return false;
      const gate = previewGate(hooks.validateSource(source).reason);
      if (!gate.ready) hooks.onPreviewParked(gate);
      return gate.ready;
    },
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
