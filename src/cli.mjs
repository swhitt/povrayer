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
  --frames N     render N frames as a clock-driven animation instead of a
                 single image (writes numbered PNGs; see below)
  --clock-initial F  clock value at the first frame (default 0)
  --clock-final F    clock value at the final frame (default 1)
  --help         show this help
  --             pass everything after verbatim to POV-Ray (+KFF, +UA, ...)

File mode stages every regular file in the scene's directory (non-recursive)
alongside the scene, so local .inc files and textures resolve. In stdin mode
there is no scene directory, so local includes cannot resolve; scenes that
need them must use file mode (with docker: mount the directory into /work).
The standard include library (colors.inc etc.) is always available.

Animation (--frames): the scene's 'clock' identifier sweeps from --clock-initial
to --clock-final across the frames. Output PNGs are numbered from 1, zero-padded
to the width of the frame count. Naming follows -o:
  -o out.png       -> out01.png .. outNN.png  (number before the extension)
  -o 'frame###.png'-> frame001.png ..          (a run of '#' is the number slot)
  (no -o)          -> <scene>NN.png next to the scene, or frameNN.png in stdin mode
'-o -' is rejected with --frames: frames can't stream to stdout.

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
    if (value === undefined || value === '' || !Number.isFinite(n))
      fail(`${flag} expects a number`);
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
    } else if (arg === '--frames') {
      const n = num('--frames', argv[++i]);
      if (!Number.isInteger(n) || n < 1) fail('--frames expects an integer >= 1');
      options.frames = n;
    } else if (arg === '--clock-initial') {
      options.initialClock = num('--clock-initial', argv[++i]);
    } else if (arg === '--clock-final') {
      options.finalClock = num('--clock-final', argv[++i]);
    } else if (arg === '-a') {
      // Optional threshold: consume the next token only if it parses as a number.
      const next = argv[i + 1];
      options.antialias =
        next !== undefined && next !== '' && Number.isFinite(Number(next))
          ? Number(argv[++i])
          : true;
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

// Builds a frame -> output-path function for animation mode. Frame numbers
// start at 1 and zero-pad to the width of the frame count, matching the
// engine's out{NN}.png so on-disk names line up with frame numbers.
//   -o out.png        -> insert the number before the extension (out01.png)
//   -o 'frame###.png' -> replace the '#' run, padded to max(width, runLength)
//   (no -o)           -> name after the scene, or 'frame' in stdin mode
function buildFrameNamer(out, scene, frames) {
  const padWidth = String(frames).length;
  const pad = (k, width) => String(k).padStart(width, '0');
  if (out !== undefined) {
    const run = out.match(/#+/);
    if (run) {
      const width = Math.max(padWidth, run[0].length);
      return (k) => out.replace(/#+/, pad(k, width));
    }
    const ext = extname(out);
    const stem = out.slice(0, out.length - ext.length);
    return (k) => stem + pad(k, padWidth) + ext;
  }
  const base = scene === '-' ? 'frame' : join(dirname(scene), basename(scene, extname(scene)));
  return (k) => base + pad(k, padWidth) + '.png';
}

// Maps a thrown render error to a process exit code + a terse stderr line.
// The full log already streamed to stderr via onProgress, so keep this short.
function reportError(err) {
  if (typeof err?.exitCode === 'number' && err.exitCode !== 0) {
    process.exitCode = err.exitCode;
    process.stderr.write(`povrayer: render failed (exit code ${err.exitCode})\n`);
  } else {
    process.exitCode = 1;
    // The `?? err` fallback only fires for a thrown non-Error (no `.message`).
    // render()/renderAnimation() and writeFileSync() only ever throw
    // Error/PovrayError, so it is unreachable through the CLI.
    /* c8 ignore next -- defensive non-Error fallback, unreachable via the CLI */
    process.stderr.write(`povrayer: ${err?.message ?? err}\n`);
  }
}

const { scene, out, options } = parseArgs(process.argv.slice(2));

// '-o -' can't carry N frames, so reject it before doing any render work.
if (options.frames !== undefined && out === '-') {
  fail('cannot write animation frames to stdout');
}

let source;
if (scene === '-') {
  source = await readStdin();
} else {
  try {
    source = readFileSync(scene, 'utf8');
    options.files = stageSceneDir(scene);
  } catch (err) {
    fail(err.message);
  }
}

options.onProgress = (line) => process.stderr.write(line + '\n');

if (options.frames !== undefined) {
  const framePath = buildFrameNamer(out, scene, options.frames);
  // Imported lazily so --help and usage errors never pay for wasm setup.
  const { renderAnimation } = await import('./index.js');
  try {
    const pngs = await renderAnimation(source, options);
    for (let k = 1; k <= pngs.length; k++) writeFileSync(framePath(k), pngs[k - 1]);
    process.stderr.write(
      `povrayer: wrote ${pngs.length} frames (${framePath(1)} … ${framePath(pngs.length)})\n`
    );
  } catch (err) {
    reportError(err);
  }
} else {
  const outPath =
    out ?? (scene === '-' ? '-' : join(dirname(scene), basename(scene, extname(scene)) + '.png'));
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
    reportError(err);
  }
}
