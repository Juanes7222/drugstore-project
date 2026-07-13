import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src/renderer"),
      "@infra": resolve(__dirname, "./src/infrastructure"),
      // IMPORTANT: more-specific aliases must come BEFORE less-specific ones so
      // Vite resolves e.g. @pharmacy/database/local to the correct file rather
      // than appending "/local" to the generic @pharmacy/database path.
      "@pharmacy/database/local-schema": resolve(
        __dirname,
        "../../packages/database/src/local-schema.ts",
      ),
      "@pharmacy/database/local": resolve(
        __dirname,
        "../../packages/database/src/local.ts",
      ),
      "@pharmacy/database": resolve(
        __dirname,
        "../../packages/database/src/index.ts",
      ),
      "@pharmacy/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src/index.ts",
      ),
      "@pharmacy/shared-validation": resolve(
        __dirname,
        "../../packages/shared-validation/src/index.ts",
      ),
      // Polyfill node:url so Prisma 7 runtime can be bundled by Vite in a
      // browser / Tauri-webview environment (the pglite-prisma-adapter never
      // actually resolves file URLs at runtime).
      "node:url": resolve(__dirname, "./src/renderer/dev/empty-url-polyfill.ts"),
      // Polyfill node:crypto for sync services that generate UUIDs client-side.
      "node:crypto": resolve(__dirname, "./src/renderer/dev/empty-crypto-polyfill.ts"),
      // Polyfills for all other node:* modules that Prisma 7 runtime imports.
      "node:async_hooks": resolve(__dirname, "./src/renderer/dev/node-polyfills.ts"),
      "node:events": resolve(__dirname, "./src/renderer/dev/node-polyfills.ts"),
      "node:os": resolve(__dirname, "./src/renderer/dev/node-polyfills.ts"),
      "node:module": resolve(__dirname, "./src/renderer/dev/node-polyfills.ts"),
      "node:process": resolve(__dirname, "./src/renderer/dev/node-polyfills.ts"),
      "node:path": resolve(__dirname, "./src/renderer/dev/path-polyfill.ts"),
      "node:buffer": resolve(__dirname, "./src/renderer/dev/buffer-polyfill.ts"),
      "node:fs": resolve(__dirname, "./src/renderer/dev/empty-url-polyfill.ts"),
    },
  },

  // Exclude @prisma/client and the PGlite adapter from Vite's pre-bundling so
  // that our resolve.alias polyfills for node:url and node:crypto take effect
  // at the module level.  When Vite pre-bundles them into node_modules/.vite/
  // the alias resolution happens too late and the polyfills are not applied.
  // Note: postgres-array and similar CJS deps of @prisma/client are bundled
  // inline by Vite during the transform phase — the error “does not provide an
  // export named 'parse'” indicates those CJS modules need explicit bundling.
  // We exclude the whole @prisma/client chain so those CJS modules are left
  // as-is and resolved at runtime instead.
  optimizeDeps: {
    exclude: [
      "@pharmacy/database",
      "@pharmacy/database/local",
      "@prisma/client",
      "pglite-prisma-adapter",
    ],
  },

  // Make Vite treat these workspace dependencies as not external during SSR/Tauri
  // builds so they are bundled inline rather than left as bare imports.
  ssr: {
    noExternal: [
      "@pharmacy/database",
      "@pharmacy/database/local",
    ],
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5173,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Env variables starting with TAURI_ will be exposed to tauri's source code
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: "esnext",
    // don't minify for debug builds
    minify: process.env.TAURI_DEBUG ? false : ("esbuild" as const),
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/renderer/dev/**",
        "src/renderer/styles/**",
        "src/renderer/i18n/locales/**",
        "src-tauri/**",
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    css: true,
  },
}));
