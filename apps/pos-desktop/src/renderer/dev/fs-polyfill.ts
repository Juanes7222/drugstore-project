/**
 * Minimal polyfill for `node:fs` / `fs` so PGlite and Prisma runtime can be
 * bundled in a browser / Tauri-webview environment.
 *
 * PGlite's NODEFS filesystem backend (`@electric-sql/pglite/nodefs`) calls
 * `fs.existsSync` and `fs.mkdirSync` during construction.  In the webview
 * these are stubs — the real persistence layer is IndexedDB (IdbFs), not
 * the OS filesystem, so NODEFS is never the active backend at runtime.
 * The stubs merely prevent the module loader from crashing during evaluation.
 */

export function existsSync(_path: string): boolean {
  return false;
}

export function mkdirSync(
  _path: string,
  _options?: { recursive?: boolean } | number | string | null,
): void {
  // noop — NODEFS is not the active backend in webview contexts.
}

export function readFileSync(
  _path: string,
  _options?: { encoding?: string } | string | null,
): string | Buffer {
  throw new Error(
    'fs.readFileSync is not available in browser/Tauri-webview context. ' +
    'Use fetch() or Tauri IPC for file access.',
  );
}

export function writeFileSync(
  _path: string,
  _data: string | Uint8Array,
  _options?: unknown,
): void {
  // noop
}

export function statSync(_path: string): object {
  return { isFile: () => false, isDirectory: () => false };
}

export function lstatSync(_path: string): object {
  return statSync(_path);
}

export function realpathSync(_path: string): string {
  return _path;
}

export function accessSync(
  _path: string,
  _mode?: number,
): void {
  // noop
}

export const promises = {
  readFile: async (
    _path: string,
    _options?: { encoding?: string } | string | null,
  ): Promise<string | Buffer> => {
    throw new Error(
      'fs.promises.readFile is not available in browser/Tauri-webview context.',
    );
  },
  writeFile: async (
    _path: string,
    _data: string | Uint8Array,
    _options?: unknown,
  ): Promise<void> => {
    // noop
  },
  mkdir: async (
    _path: string,
    _options?: { recursive?: boolean } | number | null,
  ): Promise<void> => {
    // noop
  },
  access: async (_path: string, _mode?: number): Promise<void> => {
    // noop
  },
};

// Default export for `import fs from "node:fs"` consumers.
export default {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  lstatSync,
  realpathSync,
  accessSync,
  promises,
};
