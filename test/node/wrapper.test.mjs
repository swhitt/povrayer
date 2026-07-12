// Wrapper coverage tests for the render() API (dist/index.js, built from
// wrapper/src/index.ts). render.test.mjs covers the headline happy + parse-error
// paths; this file drives the remaining branches: the `files` staging machinery,
// onProgress (including a throwing callback), quality/antialias/locateFile option
// branches, every AbortSignal path, and the default-threads navigator fallback.
//
// Run via `node --test test/node/` against the ./dist artifact (`make dist`),
// deliberately WITHOUT --test-force-exit: a clean runner exit is part of what we
// verify (EXIT_RUNTIME=1 must reap the pthread workers).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { render, warmup, PovrayError } from '../../dist/index.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A render that exits non-zero (parse error) leaves process.exitCode set to
// POV-Ray's status: emscripten's exit() records it even though the wrapper's
// `quit: () => {}` keeps the host process alive. Left alone, that dirties the
// node:test runner's process exit code and it reports this file as failed even
// when every assertion passed. Reset after each test; node:test still applies
// exit 1 of its own accord if a test actually fails.
afterEach(() => {
  process.exitCode = 0;
});

const scene = await readFile(new URL('../fixtures/basic.pov', import.meta.url), 'utf8');

// A scene that fails to parse: lets us exercise the synchronous argv-building
// branches (quality, antialias) cheaply, since argv is assembled before
// callMain and POV-Ray bails almost immediately on the syntax error.
const BAD_SCENE = 'sphere {';

test('warmup preloads the factory without rendering and repeats share the cache', async () => {
  // Both calls must resolve (the second from the cached factory promise) and
  // neither may produce output or leave the runner hanging on stray workers.
  await warmup();
  await warmup();
});

test('stages extra files (flat + nested) and fires onProgress', async () => {
  // One render exercises a pile of branches at once:
  //  - files: a flat include, plus two files sharing a nested dir so
  //    mkdirParents both creates /work/textures and hits its already-exists
  //    catch on the second file.
  //  - onProgress that throws on its first call (the swallow-the-error catch)
  //    then succeeds (the normal path).
  //  - quality + locateFile + threads + args option branches.
  //  - a signal that never aborts (the signal-present side of throwIfAborted,
  //    addEventListener and removeEventListener).
  const seen = [];
  let throwOnce = true;
  const onProgress = (line) => {
    seen.push(line);
    if (throwOnce) {
      throwOnce = false;
      throw new Error('progress callback blew up (must be swallowed)');
    }
  };

  const controller = new AbortController();
  const png = await render(scene, {
    width: 64,
    height: 48,
    quality: 9,
    threads: 2,
    antialias: false,
    files: {
      'extra.inc': '// staged, unused by the scene\n',
      'textures/wood.inc': '// nested file\n',
      'textures/stone.inc': new Uint8Array([0x2f, 0x2f, 0x0a]), // "//\n" as bytes
    },
    args: ['+UA'],
    locateFile: (file, prefix) => prefix + file, // identity passthrough
    onProgress,
    signal: controller.signal,
  });

  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, 'PNG signature mismatch');
  assert.ok(seen.length > 0, 'onProgress never fired');
});

test('a files entry named scene.pov cannot clobber the rendered source', async () => {
  // Regression (staging order): the documented source is written to
  // /work/scene.pov LAST, after the `files` loop, so a `files` entry that
  // happens to be named scene.pov can never overwrite the scene being rendered.
  // Here the source is the valid fixture and the decoy entry is a parse-error
  // scene; if the decoy won, render() would reject with PovrayError instead of
  // producing a PNG.
  const png = await render(scene, {
    width: 64,
    height: 48,
    antialias: false,
    files: { 'scene.pov': 'sphere {' },
  });
  assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE, 'source must win over the files decoy');
});

test('rejects a files key that escapes /work', async () => {
  await assert.rejects(
    render(scene, { files: { '../escape.inc': 'nope' } }),
    /** @param {Error} err */ (err) => {
      assert.ok(!(err instanceof PovrayError), 'should be a plain staging Error, not PovrayError');
      assert.match(err.message, /Invalid extra-file path/);
      assert.match(err.message, /must be a relative path/);
      return true;
    }
  );
});

test('rejects a files key that is only dot/slash segments', async () => {
  await assert.rejects(
    render(scene, { files: { './/': 'nope' } }),
    /** @param {Error} err */ (err) => {
      assert.match(err.message, /Invalid extra-file path/);
      return true;
    }
  );
});

test('antialias: true appends +A0.3', async () => {
  // Argv is built before callMain, so a parse-error scene still walks the
  // antialias === true branch without paying for a full render.
  await assert.rejects(render(BAD_SCENE, { antialias: true }), (err) => {
    assert.ok(err instanceof PovrayError);
    assert.notEqual(err.exitCode, 0);
    return true;
  });
});

test('antialias: <number> appends +A{n}', async () => {
  await assert.rejects(render(BAD_SCENE, { antialias: 0.5 }), (err) => {
    assert.ok(err instanceof PovrayError);
    assert.notEqual(err.exitCode, 0);
    return true;
  });
});

test('numeric render options reject invalid values before engine work', async () => {
  /** @type {Array<[import('../../dist/index.js').RenderOptions, RegExp]>} */
  const invalid = [
    [{ width: 1.5 }, /width must be an integer/],
    [{ width: 0 }, /width must be an integer/],
    [{ width: 32769 }, /width must be an integer/],
    [{ height: 0 }, /height must be an integer/],
    [{ quality: -1 }, /quality must be an integer/],
    [{ quality: 12 }, /quality must be an integer/],
    [{ threads: 0 }, /threads must be an integer/],
    [{ threads: 33 }, /threads must be an integer/],
    [{ antialias: Number.NaN }, /antialias must be/],
    [{ antialias: -0.1 }, /antialias must be/],
    [{ antialias: 1.1 }, /antialias must be/],
  ];
  for (const [options, message] of invalid) {
    await assert.rejects(render(scene, options), message);
  }
});

test('a pre-aborted signal rejects before any work', async () => {
  // Aborted before render() is even called: the first throwIfAborted (before
  // loadFactory) rejects, so the factory is never instantiated.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    render(scene, { signal: controller.signal }),
    /** @param {Error} err */ (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

test('a signal aborted during instantiation rejects at the post-instantiation re-check', async () => {
  // Abort synchronously after the call: render() has already passed the first
  // throwIfAborted and is suspended awaiting the factory, so the SECOND
  // throwIfAborted (after instantiation, before the abort listener is wired) is
  // what rejects.
  const controller = new AbortController();
  const promise = render(scene, { signal: controller.signal });
  controller.abort();
  await assert.rejects(
    promise,
    /** @param {Error} err */ (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
});

test('aborting mid-render with an Error reason rejects with that exact error', async () => {
  // Defer the abort out of the print callback (setTimeout) so termination runs
  // on a clean event-loop tick; the 384x384 + AA render is slow enough that the
  // abort always wins the race against completion.
  const controller = new AbortController();
  const reason = new Error('cancelled by the user');
  let armed = false;
  const onProgress = () => {
    if (!armed) {
      armed = true;
      setTimeout(() => controller.abort(reason), 0);
    }
  };
  await assert.rejects(
    render(scene, {
      width: 384,
      height: 384,
      antialias: true,
      signal: controller.signal,
      onProgress,
    }),
    (err) => {
      assert.equal(err, reason, 'an Error abort reason must propagate verbatim');
      return true;
    }
  );
});

test('aborting mid-render with a non-Error reason synthesizes an AbortError', async () => {
  const controller = new AbortController();
  let armed = false;
  const onProgress = () => {
    if (!armed) {
      armed = true;
      setTimeout(() => controller.abort('just a string'), 0);
    }
  };
  await assert.rejects(
    render(scene, {
      width: 384,
      height: 384,
      antialias: true,
      signal: controller.signal,
      onProgress,
    }),
    /** @param {Error} err */ (err) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err.message, 'The render was aborted');
      return true;
    }
  );
});

test('defaultThreads falls back when navigator is unavailable', async () => {
  // Node 21+ exposes globalThis.navigator; drop it to walk the
  // navigator-undefined / `?? 4` fallback in defaultThreads. A parse-error
  // scene keeps this cheap, and threads is left unset so defaultThreads runs.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
  try {
    await assert.rejects(render(BAD_SCENE), (err) => {
      assert.ok(err instanceof PovrayError);
      return true;
    });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});
