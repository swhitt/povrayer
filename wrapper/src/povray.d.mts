/**
 * Ambient module types for the emscripten-built factory (`povray.mjs`).
 *
 * The runtime `povray.mjs` is produced by the Docker builder stage and does
 * not exist when `tsc` runs in the wrapper-build stage. Under NodeNext module
 * resolution, the `./povray.mjs` import specifier in `index.ts` resolves to
 * this adjacent `.d.mts` file at compile time, so the wrapper typechecks
 * without the artifact present.
 *
 * Nothing here is re-exported from `index.ts`: the public `index.d.ts` must
 * stay self-contained. These types are build-internal only.
 */

/** Subset of the emscripten FS API the wrapper uses. */
export interface PovrayFS {
    mkdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    /**
     * Binary read. The result may reference memory owned by the module;
     * callers must copy before handing the bytes to anyone else.
     */
    readFile(path: string): Uint8Array;
}

/** Subset of one instantiated povray module the wrapper uses. */
export interface PovrayModule {
    /**
     * Under PROXY_TO_PTHREAD this returns immediately; completion is signaled
     * via the `onExit` factory option, never via the return value.
     */
    callMain(argv: string[]): void;
    FS: PovrayFS;
    PThread: {
        /** Violently terminates every live pthread worker. */
        terminateAllThreads(): void;
    };
}

/** Module overrides accepted by the emscripten factory. */
export interface PovrayModuleOptions {
    print?: (line: string) => void;
    printErr?: (line: string) => void;
    /**
     * Fired when the runtime exits (`EXIT_RUNTIME=1`); this is the real
     * end-of-render event.
     */
    onExit?: (exitCode: number) => void;
    /** Fired on a fatal wasm abort (OOM, trap, failed assertion). */
    onAbort?: (what: unknown) => void;
    /** Overrides the default exit behavior (`process.exit` in Node). */
    quit?: (exitCode: number, toThrow?: unknown) => void;
    locateFile?: (file: string, prefix: string) => string;
}

/**
 * MODULARIZE + EXPORT_ES6 factory: each call produces one isolated module
 * instance with its own memory, FS, and worker pool.
 */
export default function createPovray(
    options?: PovrayModuleOptions,
): Promise<PovrayModule>;
