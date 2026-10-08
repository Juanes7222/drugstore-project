/**
 * Runs the REAL NestJS backend for the Tauri e2e suite.
 *
 * The specs drive the actual desktop binary against the actual server process,
 * talking to the actual Postgres and Redis containers. There is no HTTP mock:
 * a hand-written mock is a second, unverified copy of the API contract, so any
 * change to a real response shape left the mock green while production broke.
 * Sharing nothing but the HTTP wire is what makes a drift fail here.
 *
 * The server runs as a child process (`tsx dist/apps/server/src/main.js`)
 * rather than being mounted in-process because that is the production bootstrap
 * path: helmet, CORS, the exception filters, the BigInt JSON patch and the
 * ConfigModule env validation all apply. It also sidesteps the fact that the
 * server sources resolve `@/` to apps/server/src while the WDIO runner would
 * resolve the same alias to the POS source tree.
 *
 * Teardown is deliberately aggressive. `tsx` spawns a grandchild, so killing
 * only the direct child leaves a listener on the port and the next run fails
 * with EADDRINUSE; the process tree is killed instead.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
// Single source of truth for the file name the app converges toward; importing
// it beats duplicating a literal that a rename in the app would silently break.
import { WORKSTATION_ID_FILE_NAME } from "../src/infrastructure/workstation-identity";

const APP_DIR = process.cwd();
const SERVER_DIR = path.resolve(APP_DIR, "../server");
const SERVER_ENTRY = "dist/apps/server/src/main.js";
const FIXTURE_RESET_ENTRY = "test/pos-e2e/reset.ts";

/** Port the POS is built against (VITE_API_BASE_URL in the e2e build). */
const SERVER_PORT = 3000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

/** Both URLs point at the RLS app role: the app must never bypass tenant policies. */
const APP_DATABASE_URL =
  "postgresql://pharmacy_app:pharmacy_app@localhost:5433/pharmacy_test_db";

/** Owner role: seeds fixtures and bypasses RLS, so the harness is not policed. */
const OWNER_DATABASE_URL =
  process.env.POS_E2E_OWNER_DATABASE_URL ??
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";

const LOG_DIR = path.join(APP_DIR, "e2e", ".artifacts");
const SERVER_LOG = path.join(LOG_DIR, "server.log");

function assertRunningFromAppDir(): void {
  const pkg = path.join(APP_DIR, "package.json");
  const result = spawnSync(process.execPath, ["-e", "1"], { cwd: APP_DIR });
  if (result.error || !pkg) {
    throw new Error(
      `e2e harness must run from apps/pos-desktop (cwd: ${APP_DIR})`,
    );
  }
}

/**
 * Environment for the server process.
 *
 * DATABASE_URL and APP_DATABASE_URL both carry the app role: PrismaService
 * prefers APP_DATABASE_URL, and setting DATABASE_URL to the superuser as well
 * would create a silent path that skips row level security — exactly the class
 * of bug this suite exists to catch.
 */
function serverEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: APP_DATABASE_URL,
    APP_DATABASE_URL,
    JWT_ACCESS_SECRET: "e2e-access-secret-key-32-chars-minimum!!",
    JWT_REFRESH_SECRET: "e2e-refresh-secret-key-32-chars-minimum",
    JWT_ACCESS_TTL_SECONDS: "900",
    JWT_REFRESH_TTL_SECONDS: "604800",
    PORT: String(SERVER_PORT),
    NODE_ENV: "test",
    REDIS_URL: "redis://localhost:6380",
    CORS_ORIGIN: "*",
    SWAGGER_ENABLED: "false",
  };
}

let serverProcess: ChildProcess | null = null;
let tornDown = false;

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/**
 * Kill whatever holds the API port.
 *
 * An interrupted run can leave the server (or an orphaned tsx) listening, which
 * makes the next start fail with EADDRINUSE while the app shows a connection
 * error that looks like an application bug.
 */
function freePort(port: number): void {
  if (process.platform === "win32") {
    const listing = spawnSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).stdout;
    if (!listing) return;
    for (const line of listing.split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !line.includes("LISTENING")) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) killTree(Number(pid));
    }
    return;
  }
  const pids = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).stdout;
  for (const pid of (pids ?? "").split(/\s+/).filter(Boolean)) {
    killTree(Number(pid));
  }
}

/**
 * Wait until the API answers.
 *
 * A reachable listener means Nest finished provider initialisation, so the
 * Prisma connection is already established — no separate readiness probe is
 * needed. Any HTTP status counts: 400 from the validation pipe and 401 from
 * bad credentials both prove routing, filters and the database are alive.
 */
async function waitUntilReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";

  while (Date.now() < deadline) {
    if (
      serverProcess?.exitCode !== null &&
      serverProcess?.exitCode !== undefined
    ) {
      throw new Error(
        `backend exited with code ${serverProcess.exitCode} before becoming ready`,
      );
    }
    try {
      await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: "probe", secret: "probe" }),
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(
    `backend did not become ready on ${BASE_URL} within ${timeoutMs}ms. Last error: ${lastError}`,
  );
}

/**
 * Bring up the test database and Redis, and provision the schema.
 *
 * Without this the suite silently depends on someone having started
 * docker-compose.test.yml and migrated by hand — the exact gap the server e2e
 * workflow had before it grew a globalSetup. Mirrors what the server suite
 * does in apps/server/test/global-setup.cjs, but from the runner that owns the
 * whole e2e lifecycle.
 */
export function ensureTestInfrastructure(): void {
  const repoRoot = path.resolve(APP_DIR, "../..");
  const composeFile = path.join(repoRoot, "docker-compose.test.yml");

  const up = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "up", "-d", "--wait"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  if (up.status !== 0) {
    throw new Error(
      [
        `could not start the e2e infrastructure (${composeFile})`,
        up.error?.message,
        up.stdout,
        up.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // Migrations run as the owner role. Skipped for databases that are not
  // recognisably a test database so a misconfigured DATABASE_URL cannot wipe
  // a real one.
  const databaseUrl = OWNER_DATABASE_URL;
  if (!/test/i.test(new URL(databaseUrl).pathname)) {
    throw new Error(
      `refusing to migrate "${databaseUrl}" — it does not look like a test database`,
    );
  }

  const prismaCli = path.join(SERVER_DIR, "node_modules/prisma/build/index.js");
  const prismaConfig = path.join(
    repoRoot,
    "packages/database/prisma.full.config.ts",
  );
  const env = { ...process.env, DATABASE_URL: databaseUrl };

  const migrate = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--config", prismaConfig],
    {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (migrate.status !== 0) {
    throw new Error(
      ["prisma migrate deploy failed", migrate.stdout, migrate.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // The RLS app role is created by a migration without a password; the server
  // connects as that role, so it needs one. Idempotent.
  const appPassword = new URL(APP_DATABASE_URL).password;
  const sqlFile = path.join(LOG_DIR, "app-role.sql");
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(
    sqlFile,
    `ALTER ROLE pharmacy_app WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}';\n`,
  );
  const grant = spawnSync(
    process.execPath,
    [prismaCli, "db", "execute", "--file", sqlFile, "--config", prismaConfig],
    {
      cwd: SERVER_DIR,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (grant.status !== 0) {
    throw new Error(
      ["could not grant the app role a password", grant.stdout, grant.stderr]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/**
 * Wipe the WebView2 profile so every run starts from an empty app.
 *
 * The profile holds two things that otherwise leak between runs: the PGlite
 * IndexedDB database (catalogue, sales, sync queue) and the session/cached-user
 * records in localStorage. A cached user is enough to wedge boot on its own —
 * the app auto-logs-in from the cache before any spec runs, sends an identifier
 * the real server rejects with 400, and never leaves the "Cargando..." screen,
 * so every spec fails on an element that never appears.
 *
 * Only this app's profile is removed, keyed by the Tauri identifier, so a
 * developer's installed copy and other WebView2 apps are untouched.
 */
export function resetWebViewProfile(): void {
  const identifier = tauriIdentifier();
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";

  const localDir =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
          identifier,
        )
      : process.platform === "darwin"
        ? path.join(home, "Library", "Caches", identifier)
        : path.join(
            process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"),
            identifier,
          );

  // WebView2 on Windows keeps its profile here; the data-dir file the app
  // reads for the workstation id lives under APPDATA and is handled separately.
  rmSync(path.join(localDir, "EBWebView"), { recursive: true, force: true });
}

/** Tauri app identifier, which names both the data dir and the WebView2 profile. */
function tauriIdentifier(): string {
  const config = JSON.parse(
    readFileSync(path.join(APP_DIR, "src-tauri", "tauri.conf.json"), "utf8"),
  ) as { identifier?: string };
  if (!config.identifier) {
    throw new Error("tauri.conf.json has no identifier");
  }
  return config.identifier;
}

/**
 * Pin the machine-wide workstation identity the app will converge to.
 *
 * `VITE_WORKSTATION_ID` is only the import-time value. On boot the app also
 * reads a shared `workstation-id` file from the Tauri app-data dir and
 * converges toward it, taking effect from the NEXT boot — so without this the
 * suite would use the pinned id on its first run and a stale machine id on
 * every run after it. Since the DIAN consecutive is allocated per workstation,
 * that silently breaks fiscal document generation on run two.
 *
 * Writing the file makes both paths agree, so the identity is stable no matter
 * how many times the suite runs or how the local PGlite was reset.
 */
export function pinWorkstationIdentity(workstationId: string): void {
  const identifier = tauriIdentifier();
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";

  const dataDir =
    process.platform === "win32"
      ? path.join(
          process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
          identifier,
        )
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support", identifier)
        : path.join(
            process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
            identifier,
          );

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, WORKSTATION_ID_FILE_NAME), workstationId);
}

/**
 * Start the real backend and block until it serves requests.
 *
 * Fails fast when the server bundle is missing so the error names the real
 * cause instead of surfacing as a mysterious connection error in the specs.
 */
export async function startRealBackend(timeoutMs = 120_000): Promise<void> {
  assertRunningFromAppDir();

  const bundlePath = path.join(SERVER_DIR, SERVER_ENTRY);
  if (!existsSync(bundlePath)) {
    throw new Error(
      `server bundle not found at ${bundlePath}. ` +
        "Run: pnpm turbo run build --filter=@pharmacy/server...",
    );
  }

  await stopRealBackend();
  freePort(SERVER_PORT);

  // The log goes to a file rather than a pipe: an unread pipe buffer fills up
  // and blocks the server mid-run. The directory is created explicitly because
  // openSync does not create parents, and failing here used to abort the whole
  // suite before the backend ever started.
  mkdirSync(LOG_DIR, { recursive: true });
  closeSync(openSync(SERVER_LOG, "w"));

  serverProcess = spawn("npx", ["tsx", SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: serverEnv(),
    stdio: ["ignore", openSync(SERVER_LOG, "a"), openSync(SERVER_LOG, "a")],
    shell: process.platform === "win32",
  });

  serverProcess.on("error", (error) => {
    console.error(`[e2e-backend] failed to spawn: ${error.message}`);
  });

  await waitUntilReady(timeoutMs);
}

/** Stop the backend and release the port. Safe to call more than once. */
export async function stopRealBackend(): Promise<void> {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;

  if (child.pid) killTree(child.pid);
  await new Promise((resolve) => setTimeout(resolve, 250));
  freePort(SERVER_PORT);
}

/**
 * Run a command in apps/server.
 *
 * `shell` is required on Windows: the launchers are `.cmd` shims, and Node
 * cannot spawn those directly (ENOENT). Without it the fixture reset failed
 * with an empty error before the suite even started.
 */
function runInServerDir(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd: SERVER_DIR,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

/**
 * Rebuild the server fixture world (truncate + reseed).
 *
 * Runs in a child process because the fixture needs apps/server's TypeScript
 * path aliases and dependency graph. Synchronous on purpose: a spec must not
 * start driving the UI against a half-reset server.
 */
export function resetServerFixtures(): void {
  const result = runInServerDir("npx", ["tsx", FIXTURE_RESET_ENTRY], {
    ...process.env,
    POS_E2E_OWNER_DATABASE_URL: OWNER_DATABASE_URL,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `server fixture reset failed (status=${result.status}, signal=${result.signal})`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

/**
 * Kill everything an interrupted run can leave behind.
 *
 * `tauri-driver` and `msedgedriver` are spawned by the WebdriverIO service, not
 * by this harness, so stopping the backend alone leaves them holding :4444 and
 * the next run fails to bind. Both are safe to kill by name: they exist only to
 * serve this suite.
 */
export function killLeftoverDrivers(): void {
  for (const port of [4444, 4445]) freePort(port);
  for (const name of ["tauri-driver", "msedgedriver"]) {
    spawnSync("taskkill", ["/F", "/IM", `${name}.exe`], {
      stdio: "ignore",
      shell: true,
    });
  }
}

// A crashed or interrupted runner must not leave the server holding the port.
const emergencyTeardown = (): void => {
  if (tornDown) return;
  tornDown = true;
  if (serverProcess?.pid) killTree(serverProcess.pid);
};
process.once("exit", emergencyTeardown);
process.once("SIGINT", () => {
  emergencyTeardown();
  process.exit(130);
});
process.once("SIGTERM", () => {
  emergencyTeardown();
  process.exit(143);
});
