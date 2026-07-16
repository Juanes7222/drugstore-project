/**
 * Test server bootstrap and lifecycle.
 *
 * Manages the lifecycle of apps/server for integration tests.  The server is
 * started once per test run (via Vitest's globalSetup) and stopped once after
 * all tests complete (globalTeardown).
 *
 * ## How it works
 *
 * 1. `start()` attempts to connect to an already-running server first (by
 *    hitting the health endpoint).  If it responds, we use it as-is.
 * 2. If no server responds, we spawn apps/server as a child process and wait
 *    for its health endpoint to become available.
 * 3. `stop()` kills the child process (if we started it).
 *
 * ## Environment variables
 *
 * | Variable | Default | Description |
 * |---|---|---|
 * | `TEST_SERVER_PORT` | `3001` | Port the test server listens on |
 * | `TEST_DATABASE_URL` | `postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db` | PostgreSQL connection string |
 * | `TEST_SERVER_START` | `"auto"` | `"auto"` (try existing, spawn if missing), `"external"` (fail if missing), or `"spawn"` (always spawn) |
 * | `SERVER_PROJECT_DIR` | `../../server` (relative to pos-desktop) | Path to apps/server |
 */
import { ChildProcess, spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 3001;
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";
const HEALTH_CHECK_RETRIES = 30;
const HEALTH_CHECK_INTERVAL_MS = 1000;
const SERVER_START_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the absolute path to the server project directory.
 *
 * Checks multiple locations (in order):
 * 1. `SERVER_PROJECT_DIR` env var
 * 2. `../apps/server` relative to `process.cwd()` (typical when running from pos-desktop)
 * 3. `<monorepo-root>/apps/server` by climbing up from this file's expected location
 */
function resolveServerDir(): string {
  // 1. SERVER_PROJECT_DIR env var
  if (process.env.SERVER_PROJECT_DIR) {
    const candidate = path.resolve(process.env.SERVER_PROJECT_DIR);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 2. Relative to cwd (pnpm test:int from pos-desktop or from monorepo root)
  for (const rel of ["../apps/server", "../server"]) {
    const candidate = path.resolve(process.cwd(), rel);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 3. Try from the monorepo root (2 levels up: apps/pos-desktop → apps/ → root)
  const fromParent = path.resolve(process.cwd(), "../../apps/server");
  if (fs.existsSync(fromParent)) return fromParent;

  throw new Error(
    `Cannot find apps/server project directory.  Set SERVER_PROJECT_DIR env var or ensure ` +
      `the server directory exists at one of the checked locations.\n` +
      `  cwd: ${process.cwd()}\n` +
      `  checked: SERVER_PROJECT_DIR, ../apps/server, ../server, ../../apps/server`,
  );
}

/**
 * Resolve the tsx ESM loader path from the pnpm store.
 *
 * tsx is installed at the monorepo root's .pnpm store as a devDependency.
 * We need the full path to tsx/dist/esm/index.mjs for `node --import`.
 */
function resolveTsxEsmPath(): string {
  // Candidates in priority order (avoid shelling out)
  const storeDir = path.resolve(process.cwd(), "../../node_modules/.pnpm");
  const candidates: string[] = [];
  if (fs.existsSync(storeDir)) {
    try {
      const tsxDirs = fs.readdirSync(storeDir).filter((d) => d.startsWith("tsx@"));
      for (const dir of tsxDirs.sort().reverse()) {
        candidates.push(path.resolve(storeDir, dir, "node_modules", "tsx", "dist", "esm", "index.mjs"));
      }
    } catch {
      // fall through
    }
  }
  // Fallback: common pnpm store location
  candidates.push(
    path.resolve(process.cwd(), "../../node_modules/tsx/dist/esm/index.mjs"),
    path.resolve(process.cwd(), "../../node_modules/.pnpm/tsx@4.23.0/node_modules/tsx/dist/esm/index.mjs"),
  );

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      // On Windows, --import requires a file:// URL (absolute paths with C:
      // are interpreted as a protocol).
      return process.platform === "win32" ? pathToFileURL(c).href : c;
    }
  }

  // Last resort: try to resolve via node's module system
  throw new Error(
    "Cannot find tsx ESM loader.  Install tsx at the workspace root: pnpm add -D -w tsx",
  );
}

/**
 * Poll the server until it responds or we exhaust retries.
 *
 * There is no dedicated health endpoint.  We use a lightweight request to the
 * root path — any response (even 404) proves the server is listening.
 */
async function waitForHealth(
  baseUrl: string,
  retries: number = HEALTH_CHECK_RETRIES,
): Promise<void> {
  const url = baseUrl.replace(/\/$/, "");

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        // Short timeout so we retry quickly
        signal: AbortSignal.timeout(3000),
      });
      // Any response (even 4xx/5xx) means the server is listening
      if (response.status !== 0) return;
    } catch {
      // Server not ready yet — retry
    }
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
  }

  throw new Error(
    `Server at ${baseUrl} did not respond after ${retries * HEALTH_CHECK_INTERVAL_MS}ms`,
  );
}

/**
 * Kill a process and all its children.
 */
function killProcess(proc: ChildProcess): void {
  if (!proc || proc.killed) return;

  try {
    // On Windows, taskkill kills the process tree
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"]);
    } else {
      proc.kill("SIGTERM");
      // Give it a moment, then force kill
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }
  } catch {
    // Already dead
  }
}

// ---------------------------------------------------------------------------
// TestServer
// ---------------------------------------------------------------------------

export interface TestServerOptions {
  /** Port to use (default: 3001) */
  port?: number;
  /** Database URL (default: test database) */
  databaseUrl?: string;
  /** Start strategy */
  startMode?: "auto" | "external" | "spawn";
}

export class TestServer {
  private _baseUrl: string;
  private _process: ChildProcess | null = null;
  private _startedByUs = false;

  constructor(private options: TestServerOptions = {}) {
    const port = options.port ?? (Number(process.env.TEST_SERVER_PORT) || DEFAULT_PORT);
    this._baseUrl = `http://localhost:${port}`;
  }

  /** The server's base URL (set after start()). */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /** Whether this harness started the server (vs. reusing an existing one). */
  get startedByUs(): boolean {
    return this._startedByUs;
  }

  /**
   * Start the server.
   *
   * - "auto": try existing server first; spawn if unreachable
   * - "external": use existing server; throw if unreachable
   * - "spawn": always spawn a fresh server
   */
  async start(): Promise<void> {
    const mode =
      this.options.startMode ??
      process.env.TEST_SERVER_START ??
      "auto";

    if (mode === "external") {
      await waitForHealth(this._baseUrl);
      return;
    }

    if (mode === "spawn") {
      await this.spawnServer();
      return;
    }

    // "auto": try existing first
    try {
      await waitForHealth(this._baseUrl, 3);
      return; // existing server is running
    } catch {
      // Fall through to spawn
    }

    await this.spawnServer();
  }

  /**
   * Stop the server (only if we started it).
   */
  async stop(): Promise<void> {
    if (this._process && !this._process.killed) {
      killProcess(this._process);
      this._process = null;
      this._startedByUs = false;
    }
  }

  private async spawnServer(): Promise<void> {
    const serverDir = resolveServerDir();
    const compiledMain = path.join(serverDir, "dist", "apps", "server", "src", "main.js");
    const port = this.options.port ?? (Number(process.env.TEST_SERVER_PORT) || DEFAULT_PORT);

    // Determine how to run the server.
    // The compiled output from `nest build` goes to dist/apps/server/src/main.js.
    const compiledExists = fs.existsSync(compiledMain);
    let command: string;
    let args: string[];
    let shell: boolean;

    if (compiledExists) {
      // Run compiled output via node --import with tsx's ESM loader so
      // extensionless imports (e.g. './app.module' → './app.module.js')
      // resolve correctly.  We use the full filesystem path because tsx
      // is only in the pnpm store, not on the module resolution path.
      const tsxEsmPath = resolveTsxEsmPath();
      command = process.execPath;
      args = ["--import", tsxEsmPath, compiledMain];
      shell = false;
    } else {
      // Build first, then run the compiled output.
      // On Windows, pnpm/pnpm.cmd needs shell: true to resolve the .cmd extension.
      const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
      await new Promise<void>((resolveBuild, rejectBuild) => {
        const buildProcess = spawn(pnpmCmd, ["build"], {
          cwd: serverDir,
          env: { ...process.env, NODE_ENV: "test" },
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        });
        const buildLog: string[] = [];
        buildProcess.stdout?.on("data", (chunk: Buffer) => buildLog.push(chunk.toString()));
        buildProcess.stderr?.on("data", (chunk: Buffer) => buildLog.push(chunk.toString()));
        buildProcess.on("close", (code) => {
          if (code === 0) resolveBuild();
          else rejectBuild(new Error(`Server build failed with exit code ${code}\n${buildLog.join("").slice(0, 2000)}`));
        });
        buildProcess.on("error", rejectBuild);
      });
      // Now run compiled output via node --import with tsx's ESM loader
      const tsxEsmPath = resolveTsxEsmPath();
      command = process.execPath;
      args = ["--import", tsxEsmPath, compiledMain];
      shell = false;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: this.options.databaseUrl ?? TEST_DATABASE_URL,
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "test-access-secret-key-32-chars-minimum!!",
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-key-32-chars-minimum",
      JWT_ACCESS_TTL_SECONDS: process.env.JWT_ACCESS_TTL_SECONDS ?? "900",
      JWT_REFRESH_TTL_SECONDS: process.env.JWT_REFRESH_TTL_SECONDS ?? "604800",
      REDIS_URL: process.env.REDIS_URL ?? "",
    };

    this._process = spawn(command, args, {
      cwd: serverDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell,
    });

    this._startedByUs = true;

    // Capture startup logs for debugging
    const logBuffer: string[] = [];
    this._process.stdout?.on("data", (chunk: Buffer) => {
      logBuffer.push(chunk.toString());
    });
    this._process.stderr?.on("data", (chunk: Buffer) => {
      logBuffer.push(chunk.toString());
    });

    // Wait for server to become healthy
    try {
      await waitForHealth(this._baseUrl);
    } catch (err) {
      // Kill the process and dump logs
      killProcess(this._process);
      this._process = null;
      const logs = logBuffer.join("\n").slice(0, 2000);
      throw new Error(
        `Server failed to start.\nLogs:\n${logs}\n\nOriginal error: ${(err as Error).message}`,
      );
    }
  }
}
