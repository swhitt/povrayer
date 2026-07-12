/**
 * povrayer: POV-Ray 3.8 compiled to WebAssembly.
 *
 * The public API is {@link render} (one PNG) and {@link renderAnimation} (a
 * clock-driven sequence of PNGs). Both stage a scene into the module's
 * in-memory filesystem, run POV-Ray, and resolve with the PNG bytes.
 *
 * Browser requirements:
 * - The page must be cross-origin isolated (pthreads need SharedArrayBuffer):
 *   serve it with `Cross-Origin-Opener-Policy: same-origin` and
 *   `Cross-Origin-Embedder-Policy: require-corp`, and check
 *   `crossOriginIsolated === true` before calling {@link render}.
 * - `povray.mjs` and `povray.wasm` must be served as opaque static assets,
 *   never run through a bundler: the pthread worker is spawned via
 *   `new URL(import.meta.url)` and ignores `locateFile` (emscripten #22508).
 * - The default wasm build declares a 2 GB shared maximum, which Safari/iOS can
 *   instantiate. Chrome/Firefox treat the maximum as an address-space
 *   reservation, so a higher ceiling is free there; the published Node CLI
 *   image is linked with 4 GB (`--build-arg WASM_MAX_MEMORY=4GB`).
 */

export interface RenderOptions {
    /** Image width in pixels (`+W`), integer 1..32768. Default 800. */
    width?: number;
    /** Image height in pixels (`+H`), integer 1..32768. Default 600. */
    height?: number;
    /** Render quality (`+Q`), 0..11. Omitted unless set. */
    quality?: number;
    /**
     * Antialiasing: `false` (the default) disables it (`-A`); `true` enables
     * it with threshold 0.3 (`+A0.3`); a number enables it with that
     * threshold (`+A{n}`), from 0 to 1.
     */
    antialias?: boolean | number;
    /**
     * Worker thread count (`+WT`). Default: the environment's reported
     * hardware concurrency (falling back to 4), clamped to 1..32.
     */
    threads?: number;
    /**
     * Extra input files staged at `/work/<name>` before rendering, so the
     * scene can `#include` them or reference image maps. Nested relative
     * paths are fine (`"textures/wood.inc"`); `".."` segments are rejected.
     */
    files?: Record<string, string | Uint8Array>;
    /**
     * Raw POV-Ray args appended last (escape hatch: `+UA`, `+AM2`, ...).
     * Animation flags (`+KFI`/`+KFF`) belong on {@link renderAnimation}: passing
     * them here puts POV-Ray in animation mode, which writes numbered
     * `out<N>.png` frames that this single-file {@link render} can't collect.
     */
    args?: string[];
    /** Receives each output line (stdout + stderr) as it arrives. */
    onProgress?: (line: string) => void;
    /**
     * Cancels the render: terminates all wasm threads and rejects with an
     * `AbortError`. The module instance is discarded, so violent termination
     * is safe; the next render starts from a fresh instance.
     */
    signal?: AbortSignal;
    /**
     * Forwarded to the emscripten factory for locating `povray.wasm` when it
     * is served from a different path than `povray.mjs`.
     */
    locateFile?: (file: string, prefix: string) => string;
}

/** Thrown when POV-Ray exits non-zero or the wasm runtime aborts. */
export class PovrayError extends Error {
    /** POV-Ray's exit code (-1 if the wasm runtime aborted instead). */
    readonly exitCode: number;
    /** Full captured stdout + stderr. */
    readonly log: string;

    constructor(message: string, exitCode: number, log: string) {
        super(message);
        this.name = "PovrayError";
        this.exitCode = exitCode;
        this.log = log;
    }
}

// Internal types resolved from the adjacent povray.d.mts ambient declaration
// (the runtime .mjs does not exist at tsc time). None of these may appear in
// an exported signature: index.d.ts must stay self-contained.
type PovrayFactory = typeof import("./povray.mjs").default;
type PovrayModule = Awaited<ReturnType<PovrayFactory>>;
type PovrayFS = PovrayModule["FS"];

// The factory is cached for the module lifetime (the engine caches the
// compiled wasm bytes behind it), but every render() gets a fresh module
// instance: EXIT_RUNTIME=1 tears the instance down when main() returns, so
// FS contents, memory, and worker state never leak between renders. The
// instantiation cost (~100-300 ms) is noise against multi-second renders.
let factoryPromise: Promise<PovrayFactory> | undefined;

function loadFactory(): Promise<PovrayFactory> {
    // Identical code path in Node and the browser: both import the ES module
    // natively, and emscripten's internal environment switch picks
    // worker_threads vs Worker for the pthread pool.
    if (!factoryPromise) {
        const p = import("./povray.mjs").then((m) => m.default);
        // Cache only a *successful* factory. Clearing a rejected import lets the
        // next render() retry instead of replaying a stale transient failure;
        // the `=== p` guard keeps a late rejection of this attempt from
        // clobbering a newer in-flight one.
        /* c8 ignore next 3 -- a transient povray.mjs import failure can't be provoked deterministically */
        p.catch(() => {
            if (factoryPromise === p) factoryPromise = undefined;
        });
        factoryPromise = p;
    }
    return factoryPromise;
}

/**
 * Warms the renderer without rendering: loads (and caches) the wasm factory so
 * the first {@link render} skips the glue-module fetch+parse. Fire-and-forget
 * safe: it never starts a render and touches no state beyond the factory cache
 * {@link render} already uses, and repeat calls share the same cached load.
 */
export async function warmup(): Promise<void> {
    await loadFactory();
}

function defaultThreads(): number {
    // globalThis.navigator, NOT bare navigator: the bare identifier is a
    // ReferenceError on Node 20 (the global only exists on Node 21+).
    const hc = globalThis.navigator?.hardwareConcurrency ?? 4;
    return Math.min(32, Math.max(1, hc));
}

function assertIntegerOption(name: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
    }
}

/** Validate public numeric options before loading or instantiating the engine. */
function validateRenderOptions(
    width: number,
    height: number,
    quality: number | undefined,
    threads: number,
    antialias: boolean | number,
): void {
    assertIntegerOption("width", width, 1, 32768);
    assertIntegerOption("height", height, 1, 32768);
    if (quality !== undefined) assertIntegerOption("quality", quality, 0, 11);
    assertIntegerOption("threads", threads, 1, 32);
    if (
        typeof antialias === "number" &&
        (!Number.isFinite(antialias) || antialias < 0 || antialias > 1)
    ) {
        throw new RangeError("antialias must be false, true, or a finite threshold from 0 to 1");
    }
}

/** Maps a `files` key to its MEMFS path, rejecting escapes from /work. */
function stagedPath(name: string): string {
    const segments = name.split("/").filter((s) => s !== "" && s !== ".");
    if (segments.length === 0 || segments.includes("..")) {
        throw new Error(
            `Invalid extra-file path ${JSON.stringify(name)}: ` +
                `must be a relative path with no ".." segments`,
        );
    }
    return "/work/" + segments.join("/");
}

/** mkdir -p for every directory component above `filePath`. */
function mkdirParents(fs: PovrayFS, filePath: string): void {
    const segments = filePath.split("/").filter(Boolean);
    segments.pop(); // drop the file name itself
    let dir = "";
    for (const segment of segments) {
        dir += "/" + segment;
        try {
            fs.mkdir(dir);
        } catch {
            // already exists
        }
    }
}

function abortError(signal: AbortSignal | undefined): Error {
    const reason: unknown = signal?.reason;
    if (reason instanceof Error) return reason;
    const err = new Error("The render was aborted");
    err.name = "AbortError";
    return err;
}

// Maintainer note (heap views): never cache HEAPU8 or any other TypedArray
// view of wasm memory across calls. With ALLOW_MEMORY_GROWTH plus shared
// memory the underlying buffer is replaced on growth and stale views read
// garbage. This wrapper deliberately never touches HEAP* at all:
// FS.writeFile/FS.readFile plus the Uint8Array.from copies in the runEngine
// collect callbacks are the only data paths in or out of the instance.

/**
 * Runs the engine once and returns whatever `collect` extracts from the
 * resulting MEMFS. This is the shared core behind {@link render} and
 * {@link renderAnimation}: all the log capture, instantiation, abort/teardown,
 * and exit-code plumbing lives here exactly once.
 *
 * `extraArgs` is spliced into argv right after the antialias flag and before
 * the include path and caller `args`. With `extraArgs === []` the argv is
 * byte-identical to a plain still render, so {@link render} drives this with
 * the same behavior it always had.
 *
 * `collect` runs only on a clean exit (code 0) with the instance still alive,
 * inside the `try`, so it can read output PNGs out of FS before the `finally`
 * reaps the workers. Errors propagate from here: non-zero exit -> PovrayError,
 * aborted signal -> AbortError.
 */
async function runEngine<T>(
    source: string,
    options: RenderOptions,
    extraArgs: string[],
    collect: (fs: PovrayFS) => T,
): Promise<T> {
    const {
        width = 800,
        height = 600,
        quality,
        antialias = false,
        threads = defaultThreads(),
        files,
        args = [],
        onProgress,
        signal,
        locateFile,
    } = options;

    validateRenderOptions(width, height, quality, threads, antialias);
    signal?.throwIfAborted();

    const factory = await loadFactory();

    const logLines: string[] = [];

    let resolveExit!: (code: number) => void;
    let rejectExit!: (reason: Error) => void;
    const exited = new Promise<number>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
    });
    // The abort path can reject `exited` after the caller has already thrown
    // (e.g. a staging error); mark it observed so that never surfaces as an
    // unhandled rejection. The real `await exited` below still sees the state.
    exited.catch(() => {});

    const append = (line: string) => {
        logLines.push(line);
        if (onProgress) {
            try {
                onProgress(line);
            } catch {
                // A throwing progress callback must never corrupt the render:
                // print/printErr are invoked from emscripten's output plumbing.
            }
        }
        // An uncaught error in a pthread worker (e.g. a scene that overflows
        // a render thread's stack) reaches neither onExit nor onAbort:
        // emscripten's worker.onerror reports it through err() -- our
        // printErr -- with this fixed prefix, then rethrows synchronously
        // outside any promise chain. Detecting the report lets us reject
        // `exited` instead of leaving it pending forever.
        //
        // The clean PovrayError reject is a browser-effective guarantee: there
        // the synchronous rethrow lands in window.onerror, the realm survives,
        // and the queued rejection drains, so render() rejects cleanly. In Node
        // the rethrow escapes emscripten's `worker.on('error')` listener as an
        // uncaughtException, and with no process-level handler installed Node
        // tears the process down before the queued rejection is observed -- so a
        // Node consumer that needs to catch a pthread crash must install its own
        // `process.on('uncaughtException')` guard.
        /* c8 ignore next 3 -- emscripten only emits "worker sent an error!" on a real pthread crash, which can't be provoked deterministically in a test */
        if (line.startsWith("worker sent an error!")) {
            rejectExit(
                new PovrayError(`POV-Ray render thread crashed: ${line}`, -1, logLines.join("\n")),
            );
        }
    };

    const instance = await factory({
        print: append,
        printErr: append,
        // Completion signal. PROXY_TO_PTHREAD makes callMain return
        // immediately, so onExit (fired when EXIT_RUNTIME tears the runtime
        // down) is the ONLY reliable end-of-render event.
        onExit: (code) => resolveExit(code),
        /* c8 ignore next -- onAbort only fires on a wasm runtime abort (assertion/OOM); a normal render exits through onExit instead */
        onAbort: (what) =>
            rejectExit(
                new PovrayError(
                    `POV-Ray wasm runtime aborted: ${String(what)}`,
                    -1,
                    logLines.join("\n"),
                ),
            ),
        // Never let the module exit the host process.
        /* c8 ignore next -- deliberate no-op; with EXIT_RUNTIME the runtime ends via onExit, so the module never calls quit */
        quit: () => {},
        ...(locateFile ? { locateFile } : {}),
    });

    const onSignalAbort = () => {
        // Violent, by design: the instance is discarded after this render and
        // the next render gets a fresh one, so termination mid-render is safe.
        /* c8 ignore next 6 -- terminateAllThreads only throws once the runtime is already torn down; the live mid-render abort path always succeeds */
        try {
            instance.PThread.terminateAllThreads();
        } catch {
            // runtime already torn down
        }
        rejectExit(abortError(signal));
    };

    try {
        // Re-check now that the (asynchronous) instantiation is done; the
        // listener below won't fire for a signal that was already aborted.
        signal?.throwIfAborted();
        signal?.addEventListener("abort", onSignalAbort, { once: true });

        // FS staging runs on this JS thread; pthread FS syscalls are proxied
        // here, so this is safe under PROXY_TO_PTHREAD.
        const FS = instance.FS;
        FS.mkdir("/work");
        if (files) {
            for (const [name, data] of Object.entries(files)) {
                const path = stagedPath(name);
                mkdirParents(FS, path);
                FS.writeFile(path, data);
            }
        }
        // Staged LAST so the documented scene source always wins: a `files`
        // entry (or, in CLI file mode, a sibling literally named scene.pov in
        // the staged directory) can never clobber the source being rendered.
        // /work already exists from the mkdir above and a top-level
        // "scene.pov" has no parent dirs to create, so this ordering is safe.
        FS.writeFile("/work/scene.pov", source);

        const argv = [
            "+I/work/scene.pov",
            "+O/work/out.png",
            "+FN", // PNG output
            "-D", // no display
            "-P", // no pause
            `+W${width}`,
            `+H${height}`,
            `+WT${threads}`,
        ];
        if (quality !== undefined) argv.push(`+Q${quality}`);
        if (antialias === false) argv.push("-A");
        else if (antialias === true) argv.push("+A0.3");
        else argv.push(`+A${antialias}`);
        // Animation flags (+KFI/+KFF/+KI/+KF) go here, between the antialias
        // flag and the include path, so they precede any caller-supplied args.
        argv.push(...extraArgs);
        // /work first so a staged file resolves by bare name: POV-Ray searches
        // the library paths (NOT the input file's own directory) for `#include`
        // targets and image_map/height_field files, so without this a scene
        // referencing a staged `"wood.png"` fails to find it. Ahead of the stdlib
        // path so a deliberately staged override (e.g. a custom colors.inc) wins.
        argv.push("+L/work");
        // Explicit even though the compiled-in POVLIBDIR fallback covers it.
        argv.push("+L/usr/share/povray-3.8/include");
        argv.push(...args);

        instance.callMain(argv);
        const exitCode = await exited;

        if (exitCode !== 0) {
            const tail = logLines.slice(-80).join("\n");
            throw new PovrayError(
                `POV-Ray exited with code ${exitCode}\n${tail}`,
                exitCode,
                logLines.join("\n"),
            );
        }

        // Collect runs with the instance still alive: it copies the output
        // PNG(s) into fresh, non-shared buffers (callers must never hold a
        // view into growable, shared wasm memory) before `finally` reaps it.
        return collect(FS);
    } finally {
        signal?.removeEventListener("abort", onSignalAbort);
        // Safety net on every exit path: a no-op after a clean EXIT_RUNTIME
        // teardown, but it reaps preallocated pool workers on early-throw
        // paths that would otherwise keep a Node process alive forever.
        /* c8 ignore next 6 -- terminateAllThreads only throws once the runtime is already torn down; the success/throw exit paths reach this with a live instance */
        try {
            instance.PThread.terminateAllThreads();
        } catch {
            // runtime already torn down
        }
    }
}

/**
 * Render a POV-Ray scene to a PNG.
 *
 * @param source  POV-Ray SDL scene text (staged as `/work/scene.pov`).
 * @param options See {@link RenderOptions}.
 * @returns PNG bytes in a fresh, non-shared buffer (safe to transfer or
 *          hold indefinitely; never a view into wasm memory).
 * @throws {PovrayError} when POV-Ray exits non-zero (parse error, render
 *         failure) or the wasm runtime aborts; `AbortError` when cancelled
 *         via `options.signal`.
 */
export async function render(source: string, options: RenderOptions = {}): Promise<Uint8Array> {
    return runEngine(source, options, [], (fs) => Uint8Array.from(fs.readFile("/work/out.png")));
}

/** Options for {@link renderAnimation}. Extends {@link RenderOptions}. */
export interface AnimationOptions extends RenderOptions {
    /** Number of frames to render. Required; must be an integer >= 1. */
    frames: number;
    /** Clock value at the first frame (`+KI`). Default 0. */
    initialClock?: number;
    /** Clock value at the final frame (`+KF`). Default 1. */
    finalClock?: number;
    /**
     * Called once per completed frame, in order (1-based), all before the
     * returned promise resolves. A throwing callback is swallowed so it can
     * never corrupt the render.
     */
    onFrame?: (index: number, total: number) => void;
}

// POV-Ray prints exactly one "Trace Time:" line per completed frame (the
// final one for each frame is flushed before onExit resolves), so counting
// these lines is the reliable per-frame completion signal. The "Rendering
// frame N of M" banner is doubled for frame 1 (print + printErr both capture
// startup), so it is deliberately NOT used here.
const TRACE_DONE = /^\s*Trace Time:/;

/**
 * Render a POV-Ray scene as an animation: drives POV-Ray's native clock loop
 * (`+KFI1 +KFF{frames} +KI{initialClock} +KF{finalClock}`) and returns one PNG
 * per frame, in frame order.
 *
 * @param source  POV-Ray SDL scene text (staged as `/work/scene.pov`). Use the
 *                `clock` identifier (it sweeps `initialClock`..`finalClock`).
 * @param options See {@link AnimationOptions}; `frames` is required.
 * @returns One PNG per frame, each in a fresh, non-shared buffer, ordered by
 *          frame number (numeric, so frame 2 precedes frame 10).
 * @throws Error (rejects, since this is async) when `frames` is not an integer
 *         >= 1.
 * @throws {PovrayError} when POV-Ray exits non-zero; `AbortError` when
 *         cancelled via `options.signal`.
 */
export async function renderAnimation(
    source: string,
    options: AnimationOptions,
): Promise<Uint8Array[]> {
    const { frames, initialClock = 0, finalClock = 1, onFrame, onProgress } = options;

    if (!Number.isInteger(frames) || frames < 1) {
        throw new Error("frames must be an integer >= 1");
    }
    if (!Number.isFinite(initialClock) || !Number.isFinite(finalClock)) {
        throw new RangeError("initialClock and finalClock must be finite numbers");
    }

    const extraArgs = ["+KFI1", `+KFF${frames}`, `+KI${initialClock}`, `+KF${finalClock}`];

    let framesDone = 0;
    const fireOnFrame = (index: number, total: number) => {
        if (!onFrame) return;
        try {
            onFrame(index, total);
        } catch {
            // Mirror append's swallow: a throwing frame callback must never
            // corrupt the render.
        }
    };

    return runEngine(
        source,
        {
            ...options,
            onProgress: (line) => {
                if (TRACE_DONE.test(line)) fireOnFrame(++framesDone, frames);
                onProgress?.(line);
            },
        },
        extraArgs,
        // Bytes only, each copied into a fresh non-shared buffer.
        (fs) => {
            // A single-frame run (+KFF1) emits a bare out.png with no number;
            // read it directly so a stray out<N>.png can never shadow it.
            if (frames === 1) {
                return [Uint8Array.from(fs.readFile("/work/out.png"))];
            }
            // A multi-frame run writes out<N>.png, zero-padded to the digit
            // width of `frames`. Match that exact padding AND bound N to
            // [1, frames] so caller-staged strays (a leftover frame from a
            // higher count, an incidentally-named out9.png) can never
            // masquerade as a frame this run produced. In-range, same-padding
            // files are exactly what POV-Ray overwrites this run, so they are
            // always fresh; the numeric sort keeps out2 ahead of out10.
            const width = String(frames).length;
            const framePng = new RegExp(`^out(\\d{${width}})\\.png$`);
            const numbered: { name: string; n: number }[] = [];
            for (const name of fs.readdir("/work")) {
                const m = framePng.exec(name);
                if (!m) continue;
                const n = Number(m[1]);
                if (n >= 1 && n <= frames) numbered.push({ name, n });
            }
            numbered.sort((a, b) => a.n - b.n);
            return numbered.map((e) => Uint8Array.from(fs.readFile("/work/" + e.name)));
        },
    );
}
