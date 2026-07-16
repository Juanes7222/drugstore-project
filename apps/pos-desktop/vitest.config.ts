/**
 * Vitest configuration — Pharmacy POS Terminal.
 *
 * Extends the main Vite config (vite.config.ts) with test-specific overrides.
 *
 * ## Why this file exists
 *
 * The main Vite config defines `process.binding` as a throwing function
 * (line 485 of vite.config.ts) to prevent Emscripten (inside PGlite) from
 * using Node.js code paths in the Tauri webview.  In tests that run under
 * Node.js (via `@vitest-environment node`), this polyfill crashes PGlite's
 * WASM initialisation because the Emscripten glue code legitimately calls
 * `process.binding('fs')` during module init.
 *
 * Vite's `define` option is injected at the runtime level via a virtual
 * module (`virtual:load-defines.js`), not per-file at transform time.  This
 * means externalising PGlite packages via `server.deps.external` is NOT
 * sufficient — the `process.binding` define must be removed entirely for all
 * test code.
 *
 * This config inherits everything from vite.config.ts (resolve aliases,
 * plugins, test settings) but omits the `process.binding` define so PGlite's
 * WASM can access the real Node.js process.binding during initialisation.
 */
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

// The Vite config is exported as defineConfig(() => ({...})).
// Call the function to resolve the config object.
const resolved = typeof viteConfig === "function" ? viteConfig({}) : viteConfig;

export default defineConfig({
  // Inherit all Vite-level config (plugins, resolve aliases, etc.)
  ...resolved,

  // Override `define` to drop the process.binding polyfill.
  // Keep process.versions.node as void 0 for non-Node test environments.
  define: {
    "process.versions.node": "void 0",
  },

  // Override `server` to inherit the base config's settings but add
  // PGlite packages to the external list for safety (even though the
  // define removal is the actual fix, externalisation prevents any
  // unexpected file-level transforms on PGlite's code).
  server: {
    ...resolved.server,
    deps: {
      ...resolved.server?.deps,
      external: [
        ...(resolved.server?.deps?.external ?? []),
        "@electric-sql/pglite",
        "pglite-prisma-adapter",
      ],
    },
  },
});
