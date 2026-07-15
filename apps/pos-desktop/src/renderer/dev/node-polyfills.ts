/**
 * Unified polyfills for Node.js built-in modules that Prisma 7 runtime and
 * other dependencies may import in a browser / Tauri-webview environment.
 *
 * Each export group mirrors the `node:*` module it polyfills so that Vite's
 * resolve.alias can redirect imports here.  No-op implementations are used
 * wherever the real functionality is not needed by the PGlite adapter
 * (e.g. file-system operations are handled by PGlite's own WASM layer).
 *
 * IMPORTANT: Because generated client code and the Prisma runtime use
 * `import * as ns from "node:*"` (namespace import), every property that
 * consumer reads via `ns.property` MUST be a **top-level named export** of
 * this module — never wrapped inside a sub-object.
 */

// ---------------------------------------------------------------------------
// Patch the global `process` object (belt & suspenders — the HTML-injected
// script in vite.config.ts and the `define` options should already have
// handled this, but PGlite accesses the GLOBAL process directly, not through
// an ESM import of "node:process", so we double-patch here in case this
// module loads before any Emscripten `process.binding` call).
// ---------------------------------------------------------------------------
(function patchGlobalProcess(): void {
  try {
    const p = (typeof globalThis !== "undefined" && (globalThis as any).process) as any;
    if (!p) return;

    // Prevent Emscripten from seeing versions.node as a string
    if (p.versions) {
      try {
        Object.defineProperty(p.versions, "node", {
          get: () => undefined,
          set: () => {},
          configurable: false,
          enumerable: true,
        });
      } catch {
        // If the property is already non-configurable, just delete+reset
        try { delete p.versions.node; } catch { /* ignore */ }
        p.versions.node = undefined;
      }
    }

    // Provide a throwing process.binding so Emscripten falls back to MEMFS
    if (typeof p.binding !== "function") {
      p.binding = (name: string) => {
        throw new Error("process.binding(" + name + ") polyfilled (global patch)");
      };
    }
  } catch {
    // Silently ignore if process is not accessible
  }
})();

// Import sister polyfills so we can register them in the CommonJS
// require() cache used by PGlite's Emscripten runtime (which obtains a
// require function via `require("module").createRequire(...)` then calls
// `require("fs")`, `require("path")`, etc.).
//
// The default export of each sister polyfill mirrors the shape of the
// Node.js builtin's module.exports object, which is what CJS consumers
// expect.
import * as _fs from "./fs-polyfill.ts";
import * as _path from "./path-polyfill.ts";
import * as _buffer from "./buffer-polyfill.ts";
import * as _url from "./empty-url-polyfill.ts";
// node:os is inlined below — no separate polyfill file for it.

// ---------------------------------------------------------------------------
// node:async_hooks — Prisma runtime uses AsyncResource
// ---------------------------------------------------------------------------

export class AsyncResource {
  static bind<F extends (...args: unknown[]) => unknown>(fn: F): F {
    return fn;
  }
  runInAsyncScope<T>(fn: (...args: unknown[]) => T, thisArg?: unknown, ...args: unknown[]): T {
    return fn.apply(thisArg, args);
  }
  emitDestroy(): this { return this; }
}

export const executionAsyncId = (): number => 0;
export const triggerAsyncId = (): number => 0;
export const createHook = (): { enable: () => void; disable: () => void } => ({
  enable: () => undefined,
  disable: () => undefined,
});

// ---------------------------------------------------------------------------
// node:events
// ---------------------------------------------------------------------------

export class EventEmitter {
  private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
    return this;
  }
  off(event: string, listener: (...args: unknown[]) => void): this {
    const arr = this.listeners.get(event);
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    }
    return this;
  }
  emit(event: string, ...args: unknown[]): boolean {
    const arr = this.listeners.get(event);
    if (!arr) return false;
    for (const fn of arr) fn(...args);
    return true;
  }
  addListener = this.on;
  removeListener = this.off;
  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapper = (...args: unknown[]) => {
      listener(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }
  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
    return this;
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

// ---------------------------------------------------------------------------
// node:os
// ---------------------------------------------------------------------------

export const freemem = (): number => 0;
export const totalmem = (): number => 0;
/** @deprecated avoid — conflicts with platform from node:process namespace. Use osPlatform instead. */
export const platform = (): string => 'browser';
export const osPlatform = (): string => 'browser';
export const type = (): string => 'Browser';
export const release = (): string => '';
export const hostname = (): string => '';
export const arch = (): string => 'wasm';
export const tmpdir = (): string => '/tmp';
export const EOL = '\n';

// ---------------------------------------------------------------------------
// node:module
// ---------------------------------------------------------------------------

export class Module {
  readonly exports: Record<string, unknown> = {};
  static _resolveFilename = (): string => '';
}

/**
 * Registry of node:* modules accessible via require().
 * Prisma's bundled runtime calls `require('node:crypto')` (and possibly
 * other node:* modules) through the CJS loader created by createRequire.
 * Each entry here mirrors the exports of the corresponding polyfill file.
 */
const requireModuleCache = new Map<string, unknown>();

/** Register a module so createRequire can resolve it synchronously. */
export function registerRequireModule(name: string, exports: unknown): void {
  requireModuleCache.set(name, exports);
}

// Pre-register node:crypto (mirrors empty-crypto-polyfill.ts)
const crypto = globalThis.crypto;
registerRequireModule('node:crypto', {
  webcrypto: crypto,
  randomUUID: (): string => crypto.randomUUID(),
  randomBytes: (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return bytes;
  },
  randomFillSync: (
    buffer: Uint8Array,
    offset = 0,
    size?: number,
  ): Uint8Array => {
    const view = size != null ? buffer.subarray(offset, offset + size) : buffer;
    crypto.getRandomValues(view);
    return buffer;
  },
  default: { webcrypto: crypto, randomUUID: crypto.randomUUID, randomBytes: () => new Uint8Array(0), randomFillSync: () => new Uint8Array(0) },
});

// ---------------------------------------------------------------------------
// Pre-register the sister polyfills so PGlite's Emscripten runtime can load
// them via `require()` (obtained through `require("module").createRequire`).
// Both the bare name (e.g. "fs") and the `node:` prefix variant are
// registered so either spelling works.
// ---------------------------------------------------------------------------

registerRequireModule('fs', _fs.default);
registerRequireModule('node:fs', _fs.default);

registerRequireModule('path', _path.default);
registerRequireModule('node:path', _path.default);

registerRequireModule('buffer', _buffer.default);
registerRequireModule('node:buffer', _buffer.default);

// node:os stubs (defined inline since there's no separate os polyfill file).
const osStubs = {
  freemem: () => 0,
  totalmem: () => 0,
  platform: () => 'browser',
  type: () => 'Browser',
  release: () => '',
  hostname: () => '',
  arch: () => 'wasm',
  tmpdir: () => '/tmp',
  EOL: '\n',
};
registerRequireModule('os', osStubs);
registerRequireModule('node:os', osStubs);

registerRequireModule('url', _url.default);
registerRequireModule('node:url', _url.default);

/**
 * Create a CommonJS require function for a given file URL.
 *
 * In the browser/webview, most CJS modules are unavailable.  We support a
 * pre-registered set of `node:*` polyfills (see registerRequireModule).
 * Unknown modules return an empty object rather than throwing — this keeps
 * Emscripten's module probe-and-fallback pattern (try require('fs'), if it
 * doesn't work use MEMFS) from crashing.
 */
export const createRequire =
  (): ((id: string) => unknown) =>
  (id: string): unknown => {
    const cached = requireModuleCache.get(id);
    if (cached !== undefined) return cached;
    // Return empty object so Emscripten's runtime probes (e.g. `require('fs')`
    // from within a try/catch) succeed with a stub instead of throwing.
    return {};
  };

// ---------------------------------------------------------------------------
// node:process
//
// Prisma runtime and generated client use `import * as process from "node:process"`
// and access `process.env`, `process.version`, `process.nextTick`, etc.
// EVERY property they read must be a TOP-LEVEL named export of this module.
// ---------------------------------------------------------------------------

export const env: Record<string, string | undefined> = {};

/**
 * nextTick — microtask-based, not truly sync.
 */
export const nextTick: (fn: () => void) => void = (fn) => {
  Promise.resolve().then(() => fn());
};

export const cwd: () => string = () => '/';

export const argv: string[] = [];

export const exit: (code?: number) => void = () => {
  /* no-op in browser */
};

export const pid: number = 0;

/**
 * Minimal on/emit stub for event listeners (Prisma registers `beforeExit`).
 */
export function on(_event: string, _listener: (...args: unknown[]) => void): object {
  return {};
}

export const stdout: { isTTY?: boolean; write: (msg: string) => void } | undefined = undefined;

export const version = 'v22.0.0';

/**
 * Intentionally omit `versions.node`.
 *
 * PGlite 0.5.x checks `typeof process.versions.node === "string"` to decide
 * whether it runs in Node.js.  If we set it (even to a realistic string),
 * PGlite selects its Node.js filesystem backend and calls
 * `fs/promises.readFile()` — which is unavailable in the Tauri webview and
 * crashes the app.  By leaving `process.versions.node` undefined, PGlite
 * correctly falls through to the `fetch()`-based WASM loader.
 *
 * See https://github.com/electric-sql/pglite — the IN_NODE flag in
 * chunk-VVBUWNGP.js.
 */
export const versions: Record<string, string> = {};


export const platformName = 'browser';
export const archName = 'wasm';

/**
 * Default export so `import process from "node:process"` also works
 * (for any consumer that uses default import instead of namespace import).
 */
export default {
  env,
  nextTick,
  cwd,
  argv,
  exit,
  pid,
  on,
  stdout,
  version,
  versions,
  platform: platformName,
  arch: archName,
};
