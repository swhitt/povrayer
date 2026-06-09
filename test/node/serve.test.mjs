// Node-side tests for the COOP/COEP static server (test/browser/serve.mjs).
// The browser suites only ever drive the happy path (root + a handful of
// assets), so these cover startServer's full surface: the cross-origin
// isolation headers, every MIME branch, the percent-escape 400, the
// traversal break, the octet-stream fallback, the 404, an explicit (non
// -default) port, and close() including the already-closed reject path.
//
// Everything runs in-process against startServer().url over fetch; no browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../browser/serve.mjs';

let server;

before(async () => {
  // No argument -> the default ephemeral port (server.listen(0)).
  server = await startServer();
});

after(async () => {
  await server.close();
});

const get = (path) => fetch(new URL(path, server.url));

test('startServer resolves to a loopback url on an ephemeral port', () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test('serves / as index.html with the isolation headers and html mime', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok((await res.text()).length > 0, 'index.html should not be empty');
});

test('maps each known extension to its content-type', async () => {
  // One representative file per MIME entry, picked from the served roots
  // (dist/, web/, test/browser/). The lookup itself is one object, so this is
  // belt-and-suspenders for the table; the branch that matters is the
  // octet-stream fallback below.
  /** @type {Array<[string, RegExp]>} */
  const cases = [
    ['/index.html', /^text\/html/], // web/index.html
    ['/styles.css', /^text\/css/], // web/styles.css
    ['/ui.js', /^text\/javascript/], // web/ui.js
    ['/povray.mjs', /^text\/javascript/], // dist/povray.mjs
    ['/povray.wasm', /^application\/wasm/], // dist/povray.wasm
    ['/package.json', /^application\/json/], // dist/package.json
    ['/harness.html', /^text\/html/], // test/browser/harness.html
  ];
  for (const [path, ct] of cases) {
    const res = await get(path);
    assert.equal(res.status, 200, `status for ${path}`);
    assert.match(res.headers.get('content-type'), ct, `content-type for ${path}`);
    await res.arrayBuffer(); // drain the body so the socket frees up
  }
});

test('falls back to octet-stream for an unknown extension', async () => {
  // dist/index.d.ts exists, but `.ts` is not in the MIME table -> the `??`.
  const res = await get('/index.d.ts');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  await res.arrayBuffer();
});

test('returns 400 on a malformed percent-escape', async () => {
  // `%E0%A4` is an incomplete UTF-8 sequence; decodeURIComponent throws.
  const res = await get('/%E0%A4');
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'bad request');
});

test('breaks out of the root scan and 404s on an encoded-slash traversal', async () => {
  // Decodes to /../../package.json, which escapes the first root (dist), so the
  // scan breaks instead of serving a file outside the served tree.
  const res = await get('/..%2f..%2fpackage.json');
  assert.equal(res.status, 404);
});

test('returns 404 for a path under no root', async () => {
  const res = await get('/definitely-not-here-xyz');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /^not found: \/definitely-not-here-xyz/);
});

test('honors an explicit (non-default) port', async () => {
  // Grab a free port from an ephemeral server, release it, then bind it
  // explicitly so we exercise startServer(port) with a real argument.
  const probe = await startServer(0);
  const port = Number(new URL(probe.url).port);
  await probe.close();

  const fixed = await startServer(port);
  try {
    assert.equal(Number(new URL(fixed.url).port), port);
  } finally {
    await fixed.close();
  }
});

test('close() rejects once the server is already closed', async () => {
  const s = await startServer();
  await s.close(); // resolveClose: the success path
  await assert.rejects(s.close(), { code: 'ERR_SERVER_NOT_RUNNING' }); // rejectClose
});
