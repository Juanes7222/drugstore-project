/**
 * Playwright configuration — Pharmacy POS Desktop E2E Tests.
 *
 * Runs against the Vite dev server (webServer) to validate full user flows
 * in a real browser (Chromium by default).  The webServer starts vite in
 * dev mode before the test run and shuts it down afterwards.
 *
 * ## Running
 *
 *   pnpm exec playwright test            # headless, all projects
 *   pnpm exec playwright test --ui       # interactive UI mode
 *   pnpm exec playwright test --headed   # visible browser
 *
 * ## First-time setup
 *
 *   pnpm exec playwright install chromium
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // ---------------------------------------------------------------------------
  // Test location & filtering
  // ---------------------------------------------------------------------------
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // ---------------------------------------------------------------------------
  // Reporter
  // ---------------------------------------------------------------------------
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],

  // ---------------------------------------------------------------------------
  // Web server — starts vite dev before tests, kills after
  // ---------------------------------------------------------------------------
  webServer: {
    command: "pnpm dev",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      VITE_API_BASE_URL: "http://localhost:3000",
      VITE_DB_PROOF: "0",
    },
  },

  // ---------------------------------------------------------------------------
  // Project defaults (can be overridden in test.use({...}))
  // ---------------------------------------------------------------------------
  use: {
    baseURL: "http://localhost:5173",
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
  },

  // ---------------------------------------------------------------------------
  // Projects — per browser
  // ---------------------------------------------------------------------------
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
