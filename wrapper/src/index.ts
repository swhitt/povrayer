/**
 * povrayer: POV-Ray 3.8 compiled to WebAssembly.
 *
 * The only public API is {@link render}: it stages a scene into the module's
 * in-memory filesystem, runs POV-Ray, and resolves with the PNG bytes.
 *
 * Browser requirements:
 * - The page must be cross-origin isolated (pthreads need SharedArrayBuffer):
 *   serve it with `Cross-Origin-Opener-Policy: same-origin` and
 *   `Cross-Origin-Embedder-Policy: require-corp`, and check
 *   `crossOriginIsolated === true` before calling {@link render}.
 * - `povray.mjs` and `povray.wasm` must be served as opaque static assets,
 *   never run through a bundler: the pthread worker is spawned via
 *   `new URL(import.meta.url)` and ignores `locateFile` (emscripten #22508).
 * - The wasm memory declares a 4 GB shared maximum. Chrome/Firefox treat that
 *   as an address-space reservation, but Safari/iOS can fail to instantiate
 *   it; a 2 GB build is one `--build-arg WASM_MAX_MEMORY=2GB` rebuild away.
 */

export interface RenderOptions {
    /** Image width in pixels (`+W`). Default 800. */
    width?: number;
    /** Image height in pixels (`+H`). Default 600. */
    height?: number;
    /** Render quality (`+Q`), 0..11. Omitted unless set. */
    quality?: number;
    /**
     * Antialiasing: `false` (the default) disables it (`-A`); `true` enables
     * it with threshold 0.3 (`+A0.3`); a number enables it with that
     * threshold (`+A{n}`).
     */
    antialias?: boolean | number;
    /**
     * Worker thread count (`+WT`). Default:
     * `globalThis.navigator?.hardwareConcurrency ?? 4`, clamped to 1..32.
     * (NOT bare `navigator`, which is a ReferenceError on Node 20; the
     * global only exists on Node 21 and later.)
     */
    threads?: number;
    /**
     * Extra input files staged at `/work/<name>` before rendering, so the
     * scene can `#include` them or reference image maps. Nested relative
     * paths are fine (`"textures/wood.inc"`); `".."` segments are rejected.
     */
    files?: Record<string, string | Uint8Array>;
    /** Raw POV-Ray args appended last (escape hatch: `+KFF`, `+UA`, ...). */
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
    factoryPromise ??= import("./povray.mjs").then((m) => m.default);
    return factoryPromise;
}

function defaultThreads(): number {
    const hc = globalThis.navigator?.hardwareConcurrency ?? 4;
    return Math.min(32, Math.max(1, hc));
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
// FS.writeFile/FS.readFile plus the Uint8Array.from copy in render() are the
// only data paths in or out of the instance.

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
export async function render(
    source: string,
    options: RenderOptions = {},
): Promise<Uint8Array> {
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

    signal?.throwIfAborted();

    const factory = await loadFactory();

    const logLines: string[] = [];
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
    };

    let resolveExit!: (code: number) => void;
    let rejectExit!: (reason: Error) => void;
    const exited = new Promise<number>((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
    });
    // The abort path can reject `exited` after render() has already thrown
    // (e.g. a staging error); mark it observed so that never surfaces as an
    // unhandled rejection. The real `await exited` below still sees the state.
    exited.catch(() => {});

    const instance = await factory({
        print: append,
        printErr: append,
        // Completion signal. PROXY_TO_PTHREAD makes callMain return
        // immediately, so onExit (fired when EXIT_RUNTIME tears the runtime
        // down) is the ONLY reliable end-of-render event.
        onExit: (code) => resolveExit(code),
        onAbort: (what) =>
            rejectExit(
                new PovrayError(
                    `POV-Ray wasm runtime aborted: ${String(what)}`,
                    -1,
                    logLines.join("\n"),
                ),
            ),
        // Never let the module exit the host process.
        quit: () => {},
        ...(locateFile ? { locateFile } : {}),
    });

    const onSignalAbort = () => {
        // Violent, by design: the instance is discarded after this render and
        // the next render gets a fresh one, so termination mid-render is safe.
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
        FS.writeFile("/work/scene.pov", source);
        if (files) {
            for (const [name, data] of Object.entries(files)) {
                const path = stagedPath(name);
                mkdirParents(FS, path);
                FS.writeFile(path, data);
            }
        }

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

        // Explicit copy into a fresh, non-shared buffer: callers must never
        // hold a view into (growable, shared) wasm memory.
        return Uint8Array.from(FS.readFile("/work/out.png"));
    } finally {
        signal?.removeEventListener("abort", onSignalAbort);
        // Safety net on every exit path: a no-op after a clean EXIT_RUNTIME
        // teardown, but it reaps preallocated pool workers on early-throw
        // paths that would otherwise keep a Node process alive forever.
        try {
            instance.PThread.terminateAllThreads();
        } catch {
            // runtime already torn down
        }
    }
}
