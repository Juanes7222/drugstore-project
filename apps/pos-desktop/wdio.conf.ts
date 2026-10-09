/**
 * WebdriverIO configuration for Tauri e2e tests.
 *
 * Drives the real Tauri desktop binary (`pos-desktop.exe`, debug build) against
 * the REAL NestJS backend (e2e/real-backend.ts) backed by the real Postgres and
 * Redis containers.
 *
 * There is no HTTP mock. The suite previously ran against a hand-written mock
 * server, which was a second, unverified copy of the API contract: when a real
 * response shape changed the mock did not, so the specs stayed green while the
 * application broke. Sharing nothing but the HTTP wire with production code is
 * what makes a contract drift fail here instead.
 *
 * ## Why tauri-driver is driven directly
 *
 * This follows the manual setup from the Tauri docs
 * (docs/Tests/WebDriver/Example/webdriverio) rather than using
 * `@wdio/tauri-service`: `tauri-driver` is the WebDriver endpoint, specified
 * with `host`/`port` and a `tauri:options` capability, and started once for the
 * whole run in `onPrepare`.
 *
 * The service route was the source of this suite's chronic flakiness. It probes
 * for the optional `tauri-plugin-wdio` bridge on EVERY WebDriver command, and
 * when the bridge is absent each probe is a failing `executeAsyncScript` — the
 * documented "100-probe availability check per command". The bridge also has to
 * be initialised in the renderer and requires `withGlobalTauri`, which is why
 * the binary needed a special e2e build at all. Driving tauri-driver directly
 * removes the probe, the plugin, and the extra build configuration, and plain
 * WebDriver element interaction is all these specs need.
 *
 * Direct tauri-driver support is Windows and Linux; macOS has no WKWebView
 * driver tool. This suite therefore only runs on those two platforms.
 *
 * Run with `pnpm test:e2e`, which builds the frontend (pinning
 * VITE_API_BASE_URL and VITE_WORKSTATION_ID) and the server bundle first.
 */

import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Options } from "@wdio/types";
import {
  ensureTestInfrastructure,
  killLeftoverDrivers,
  pinWorkstationIdentity,
  resetServerFixtures,
  resetWebViewProfile,
  startRealBackend,
  stopRealBackend,
} from "./e2e/real-backend";
import { resolveEdgeDriverPath } from "./e2e/native-driver";

/**
 * Workstation identity the whole suite agrees on.
 *
 * Fixtures allocate the DIAN consecutive to this id, the frontend build pins it
 * via VITE_WORKSTATION_ID, and onPrepare writes it into the Tauri app-data file
 * the app converges toward at boot. All three must match or fiscal document
 * generation fails on the second run.
 */
const { WORKSTATION_ID } = await import("./e2e/workstation-id");

const TAURI_DRIVER_HOST = "127.0.0.1";
const TAURI_DRIVER_PORT = 4444;

const APPLICATION_BINARY = path.resolve(
  process.cwd(),
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "pos-desktop.exe" : "pos-desktop",
);

let tauriDriver: ChildProcess | null = null;
let shuttingDown = false;

function stopTauriDriver(): void {
  const child = tauriDriver;
  tauriDriver = null;
  if (!child?.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

/**
 * A driver that dies mid-run would otherwise surface as a confusing "no such
 * element" on every remaining command, so fail loudly instead.
 */
function trackTauriDriver(): void {
  const child = tauriDriver;
  if (!child) return;

  child.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error(`tauri-driver failed to start: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    // eslint-disable-next-line no-console
    console.error(`tauri-driver exited unexpectedly with code ${code}`);
    stopRealBackend();
    process.exit(1);
  });
}

// The driver is torn down in onComplete, which does not run when the run is
// interrupted, so it is also killed on shutdown. Without this an aborted run
// leaves a process bound to :4444 and the next run cannot connect.
const cleanupOnShutdown = (): void => {
  shuttingDown = true;
  stopTauriDriver();
};
process.on("exit", cleanupOnShutdown);
process.on("SIGINT", () => {
  cleanupOnShutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupOnShutdown();
  process.exit(143);
});

/**
 * Both halves are needed: `WebdriverIO.Config` carries `capabilities` and
 * `WebdriverIO` carries `host`/`port`. Neither alone models a testrunner config
 * that talks to a WebDriver endpoint directly.
 */
export const config: WebdriverIO.Config & Options.WebdriverIO = {
  runner: "local",

  /**
   * Execution order is a test dependency, not a preference.
   *
   *   - `purchases-flow` must precede `tenant-config-flow`: the config specs turn
   *     `allowOverReception` on and leave it on, and the purchase specs create
   *     orders and receptions that the over-reception rules would otherwise
   *     reject differently from one run to the next.
   *   - `purchases-flow`'s later specs depend on its own earlier ones — the
   *     reception is what gives Ibuprofeno a cost, which is the only thing that
   *     makes the price floor and the cost snapshot observable. Mocha runs a
   *     file's `it`s in declaration order, so they stay adjacent here.
   *   - `lot-expiry-flow` sets and clears `requireLotOnReception` itself rather
   *     than depending on `tenant-config-flow`, so it is order-independent.
   *   - `users-flow` and `tenant-config-flow` sign in as OWNER, because every
   *     `/users` guard and the only price-override exemption require that role.
   *     They run last so the role switch happens once.
   *   - `sales-credit-flow` is order-independent: it snapshots the client's
   *     credit state itself and asserts the DELTA its sale causes, so it neither
   *     inherits nor leaks credit state. It sits with the other sales specs.
   */
  specs: [
    "./e2e/sales-flow.e2e.ts",
    "./e2e/sales-pricing-flow.e2e.ts",
    "./e2e/sales-credit-flow.e2e.ts",
    "./e2e/returns-flow.e2e.ts",
    "./e2e/purchases-flow.e2e.ts",
    "./e2e/clients-flow.e2e.ts",
    "./e2e/lot-expiry-flow.e2e.ts",
    "./e2e/users-flow.e2e.ts",
    "./e2e/tenant-config-flow.e2e.ts",
  ],

  // One instance: the app drives a single shared local database and a single
  // backend, so parallel specs would fight over both.
  maxInstances: 1,

  // tauri-driver proxies to the platform WebDriver; this is a plain WebDriver
  // endpoint, so no browserName is set.
  hostname: TAURI_DRIVER_HOST,
  port: TAURI_DRIVER_PORT,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,

  // One instance per capability as well as for the run: `maxInstances` alone
  // still lets the launcher start one worker per spec file, and a second worker
  // is what made the first one's teardown kill the tauri-driver the other was
  // using.
  maxInstancesPerCapability: 1,

  capabilities: [
    {
      "tauri:options": {
        application: APPLICATION_BINARY,
      },
    },
  ],

  // "warn" instead of "info": at info level WebdriverIO logs every driver
  // payload, which buries the actual spec results.
  logLevel: "warn",

  // Stop at the first failure. With one shared app instance and one backend, a
  // cascade after a real failure only adds noise.
  bail: 1,

  waitforTimeout: 10_000,

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    // A wiped PGlite plus a real boot sync against the backend is a slow cold
    // start; this also covers the wait for the server-side replay the
    // assertions query.
    timeout: 420_000,
  },

  // Infrastructure, then a clean app profile, then the pinned workstation
  // identity, then fixtures, then the server, then the app boots.
  onPrepare: async (): Promise<void> => {
    ensureTestInfrastructure();
    killLeftoverDrivers();
    resetWebViewProfile();
    pinWorkstationIdentity(WORKSTATION_ID);
    resetServerFixtures();
    await startRealBackend();

    // The driver lives for the whole run, not per session. Started from a
    // session hook it was bound to whichever worker got there last, so the
    // first worker to finish killed the driver the others were still using —
    // a "tauri-driver exited unexpectedly with code 1" that had nothing to do
    // with the specs. Workers reach it over TCP, so the main process owning the
    // lifecycle is all that matters.
    const nativeDriver = await resolveEdgeDriverPath();
    const args = nativeDriver ? ["--native-driver", nativeDriver] : [];

    tauriDriver = spawn(
      path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver"),
      args,
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    trackTauriDriver();
  },

  onComplete: async (): Promise<void> => {
    shuttingDown = true;
    stopTauriDriver();
    await stopRealBackend();
    killLeftoverDrivers();
  },
};
