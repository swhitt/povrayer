// Unit tests for web/coi.ts: the shared cross-origin-isolation retry helper
// used by both browser entry points.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureCrossOriginIsolation } from '../../_build/web/coi.js';

function fakeSession(initial = null) {
  const store = new Map();
  if (initial !== null) store.set('coi-retry', initial);
  return /** @type {Storage & { removed: string[], written: string[][] }} */ ({
    removed: [],
    written: [],
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
      this.written.push([key, value]);
    },
    removeItem(key) {
      store.delete(key);
      this.removed.push(key);
    },
  });
}

function fakeWarning() {
  return /** @type {HTMLElement} */ ({ hidden: true });
}

function fakeWorker() {
  return /** @type {ServiceWorker} */ ({});
}

test('isolated page clears the retry guard and stays quiet', () => {
  const warningEl = fakeWarning();
  const session = fakeSession('1');
  let reloads = 0;

  const ok = ensureCrossOriginIsolation({
    warningEl,
    isolated: true,
    session,
    serviceWorker: undefined,
    reload: () => reloads++,
  });

  assert.equal(ok, true);
  assert.equal(warningEl.hidden, true);
  assert.deepEqual(session.removed, ['coi-retry']);
  assert.deepEqual(session.written, []);
  assert.equal(reloads, 0);
});

test('controlled non-isolated page reloads once', () => {
  const warningEl = fakeWarning();
  const session = fakeSession();
  let reloads = 0;

  const ok = ensureCrossOriginIsolation({
    warningEl,
    isolated: false,
    session,
    serviceWorker: /** @type {ServiceWorkerContainer} */ ({ controller: fakeWorker() }),
    reload: () => reloads++,
  });

  assert.equal(ok, false);
  assert.equal(warningEl.hidden, false);
  assert.deepEqual(session.written, [['coi-retry', '1']]);
  assert.equal(reloads, 1);
});

test('controlled non-isolated page can use the default global reload hook', () => {
  const warningEl = fakeWarning();
  const session = fakeSession();
  let reloads = 0;
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { reload: () => reloads++ },
  });

  try {
    const ok = ensureCrossOriginIsolation({
      warningEl,
      isolated: false,
      session,
      serviceWorker: /** @type {ServiceWorkerContainer} */ ({ controller: fakeWorker() }),
    });

    assert.equal(ok, false);
    assert.equal(warningEl.hidden, false);
    assert.deepEqual(session.written, [['coi-retry', '1']]);
    assert.equal(reloads, 1);
  } finally {
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
    else delete globalThis.location;
  }
});

test('retry guard prevents reload loops', () => {
  const warningEl = fakeWarning();
  const session = fakeSession('1');
  let reloads = 0;

  ensureCrossOriginIsolation({
    warningEl,
    isolated: false,
    session,
    serviceWorker: /** @type {ServiceWorkerContainer} */ ({ controller: fakeWorker() }),
    reload: () => reloads++,
  });

  assert.equal(warningEl.hidden, false);
  assert.deepEqual(session.written, []);
  assert.equal(reloads, 0);
});

test('uncontrolled page waits for service-worker controllerchange', () => {
  const warningEl = fakeWarning();
  const session = fakeSession();
  /** @type {(() => void) | undefined} */
  let listener;
  let reloads = 0;

  ensureCrossOriginIsolation({
    warningEl,
    isolated: false,
    session,
    serviceWorker: /** @type {ServiceWorkerContainer} */ ({
      controller: null,
      addEventListener(type, cb) {
        assert.equal(type, 'controllerchange');
        listener = /** @type {() => void} */ (cb);
      },
    }),
    reload: () => reloads++,
  });

  assert.equal(warningEl.hidden, false);
  assert.equal(reloads, 0);
  assert.ok(listener);
  listener();
  listener();
  assert.deepEqual(session.written, [['coi-retry', '1']]);
  assert.equal(reloads, 1);
});

test('missing service worker still shows the isolation warning', () => {
  const warningEl = fakeWarning();

  const ok = ensureCrossOriginIsolation({
    warningEl,
    isolated: false,
    session: fakeSession(),
    serviceWorker: undefined,
    reload: () => assert.fail('reload should not be called'),
  });

  assert.equal(ok, false);
  assert.equal(warningEl.hidden, false);
});
