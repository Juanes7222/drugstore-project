/**
 * Vitest configuration for integration tests.
 *
 * Unlike the main vitest config (which targets unit/component tests with heavy
 * mocking and browser polyfills), this config runs integration tests that make
 * real HTTP calls to apps/server and use a real PostgreSQL database via Prisma.
 *
 * IMPORTANT: This config does NOT spread the main vite.config.ts because that
 * config contains resolve aliases for node:* modules (e.g. node:path →
 * browser polyfill) that would break real Node.js `path`/`fs` usage in the
 * integration test harness.
 *
 * Run: pnpm test:int
 *
 * Requirements:
 * - PostgreSQL running with the test database configured
 * - apps/server must be buildable (or already running)
 * - Test database user must have CREATE/DROP/TRUNCATE permissions
 */
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace package aliases so imports like @pharmacy/database work
  resolve: {
    alias: {
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
    },
  },

  test: {
    // Run only integration flow tests
    include: ["test/integration/**/*.flow.test.ts"],

    // Node environment — testing HTTP calls, not React components
    environment: "node",

    // Run in a single forked process (all files share one fork for DB speed)
    pool: "forks",
    isolate: false,
    maxWorkers: 1,

    // Global setup — starts server once
    globalSetup: ["./test/integration/global-setup.ts"],

    // No setup files needed (no i18n, no jsdom matchers)
    setupFiles: [],

    // Generous timeout for integration tests (server startup, DB operations)
    testTimeout: 60_000,

    // No coverage for integration tests
    coverage: {
      enabled: false,
    },

    // Don't retry — fail fast so we know the real issue
    retry: 0,
  },
});
