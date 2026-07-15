/**
 * Minimal polyfill for `node:path` so Prisma generated client can be bundled
 * in a browser / Tauri-webview environment.
 *
 * Must export `sep` and `posix` as top-level named exports because Prisma
 * uses both `import * as path from "node:path"` and
 * `import jt from "node:path"` (default), then reads `sep`, `posix.sep`,
 * and calls `dirname()`.
 */

export const sep = '/';
export const posix = { sep: '/' };
export const win32 = { sep: '\\' };

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  const j = p.lastIndexOf('\\');
  const idx = Math.max(i, j);
  return idx >= 0 ? p.slice(0, idx) : '.';
}

export function basename(p: string, ext?: string): string {
  const i = p.lastIndexOf('/');
  const j = p.lastIndexOf('\\');
  const name = i >= 0 || j >= 0 ? p.slice(Math.max(i, j) + 1) : p;
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

export function extname(p: string): string {
  const i = p.lastIndexOf('.');
  const s = p.lastIndexOf('/');
  const b = p.lastIndexOf('\\');
  return i > Math.max(s, b) ? p.slice(i) : '';
}

export function join(...segments: string[]): string {
  return segments.filter(Boolean).join('/').replace(/\\/g, '/');
}

export function resolve(...segments: string[]): string {
  return join('/', ...segments);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Default export for `import p from "node:path"` consumers.
 * Prisma runtime uses this via `import jt from "node:path"` and reads
 * `jt.sep`, `jt.posix.sep`, `jt.dirname(...)`.
 */
export default { sep, posix, win32, dirname, basename, extname, join, resolve, isAbsolute, normalize };
