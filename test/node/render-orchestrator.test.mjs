import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDraftOptions,
  createRenderOrchestrator,
  previewGate,
  previewReadyStatus,
  previewingStatus,
  renderDoneStatus,
} from '../../_build/web/render-orchestrator.js';

test('draft options cap size, quality, and default threads', () => {
  assert.deepEqual(
    buildDraftOptions({
      width: 1024,
      height: 512,
      maxEdge: 320,
      hardwareConcurrency: 12,
      files: { 'texture.png': new Uint8Array([1]) },
    }),
    {
      width: 320,
      height: 160,
      quality: 5,
      threads: 4,
      antialias: false,
      files: { 'texture.png': new Uint8Array([1]) },
    }
  );
});

test('draft options preserve smaller dimensions and explicit quality/threads', () => {
  assert.deepEqual(
    buildDraftOptions({
      width: 4,
      height: 6,
      quality: 3,
      threads: 2,
      maxEdge: 320,
      hardwareConcurrency: 1,
    }),
    { width: 8, height: 8, quality: 3, threads: 2, antialias: false, files: undefined }
  );
});

test('render status helpers keep preview, still, and animation wording consistent', () => {
  // In flight vs done have to be DIFFERENT lines: both hooks used to call
  // previewReadyStatus, so "preview ready" appeared the instant a draft started.
  assert.equal(previewingStatus(320, 240), 'previewing… 320×240');
  assert.equal(previewReadyStatus(320, 180), 'preview ready · 320×180');
  assert.equal(renderDoneStatus(923, { width: 512, height: 384 }), 'done in 0.92s · 512×384');
  assert.equal(
    renderDoneStatus(1840, { width: 256, height: 192 }, 12),
    'done in 1.84s · 256×192 · 12 frames'
  );
});

test('previewGate parks the preview on the mid-edit reasons and words each one', () => {
  assert.deepEqual(previewGate('empty'), {
    ready: false,
    reason: 'empty',
    status: 'preview paused · empty scene',
  });
  assert.deepEqual(previewGate('unbalanced'), {
    ready: false,
    reason: 'unbalanced',
    status: 'preview paused · unbalanced { } ( ) [ ]',
  });
  assert.deepEqual(previewGate('unterminated-comment'), {
    ready: false,
    reason: 'unterminated-comment',
    status: 'preview paused · unterminated comment',
  });
  assert.deepEqual(previewGate('unterminated-string'), {
    ready: false,
    reason: 'unterminated-string',
    status: 'preview paused · unterminated string',
  });
});

test('previewGate lets a ready scene, and a version-less one, through', () => {
  const through = { ready: true, reason: null, status: null };
  assert.deepEqual(previewGate(null), through);
  // POV-Ray only WARNS about a missing #version (clicking Render succeeds), so
  // parking the auto-preview on it would make the preview and the Render button
  // disagree about what is renderable.
  assert.deepEqual(previewGate('no-version'), through);
});

function harness(overrides = {}) {
  /** @type {'still' | 'animate'} */
  let mode = 'still';
  let source = 'sphere';
  let live = true;
  let isolated = true;
  let explicit = false;
  let busy = false;
  let auto = true;
  /** @type {{ ready: boolean, reason: import('../../_build/web/sdl-validate.js').NotReadyReason | null }} */
  let validation = { ready: true, reason: null };
  const events = [];
  const controller = createRenderOrchestrator({
    mode: () => mode,
    liveEnabled: () => live,
    isolated: () => isolated,
    readSource: () => source,
    canAutoDraft: () => auto,
    validateSource: () => validation,
    onPreviewParked: (parked) => events.push(`parked:${parked.reason}:${parked.status}`),
    explicitInFlight: () => explicit,
    renderBusy: () => busy,
    draftOptions: () => ({ width: 64, height: 48 }),
    renderDraft: async () => ({ elapsedMs: 1, blobUrl: 'blob:test' }),
    onStart: () => events.push('start'),
    onSuccess: () => events.push('success'),
    onError: () => events.push('error'),
    onSettled: () => events.push('settled'),
    startFullRender: () => events.push('full'),
    onAutoPause: () => events.push('paused'),
    ...overrides,
  });
  return {
    controller,
    events,
    setMode: (value) => (mode = value),
    setSource: (value) => (source = value),
    setLive: (value) => (live = value),
    setIsolated: (value) => (isolated = value),
    setExplicit: (value) => (explicit = value),
    setBusy: (value) => (busy = value),
    setAuto: (value) => (auto = value),
    setValidation: (value) => (validation = value),
  };
}

test('schedule owns auto-draft policy and distinguishes edits from idle scheduling', () => {
  const h = harness();
  assert.equal(h.controller.schedule(), true);
  assert.equal(h.controller.probe().pending, true);
  h.controller.cancel();

  assert.equal(h.controller.schedule({ sourceChanged: true }), true);
  assert.equal(h.controller.probe().pending, true);
  h.controller.cancel();

  h.setAuto(false);
  assert.equal(h.controller.schedule(), false);
  assert.equal(h.controller.probe().pending, false);
});

test('live drafting respects mode, toggle, isolation, readiness, and busy gates', async () => {
  const h = harness();
  h.setMode('animate');
  await h.controller.fire();
  h.setMode('still');
  h.setLive(false);
  await h.controller.fire();
  h.setLive(true);
  h.setIsolated(false);
  await h.controller.fire();
  h.setIsolated(true);
  h.setSource('box');
  await h.controller.fire();
  assert.deepEqual(h.events, ['start', 'success', 'settled']);
});

test('a parked preview reports the reason instead of quietly not drafting', async () => {
  const h = harness();
  // An animated example: auto-preview is off by policy, which is not a "your
  // buffer is broken" state, so nothing is reported.
  h.setAuto(false);
  await h.controller.fire();
  assert.deepEqual(h.events, []);

  h.setAuto(true);
  h.setValidation({ ready: false, reason: 'unbalanced' });
  h.setSource('box {');
  await h.controller.fire();
  assert.deepEqual(h.events, ['parked:unbalanced:preview paused · unbalanced { } ( ) [ ]']);

  // A version-less scene still previews (previewGate lets it through).
  h.setValidation({ ready: false, reason: 'no-version' });
  h.setSource('box {}');
  await h.controller.fire();
  assert.deepEqual(h.events.slice(1), ['start', 'success', 'settled']);
  h.controller.cancel();
});

test('explicit render routing reports every page-level route', () => {
  const h = harness();
  h.setExplicit(true);
  assert.equal(h.controller.requestExplicitRender(), 'busy');
  h.setExplicit(false);
  h.setBusy(true);
  assert.equal(h.controller.requestExplicitRender(), 'busy');
  h.setBusy(false);
  h.setIsolated(false);
  assert.equal(h.controller.requestExplicitRender(), 'unisolated');
  h.setIsolated(true);
  assert.equal(h.controller.requestExplicitRender(), 'still');
  h.setMode('animate');
  assert.equal(h.controller.requestExplicitRender(), 'animate');
});

test('an explicit request defers until an active draft settles', async () => {
  let release = /** @type {(value: { elapsedMs: number }) => void} */ (() => {});
  const pending = new Promise((resolve) => (release = resolve));
  const h = harness({ renderDraft: () => pending });
  h.controller.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.controller.requestExplicitRender(), 'deferred');
  release({ elapsedMs: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.events, ['start', 'success', 'settled', 'full']);
});
