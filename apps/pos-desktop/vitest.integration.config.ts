/**
 * Vitest project config — POS↔server integration tests only.
 *
 * These tests load the REAL NestJS AppModule from apps/server/src, whose
 * source uses the server tsconfig's `@/` path alias. This config maps `@/`
 * to the server src tree for the WHOLE project, which is exactly what server
 * code expects. POS test files must not rely on the renderer `@/` alias —
 * the POS services under test only use relative imports, so this is safe.
 *
 * Run with: npx vitest run --config vitest.integration.config.ts
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@/": resolve(__dirname, "../server/src") + "/",
      // POS aliases used by domain services the integration tests exercise.
      "@infra": resolve(__dirname, "./src/infrastructure"),
      // Workspace packages (server source imports them directly).
      "@pharmacy/shared-types": resolve(
        __dirname,
        "../../packages/shared-types/src/index.ts",
      ),
      "@pharmacy/shared-validation": resolve(
        __dirname,
        "../../packages/shared-validation/src/index.ts",
      ),
    },
    // Do not pre-bundle server sources; they must load as real ESM through
    // the alias. PGlite keeps its WASM loading path untouched.
    optimizeDeps: {
      exclude: [
        "@electric-sql/pglite",
        "pglite-prisma-adapter",
        "@pharmacy/database",
        "@pharmacy/database/local",
        "@pharmacy/database/local-schema",
      ],
    },
  },
  define: {
    // Keep process.versions.node as void 0 — matches the base vitest config's
    // non-Node expectation for renderer tests. Do NOT stub process.binding:
    // PGlite's WASM glue legitimately calls it under Node.
    "process.versions.node": "void 0",
  },
  server: {
    deps: {
      external: [
        "@electric-sql/pglite",
        "pglite-prisma-adapter",
        "@pharmacy/database",
        "@pharmacy/database/local",
        "@pharmacy/database/local-schema",
      ],
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/domain/integration/*.integration.test.ts"],
    // The base vitest.setup.ts is renderer-oriented; integration tests boot
    // their own environment (PGlite + real Nest app) inside beforeAll.
    setupFiles: [],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
