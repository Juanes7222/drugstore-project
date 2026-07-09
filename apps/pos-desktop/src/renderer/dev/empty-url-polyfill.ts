/**
 * Minimal polyfill for `node:url` so the Prisma 7 runtime can be bundled
 * by Vite in a browser/Tauri-webview environment.
 *
 * Prisma's `@prisma/client/runtime/client` calls `fileURLToPath` during
 * initialisation.  In a PGlite + pglite-prisma-adapter setup no file-system
 * URLs are actually resolved, so we return an empty string.
 */

export const fileURLToPath = (): string => '';
export const URL = globalThis.URL;

export default { fileURLToPath, URL };