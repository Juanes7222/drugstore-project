/**
 * Minimal polyfill for `node:url` and `node:fs` so the Prisma 7 runtime can
 * be bundled by Vite in a browser/Tauri-webview environment.
 *
 * - `node:url`: Prisma reads `fileURLToPath` (named or namespace import)
 *   during initialisation.  In a PGlite + pglite-prisma-adapter setup no
 *   file-system URLs are actually resolved, so we return an empty string.
 * - `node:fs`: Prisma's runtime error formatter reads source files via
 *   `readFileSync`.  The file may not exist in a browser context so we
 *   gracefully fail (return undefined).
 */

// ---- node:url ----

export const fileURLToPath = (): string => '';
export const URL = globalThis.URL;

// ---- node:fs (used by Prisma error formatting / source reading) ----

/**
 * Minimal readFileSync stub for Prisma's error formatting path.
 * In a browser/webview the source file is never on disk, so we return
 * undefined to signal "not found" — the caller handles this gracefully.
 */
export function readFileSync(_path: string, _encoding?: string): string | undefined {
  return undefined;
}

/**
 * Default export satisfies both `import url from "node:url"`
 * and `import fs from "node:fs"` (default-import consumers).
 */
export default { fileURLToPath, URL, readFileSync };
