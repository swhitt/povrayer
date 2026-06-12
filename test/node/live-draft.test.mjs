// Unit tests for web/live-draft.js: the controller that owns live-preview
// coalescing, aborts, and explicit-render handoff.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLiveDraftController } from '../../web/live-draft.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const events = [];
  let source = 'sphere';
  const hooks = {
    enabled: () => true,
    readSource: () => source,
    sourceReady: () => true,
    explicitInFlight: () => false,
    renderBusy: () => false,
    draftOptions: () => ({ width: 64, height: 48 }),
    renderDraft: async () => ({ elapsedMs: 1, blobUrl: 'blob:test' }),
    onStart: (src, opts) => events.push(['start', src, opts.width, opts.height]),
    onSuccess: (src, result) => events.push(['success', src, result.elapsedMs]),
    onError: (src, err) => events.push(['error', src, err.message]),
    onSettled: () => events.push(['settled']),
    startFullRender: () => events.push(['full']),
    onAutoPause: (elapsedMs) => events.push(['autopause', elapsedMs]),
    ...overrides,
  };
  const controller = createLiveDraftController(hooks);
  return {
    controller,
    events,
    setSource(next) {
      source = next;
    },
  };
}

test('fire renders a ready source and records it as attempted', async () => {
  const h = harness();

  await h.controller.fire();
  await h.controller.fire();

  assert.deepEqual(h.events, [['start', 'sphere', 64, 48], ['success', 'sphere', 1], ['settled']]);
  assert.deepEqual(h.controller.probe(), {
    pending: false,
    inFlight: false,
    source: 'sphere',
    autoPaused: false,
  });
});

test('fire quietly skips disabled, unready, explicit-busy, and render-busy states', async () => {
  for (const overrides of [
    { enabled: () => false },
    { sourceReady: () => false },
    { explicitInFlight: () => true },
    { renderBusy: () => true },
  ]) {
    const h = harness(overrides);
    await h.controller.fire();
    assert.deepEqual(h.events, []);
  }
});

test('render errors are reported once and suppress retry loops for the same source', async () => {
  const h = harness({
    renderDraft: async () => {
      throw new Error('bad scene');
    },
  });

  await h.controller.fire();
  await h.controller.fire();

  assert.deepEqual(h.events, [
    ['start', 'sphere', 64, 48],
    ['error', 'sphere', 'bad scene'],
    ['settled'],
  ]);
});

test('requestFullRender aborts an in-flight draft and starts the full render after cleanup', async () => {
  const pending = deferred();
  /** @type {AbortSignal | null} */
  let signal;
  const h = harness({
    renderDraft: (_source, _options, s) => {
      signal = s;
      s.addEventListener('abort', () => pending.reject(new Error('aborted')), { once: true });
      return pending.promise;
    },
  });

  h.controller.fire();
  await tick();

  assert.equal(h.controller.isDrafting(), true);
  assert.equal(h.controller.requestFullRender(), true);
  assert.ok(signal);
  assert.equal(signal.aborted, true);
  await tick();

  assert.equal(h.controller.isDrafting(), false);
  assert.deepEqual(h.events, [['start', 'sphere', 64, 48], ['settled'], ['full']]);
});

test('cancel clears a pending schedule and aborts an active draft', async () => {
  const pending = deferred();
  let aborted = false;
  const h = harness({
    renderDraft: (_source, _options, signal) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          pending.reject(new Error('aborted'));
        },
        { once: true }
      );
      return pending.promise;
    },
  });

  h.controller.schedule();
  assert.equal(h.controller.probe().pending, true);
  h.controller.cancel();
  assert.equal(h.controller.probe().pending, false);

  h.controller.fire();
  await tick();
  h.controller.cancel();
  await tick();

  assert.equal(aborted, true);
  assert.equal(h.controller.isDrafting(), false);
});

test('sourceChanged aborts an active draft and schedules the next source', async () => {
  const pending = deferred();
  let aborted = false;
  const h = harness({
    renderDraft: (_source, _options, signal) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          pending.reject(new Error('aborted'));
        },
        { once: true }
      );
      return pending.promise;
    },
  });

  h.controller.fire();
  await tick();
  h.setSource('box');
  h.controller.sourceChanged();
  await tick();

  assert.equal(aborted, true);
  assert.equal(h.controller.isDrafting(), false);
  assert.equal(h.controller.probe().pending, true);
  h.controller.cancel();
});

test('fire never overlaps active drafts', async () => {
  const pending = deferred();
  let aborted = false;
  const h = harness({
    renderDraft: (_source, _options, signal) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          pending.reject(new Error('aborted'));
        },
        { once: true }
      );
      return pending.promise;
    },
  });

  h.controller.fire();
  await tick();
  h.controller.fire();
  assert.equal(aborted, false, 'same-source fire should keep the active draft');

  h.setSource('box');
  h.controller.fire();
  await tick();

  assert.equal(aborted, true, 'changed-source fire should abort the active draft');
  assert.deepEqual(h.events, [['start', 'sphere', 64, 48], ['settled']]);
});

test('a slow draft pauses auto scheduling until resumeAuto re-arms it', async () => {
  const h = harness({
    renderDraft: async () => ({ elapsedMs: 25000, blobUrl: 'blob:slow' }),
  });

  await h.controller.fire();

  // The slow draft still presented normally, then reported the pause; the
  // settle backstop's schedule() must NOT have re-armed the timer.
  assert.deepEqual(h.events, [
    ['start', 'sphere', 64, 48],
    ['success', 'sphere', 25000],
    ['autopause', 25000],
    ['settled'],
  ]);
  assert.equal(h.controller.probe().autoPaused, true);
  assert.equal(h.controller.probe().pending, false);

  // While paused, neither path may start (or even queue) another draft.
  h.setSource('box');
  h.controller.schedule();
  assert.equal(h.controller.probe().pending, false, 'schedule is inert while paused');
  await h.controller.fire();
  assert.equal(
    h.events.filter(([kind]) => kind === 'start').length,
    1,
    'fire is inert while paused'
  );

  // resumeAuto re-arms: the next fire drafts the new source normally (and,
  // being just as slow, trips the pause again).
  h.controller.resumeAuto();
  assert.equal(h.controller.probe().autoPaused, false);
  await h.controller.fire();
  assert.deepEqual(h.events.filter(([kind]) => kind === 'success').at(-1), [
    'success',
    'box',
    25000,
  ]);
  assert.equal(h.controller.probe().autoPaused, true);
});

test('resetAttempted lets an unchanged source render again', async () => {
  const h = harness();

  await h.controller.fire();
  h.controller.resetAttempted();
  await h.controller.fire();

  assert.deepEqual(
    h.events.filter(([kind]) => kind === 'success'),
    [
      ['success', 'sphere', 1],
      ['success', 'sphere', 1],
    ]
  );
});
