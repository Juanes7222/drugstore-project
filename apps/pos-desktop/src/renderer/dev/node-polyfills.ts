/**
 * Unified polyfills for Node.js built-in modules that Prisma 7 runtime and
 * other dependencies may import in a browser / Tauri-webview environment.
 *
 * Each export group mirrors the `node:*` module it polyfills so that Vite's
 * resolve.alias can redirect imports here.  No-op implementations are used
 * wherever the real functionality is not needed by the PGlite adapter
 * (e.g. file-system operations are handled by PGlite's own WASM layer).
 */

// ---- node:async_hooks ---- (Prisma runtime uses AsyncResource)
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

// ---- node:events ----
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

// ---- node:os ----
export const freemem = (): number => 0;
export const totalmem = (): number => 0;
export const platform = (): string => 'browser';
export const type = (): string => 'Browser';
export const release = (): string => '';
export const hostname = (): string => '';
export const arch = (): string => 'wasm';
export const tmpdir = (): string => '/tmp';
export const EOL = '\n';

// ---- node:module ----
export class Module {
  readonly exports: Record<string, unknown> = {};
  static _resolveFilename = (): string => '';
}
export const createRequire = (): ((id: string) => unknown) => (id: string) => {
  throw new Error(
    `require('${id}') is not available in browser/Tauri-webview context`,
  );
};

// ---- node:process ----
export const process = {
  arch: 'wasm' as string,
  platform: 'browser' as string,
  env: {} as Record<string, string | undefined>,
  nextTick: (fn: () => void) => Promise.resolve().then(() => fn()),
  cwd: (): string => '/',
  argv: [] as string[],
  exit: () => { /* no-op */ },
  on: () => undefined as unknown,
  versions: { node: '22.0.0' },
};