/**
 * Minimal polyfill for `node:url` so the Prisma 7 runtime can be bundled by
 * Vite in a browser/Tauri-webview environment.
 *
 * Prisma reads `fileURLToPath` (named or namespace import) during
 * initialisation.  In a PGlite + pglite-prisma-adapter setup no file-system
 * URLs are actually resolved, so we return an empty string.
 */

// ---- node:url ----

export const fileURLToPath = (): string => '';
export const URL = globalThis.URL;

/**
 * Default export satisfies `import url from "node:url"` (default-import consumers).
 */
export default { fileURLToPath, URL };
