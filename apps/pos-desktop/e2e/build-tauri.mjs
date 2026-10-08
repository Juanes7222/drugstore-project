/**
 * Builds the Tauri binary for the e2e suite.
 *
 * A plain `cargo build`, deliberately without the `wdio` cargo feature.
 * That feature pulls in `tauri-plugin-wdio`, which is only needed by
 * `@wdio/tauri-service`; this suite drives `tauri-driver` directly and does not
 * use the plugin (see wdio.conf.ts). Leaving it out also keeps
 * `src-tauri/capabilities/wdio.json` unparsed, so no `wdio:default` permission
 * is required and the e2e binary is identical to a normal debug build.
 *
 * build.rs is touched so the tauri-build script re-runs: cargo can otherwise
 * reuse a cached build-script output and embed stale capabilities.
 */
import { spawnSync } from "node:child_process";
import { utimesSync } from "node:fs";
import path from "node:path";

const APP_DIR = process.cwd();
const BUILD_RS = path.join(APP_DIR, "src-tauri", "build.rs");

utimesSync(BUILD_RS, new Date(), new Date());

const result = spawnSync(
  "cargo",
  ["build", "--manifest-path", path.join("src-tauri", "Cargo.toml")],
  {
    cwd: APP_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

process.exit(result.status ?? 1);
