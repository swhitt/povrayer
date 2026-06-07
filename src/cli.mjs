#!/usr/bin/env node
// povrayer CLI: thin front-end over the wasm render() wrapper.
// Lives at /app/cli.mjs in the runtime image, next to the wrapper's index.js.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

const HELP = `Usage: povrayer <scene.pov | -> [options] [-- raw POV-Ray args...]

  <scene.pov>    scene file to render; '-' reads the scene source from stdin
  -w N           image width in pixels (default 800)
  -h N           image height in pixels (default 600)
  -o FILE        output PNG path; '-' writes the PNG bytes to stdout
                 (default: <scene>.png next to the scene, or '-' in stdin mode)
  -q N           render quality, 0..11
  -a [T]         enable antialiasing, with optional threshold T (e.g. -a 0.3)
  --threads N    number of render threads
  --help         show this help
  --             pass everything after verbatim to POV-Ray (+KFF, +UA, ...)

File mode stages every regular file in the scene's directory (non-recursive)
alongside the scene, so local .inc files and textures resolve. In stdin mode
there is no scene directory, so local includes cannot resolve; scenes that
need them must use file mode (with docker: mount the directory into /work).
The standard include library (colors.inc etc.) is always available.

All log output goes to stderr, so '-o -' keeps stdout clean for PNG bytes.
`;

function fail(msg) {
  process.stderr.write(`povrayer: ${msg} (try --help)\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { args: [] };
  let scene;
  let out;
  const num = (flag, value) => {
    const n = Number(value);
    if (value === undefined || value === '' || !Number.isFinite(n)) fail(`${flag} expects a number`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === '--') {
      options.args.push(...argv.slice(i + 1));
      break;
    } else if (arg === '-w') {
      options.width = num('-w', argv[++i]);
    } else if (arg === '-h') {
      options.height = num('-h', argv[++i]);
    } else if (arg === '-o') {
      out = argv[++i];
      if (out === undefined) fail('-o expects a path');
    } else if (arg === '-q') {
      options.quality = num('-q', argv[++i]);
    } else if (arg === '--threads') {
      options.threads = num('--threads', argv[++i]);
    } else if (arg === '-a') {
      // Optional threshold: consume the next token only if it parses as a number.
      const next = argv[i + 1];
      options.antialias =
        next !== undefined && next !== '' && Number.isFinite(Number(next)) ? Number(argv[++i]) : true;
    } else if (scene === undefined && (arg === '-' || !arg.startsWith('-'))) {
      scene = arg;
    } else {
      fail(`unknown option: ${arg}`);
    }
  }
  if (scene === undefined) fail('no scene given');
  return { scene, out, options };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Every regular file in the scene's directory (non-recursive) rides along so
// local .inc/texture assets resolve inside the renderer's in-memory FS.
function stageSceneDir(scenePath) {
  const dir = dirname(scenePath);
  const files = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) files[entry.name] = readFileSync(join(dir, entry.name));
  }
  return files;
}

const { scene, out, options } = parseArgs(process.argv.slice(2));

let source;
let outPath;
if (scene === '-') {
  source = await readStdin();
  outPath = out ?? '-';
} else {
  try {
    source = readFileSync(scene, 'utf8');
    options.files = stageSceneDir(scene);
  } catch (err) {
    fail(err.message);
  }
  outPath = out ?? join(dirname(scene), basename(scene, extname(scene)) + '.png');
}

options.onProgress = (line) => process.stderr.write(line + '\n');

// Imported lazily so --help and usage errors never pay for wasm setup.
const { render } = await import('./index.js');

try {
  const png = await render(source, options);
  if (outPath === '-') {
    process.stdout.write(png);
  } else {
    writeFileSync(outPath, png);
    process.stderr.write(`povrayer: wrote ${outPath}\n`);
  }
} catch (err) {
  // The full log already streamed to stderr via onProgress; keep this short.
  if (typeof err?.exitCode === 'number' && err.exitCode !== 0) {
    process.exitCode = err.exitCode;
    process.stderr.write(`povrayer: render failed (exit code ${err.exitCode})\n`);
  } else {
    process.exitCode = 1;
    process.stderr.write(`povrayer: ${err?.message ?? err}\n`);
  }
}
