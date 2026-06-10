// COOP/COEP static server for the browser tests and local dev. Serves the
// exported wasm bundle from ./dist, the UI/REPL pages from ./web, and this
// directory's harness files. Every response carries the cross-origin-
// isolation headers SharedArrayBuffer requires.
//
//   import { startServer } from './serve.mjs'   -> ephemeral port (CI)
//   node test/browser/serve.mjs                 -> port 8080, or $PORT (interactive debugging)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// dist/ first so /index.js and /povray.{mjs,wasm} win; web/ next so / serves the real UI
// page exactly as deployed on Pages; test/browser/ last for the test harness.
const ROOTS = [resolve(here, '../../dist'), resolve(here, '../../web'), resolve(here)];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript', // module workers refuse non-JS mime types
  '.wasm': 'application/wasm', // required for streaming compilation
  '.json': 'application/json',
  '.map': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.pov': 'text/plain; charset=utf-8',
};

async function handle(req, res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  for (const root of ROOTS) {
    const file = join(root, pathname);
    if (file !== root && !file.startsWith(root + sep)) break; // traversal attempt
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      });
      res.end(body);
      return;
    } catch {
      // not in this root; try the next one
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`not found: ${pathname}`);
}

export function startServer(port = 0) {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer((req, res) => {
      /* c8 ignore start -- defensive 500: handle() catches its own errors and always responds, so this net never fires */
      handle(req, res).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      /* c8 ignore stop -- end defensive 500 net */
    });
    server.once('error', rejectStart);
    server.listen(port, '127.0.0.1', () => {
      // A listening TCP server always reports an AddressInfo (never the string
      // form, which is for pipe/UDS servers), so .port is present.
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      const url = `http://127.0.0.1:${addr.port}/`;
      const close = () =>
        new Promise((resolveClose, rejectClose) => {
          server.closeIdleConnections();
          server.close((err) => (err ? rejectClose(err) : resolveClose()));
        });
      resolveStart({ url, close });
    });
  });
}

/* c8 ignore start -- CLI entrypoint guard: only runs via `node serve.mjs`, never under the import-based test suite */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer(Number(process.env.PORT) || 8080);
  console.log(`povrayer test server: ${url}`);
}
/* c8 ignore stop -- end CLI entrypoint guard */
