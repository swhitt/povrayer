import { createLiveDraftController } from './live-draft.js';
import type { DraftResult } from './live-draft.js';
import type { NotReadyReason } from './sdl-validate.js';

export const DRAFT_MAX_QUALITY = 5;
export const DRAFT_MAX_THREADS = 4;

/**
 * The cheap render settings one draft runs with: the concrete shape behind
 * live-draft's `Options` parameter, pinned here because this is where they are
 * built. `antialias` is always false and the size is capped, which is the whole
 * point of a draft.
 */
export interface DraftOptions {
  width: number;
  height: number;
  quality: number;
  threads: number;
  antialias: boolean;
  files?: Record<string, string | Uint8Array>;
}

/** The full-render controls plus the draft caps, as read off the page. */
export interface DraftInput {
  width: number;
  height: number;
  quality?: number;
  threads?: number;
  maxEdge: number;
  hardwareConcurrency: number;
  files?: Record<string, string | Uint8Array>;
}

/**
 * Build the deliberately cheap options used by live preview without mutating
 * the full-render controls.
 */
export function buildDraftOptions(input: DraftInput): DraftOptions {
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
 */
export function previewingStatus(width: number, height: number): string {
  return `previewing… ${width}×${height}`;
}

export function previewReadyStatus(width: number, height: number): string {
  return `preview ready · ${width}×${height}`;
}

/**
 * Whether the auto-preview may run, and the parked-status line when it may not.
 * A union rather than three loose fields: `reason` and `status` are present
 * exactly when `ready` is false, which is what lets onPreviewParked take the
 * whole gate object without re-checking either.
 */
export type PreviewGate = { ready: true; reason: null; status: null } | PreviewParked;

/** The parked half of a PreviewGate, which is all the page's hook needs. */
export interface PreviewParked {
  ready: false;
  reason: NotReadyReason;
  status: string;
}

/**
 * Stated as a type predicate rather than testing `!gate.ready` at the call site,
 * because this module is checked at BOTH tiers and they disagree about that test.
 * tsconfig.checkjs.json runs without strictNullChecks, and in that mode
 * TypeScript will not narrow a union discriminated by a BOOLEAN literal (the
 * `true`/`false` types widen), so `!gate.ready` leaves the whole union in hand.
 * Asserting it once here is what keeps the union, which is worth having: it is why
 * `reason` and `status` are non-null for the page's hook without a re-check.
 */
const isParked = (gate: PreviewGate): gate is PreviewParked => !gate.ready;

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
 * @param reason a validateScene() reason (null when ready)
 */
export function previewGate(reason: NotReadyReason | null): PreviewGate {
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

export function renderDoneStatus(
  elapsedMs: number,
  options: { width: number; height: number },
  frameCount: number | null = null
): string {
  const base = `done in ${(elapsedMs / 1000).toFixed(2)}s · ${options.width}×${options.height}`;
  return frameCount === null ? base : `${base} · ${frameCount} frames`;
}

/** Which mode the page is in, which decides whether drafting applies at all. */
export type RenderMode = 'still' | 'animate';

/**
 * Where requestExplicitRender() says the click should go. 'still' and 'animate'
 * are the two real render paths; the other three are dead ends the caller has to
 * handle (a draft is being torn down first, something is already running, or the
 * page is not cross-origin isolated yet).
 */
export type ExplicitRoute = RenderMode | 'deferred' | 'busy' | 'unisolated';

export interface RenderOrchestratorHooks<Options> {
  mode: () => RenderMode;
  liveEnabled: () => boolean;
  isolated: () => boolean;
  readSource: () => string;
  canAutoDraft: (source: string) => boolean;
  validateSource: (source: string) => { ready: boolean; reason: NotReadyReason | null };
  onPreviewParked: (parked: PreviewParked) => void;
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

/**
 * Compose the low-level live-draft scheduler with page-level policy: whether a
 * source may auto-preview and where an explicit render should route. DOM work
 * stays in injected presentation hooks.
 */
export function createRenderOrchestrator<Options>(hooks: RenderOrchestratorHooks<Options>) {
  const draft = createLiveDraftController({
    enabled: () => hooks.mode() === 'still' && hooks.liveEnabled() && hooks.isolated(),
    readSource: hooks.readSource,
    // Readiness is also where the page learns WHY a preview isn't coming: the
    // scheduler only wants a boolean, so the reason is reported out through
    // onPreviewParked instead of being dropped on the floor.
    sourceReady: (source) => {
      if (!hooks.canAutoDraft(source)) return false;
      const gate = previewGate(hooks.validateSource(source).reason);
      if (isParked(gate)) {
        hooks.onPreviewParked(gate);
        return false;
      }
      return true;
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

  function schedule({ sourceChanged = false }: { sourceChanged?: boolean } = {}) {
    if (!hooks.canAutoDraft(hooks.readSource())) {
      draft.cancel();
      return false;
    }
    if (sourceChanged) draft.sourceChanged();
    else draft.schedule();
    return true;
  }

  function requestExplicitRender(): ExplicitRoute {
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
