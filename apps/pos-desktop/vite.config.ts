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
      "@pharmacy/database": resolve(
        __dirname,
        "../../packages/database/src/index.ts",
      ),
      "@pharmacy/database/local": resolve(
        __dirname,
        "../../packages/database/src/local.ts",
      ),
      "@pharmacy/database/local-schema": resolve(
        __dirname,
        "../../packages/database/src/local-schema.ts",
      ),
      "@pharmacy/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src/index.ts",
      ),
      "@pharmacy/shared-validation": resolve(
        __dirname,
        "../../packages/shared-validation/src/index.ts",
      ),
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
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
  },
}));
