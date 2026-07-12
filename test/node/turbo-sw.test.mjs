// Service-worker behavior without a browser worker process: install/activate
// lifecycle promises and the scoped network-first fetch strategy run against a
// small fake ServiceWorkerGlobalScope. The production module remains side-effect
// driven, exactly as the browser loads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Turbo service worker installs assets, cleans old caches, and falls back offline', async () => {
  const listeners = new Map();
  const opened = [];
  const added = [];
  const deleted = [];
  const put = [];
  const matched = [];
  let skipWaiting = 0;
  let claimed = 0;
  let fetchMode = 'online';

  const cache = {
    async addAll(assets) {
      added.push(...assets);
    },
    async put(request, response) {
      put.push({ request, response });
    },
  };
  const fakeSelf = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    async skipWaiting() {
      skipWaiting++;
    },
    clients: {
      async claim() {
        claimed++;
      },
    },
  };
  const fakeCaches = {
    async open(name) {
      opened.push(name);
      return cache;
    },
    async keys() {
      return ['turbo-old', 'turbo-v1', 'unrelated'];
    },
    async delete(name) {
      deleted.push(name);
      return true;
    },
    async match(request, options) {
      matched.push({ request, options });
      return new Response('offline');
    },
  };

  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    self: { configurable: true, value: fakeSelf },
    caches: { configurable: true, value: fakeCaches },
    location: { configurable: true, value: new URL('https://povrayer.test/turbo') },
    fetch: {
      configurable: true,
      value: async () => {
        if (fetchMode === 'offline') throw new Error('offline');
        return new Response('online');
      },
    },
  });

  try {
    await import('../../web/turbo-sw.js');

    let installPromise;
    listeners.get('install')({
      waitUntil(value) {
        installPromise = value;
      },
    });
    await installPromise;
    assert.deepEqual(added, [
      '/turbo',
      '/turbo.webmanifest',
      '/turbo-icon-192.png',
      '/turbo-icon-512.png',
      '/turbo-apple-icon.png',
    ]);
    assert.equal(skipWaiting, 1);

    let activatePromise;
    listeners.get('activate')({
      waitUntil(value) {
        activatePromise = value;
      },
    });
    await activatePromise;
    assert.deepEqual(deleted, ['turbo-old']);
    assert.equal(claimed, 1);

    const dispatchFetch = (url) => {
      /** @type {Promise<Response> | undefined} */
      let response;
      const request = new Request(url);
      listeners.get('fetch')({
        request,
        respondWith(value) {
          response = value;
        },
      });
      return { request, response };
    };

    assert.equal(
      dispatchFetch('https://elsewhere.test/turbo').response,
      undefined,
      'cross-origin requests are outside the worker scope'
    );
    assert.equal(
      dispatchFetch('https://povrayer.test/index.html').response,
      undefined,
      'the main app is outside the Turbo cache scope'
    );

    const online = dispatchFetch('https://povrayer.test/turbo?scene=one');
    const onlineResponse = online.response;
    assert.ok(onlineResponse);
    assert.equal(await (await onlineResponse).text(), 'online');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(put.length, 1, 'a successful network response should refresh the cache');
    assert.equal(put[0].request, online.request);
    assert.equal(await put[0].response.text(), 'online');

    fetchMode = 'offline';
    const offline = dispatchFetch('https://povrayer.test/turbo?scene=two');
    const offlineResponse = offline.response;
    assert.ok(offlineResponse);
    assert.equal(await (await offlineResponse).text(), 'offline');
    assert.equal(matched.length, 1);
    assert.equal(matched[0].request, offline.request);
    assert.deepEqual(matched[0].options, { ignoreSearch: true });
    assert.ok(opened.every((name) => name === 'turbo-v1'));
  } finally {
    for (const key of ['self', 'caches', 'location', 'fetch']) {
      const descriptor = originals[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
