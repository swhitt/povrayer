import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlayer } from '../../web/player.js';

function stubElement() {
  const attrs = new Map();
  return {
    hidden: false,
    textContent: '',
    value: '0',
    max: '0',
    disabled: false,
    addEventListener() {},
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    querySelector() {
      return { remove() {} };
    },
  };
}

function playerHarness({ throwOnCanvasLabel = false } = {}) {
  const controls = stubElement();
  const scrubber = stubElement();
  const frameReadout = stubElement();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    setAttribute() {
      if (throwOnCanvasLabel && this.width > 0) throw new Error('canvas label failed');
    },
  };
  const player = createPlayer(
    /** @type {any} */ ({
      canvas,
      controls,
      playButton: stubElement(),
      scrubber,
      frameReadout,
      loopButton: stubElement(),
      exportButton: stubElement(),
      exportFormat: stubElement(),
    })
  );
  return { player, canvas, controls, scrubber, frameReadout };
}

function bitmap(id, closed) {
  return { width: 4, height: 3, close: () => closed.push(id) };
}

async function withBrowserStubs(run) {
  const oldWindow = globalThis.window;
  const oldMatchMedia = globalThis.matchMedia;
  const oldRevoke = URL.revokeObjectURL;
  const revoked = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url) => revoked.push(url),
  });
  try {
    await run(revoked);
  } finally {
    if (oldWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: oldWindow });
    if (oldMatchMedia === undefined) delete globalThis.matchMedia;
    else
      Object.defineProperty(globalThis, 'matchMedia', {
        configurable: true,
        value: oldMatchMedia,
      });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: oldRevoke });
  }
}

test('player destroy releases owned assets, canvas backing stores, and is idempotent', async () => {
  await withBrowserStubs((revoked) => {
    const closed = [];
    const { player, canvas, controls, scrubber, frameReadout } = playerHarness();
    player.load(
      {
        bitmaps: [bitmap('a', closed), bitmap('b', closed)],
        blobUrls: ['blob:a', 'blob:b'],
      },
      12
    );
    assert.deepEqual([canvas.width, canvas.height], [4, 3]);
    assert.equal(controls.hidden, false);

    player.destroy();
    player.destroy();
    assert.deepEqual(closed.sort(), ['a', 'b']);
    assert.deepEqual(revoked.sort(), ['blob:a', 'blob:b']);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
    assert.equal(controls.hidden, true);
    assert.deepEqual([scrubber.max, scrubber.value], ['0', '0']);
    assert.match(frameReadout.textContent, /^0 \/ 0/);
    assert.equal(player.hasFrames(), false);
  });
});

test('player rejects and disposes empty or mismatched playback assets', async () => {
  await withBrowserStubs((revoked) => {
    const closed = [];
    const { player } = playerHarness();
    assert.throws(
      () => player.load({ bitmaps: [], blobUrls: ['blob:orphan'] }, 12),
      /playback assets are incomplete/
    );
    assert.throws(
      () =>
        player.load(
          { bitmaps: [bitmap('only', closed)], blobUrls: ['blob:only', 'blob:extra'] },
          12
        ),
      /playback assets are incomplete/
    );
    assert.deepEqual(closed, ['only']);
    assert.deepEqual(revoked.sort(), ['blob:extra', 'blob:only', 'blob:orphan']);
  });
});

test('player setup failure releases assets after ownership transfers', async () => {
  await withBrowserStubs((revoked) => {
    const closed = [];
    const { player } = playerHarness({ throwOnCanvasLabel: true });
    assert.throws(
      () => player.load({ bitmaps: [bitmap('owned', closed)], blobUrls: ['blob:owned'] }, 12),
      /canvas label failed/
    );
    assert.deepEqual(closed, ['owned']);
    assert.deepEqual(revoked, ['blob:owned']);
    assert.equal(player.hasFrames(), false);
  });
});
