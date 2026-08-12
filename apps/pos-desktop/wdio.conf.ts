/**
 * WebdriverIO configuration for Tauri e2e tests.
 *
 * Drives the real Tauri desktop app (`pos-desktop.exe`, debug build) through
 * tauri-driver / WebView2 via the `@wdio/tauri-service`. A deterministic
 * HTTP mock of the NestJS backend (`e2e/mock-server.mjs`) runs on port 3000
 * so the app's sync pipeline seeds the local PGlite DB with the same data
 * every run (payment methods, products, lots).
 *
 * Run with: `pnpm test:e2e`. The script rebuilds the frontend (`pnpm build`)
 * and the debug binary with the `wdio` cargo feature, which registers
 * `tauri-plugin-wdio` (Rust + `@wdio/tauri-plugin` in the frontend). Without
 * the plugin the service falls back to a 100-probe plugin-availability check
 * per command (~10s overhead each), which made the suite take 6+ minutes
 * with the first test timing out. Requires: tauri-driver on PATH.
 *
 * The `test:e2e` script touches `src-tauri/build.rs` before building so the
 * tauri-build script always re-runs and embeds the `wdio:default` capability
 * (cargo may otherwise reuse a cached build-script output from a previous
 * non-wdio `tauri dev` build, leaving the ACL without the wdio permission).
 */

import type { Options } from "@wdio/types";
import { startMockServer, stopMockServer } from "./e2e/mock-server.mjs";

export const config: Options.Testrunner = {
  runner: "local",

  // Only the WDIO specs — the legacy Playwright specs (e2e/*.spec.ts) are
  // no longer runnable (dev-mode Prisma shim cannot boot in a browser).
  specs: ["./e2e/sales-flow.e2e.ts", "./e2e/returns-flow.e2e.ts"],

  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: "./src-tauri/target/debug/pos-desktop.exe",
      },
    },
  ],

  services: [
    [
      "tauri",
      {
        appBinaryPath: "./src-tauri/target/debug/pos-desktop.exe",
        // Use the standalone tauri-driver (installed via cargo). The binary
        // must be built with `cargo build --features wdio` so the service's
        // plugin-availability check passes on the first probe.
        driverProvider: "external",
        // tauri-driver 2.x is installed via `cargo install tauri-driver`.
        autoInstallTauriDriver: false,
        // Windows: keep the Edge WebDriver in sync with the local WebView2.
        autoDownloadEdgeDriver: true,
      },
    ],
  ],

  logLevel: "info",
  bail: 0,
  baseUrl: "http://localhost:4444",
  // Element-state checks run through synchronous `browser.execute` (resolve
  // in ms); wait loops poll at 1s granularity, so a 10s implicit wait
  // comfortably covers a dozen checks. The slow cold boot happens once per
  // run (see `login()` in e2e/helpers.ts).
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    // 5 min per test: covers the one-time cold boot (PGlite init + service
    // hydration + sync, ~1 min) plus the cash-shift setup. Revisit downward
    // once a full run is measured.
    timeout: 300_000,
  },

  // Backend mock lifecycle: start before the app boots, stop at the end.
  onPrepare: async (): Promise<void> => {
    await startMockServer();
  },

  onComplete: async (): Promise<void> => {
    await stopMockServer();
  },
};
