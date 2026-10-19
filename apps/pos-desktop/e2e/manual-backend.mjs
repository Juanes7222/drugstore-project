/**
 * One-off diagnostic launcher for the pos e2e backend.
 *
 * Starts the server bundle with the same env real-backend.ts uses, waits for
 * /health-equivalent readiness, signs in with the SYNC workstation identity,
 * and probes GET /catalog/tax-schemes so the suite can verify the server
 * actually returns the fixture row instead of guessing from spec failures.
 */
import { spawn } from "node:child_process";
import { openSync, closeSync, mkdirSync } from "node:fs";
import path from "node:path";

const APP_DIR = process.cwd();
const SERVER_DIR = path.resolve(APP_DIR, "../server");
const BASE_URL = "http://localhost:3000";
const LOG_DIR = path.join(APP_DIR, "e2e", ".artifacts");
const SERVER_LOG = path.join(LOG_DIR, "server.log");

const APP_DATABASE_URL =
  "postgresql://pharmacy_app:pharmacy_app@localhost:5433/pharmacy_test_db";

const env = {
  ...process.env,
  DATABASE_URL: APP_DATABASE_URL,
  APP_DATABASE_URL,
  JWT_ACCESS_SECRET: "e2e-access-secret-key-32-chars-minimum!!",
  JWT_REFRESH_SECRET: "e2e-refresh-secret-key-32-chars-minimum",
  JWT_ACCESS_TTL_SECONDS: "900",
  JWT_REFRESH_TTL_SECONDS: "604800",
  PORT: "3000",
  NODE_ENV: "test",
  REDIS_URL: "redis://localhost:6380",
  CORS_ORIGIN: "*",
  SWAGGER_ENABLED: "false",
};

mkdirSync(LOG_DIR, { recursive: true });
closeSync(openSync(SERVER_LOG, "w"));

const child = spawn("npx", ["tsx", "dist/apps/server/src/main.js"], {
  cwd: SERVER_DIR,
  env,
  stdio: ["ignore", openSync(SERVER_LOG, "a"), openSync(SERVER_LOG, "a")],
  shell: process.platform === "win32",
});

console.log(`[manual-backend] spawned pid=${child.pid}`);

async function waitReady(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`, { method: "GET" });
      if (res.status < 502) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ready = await waitReady(90_000);
console.log(`[manual-backend] ready=${ready}`);
if (!ready) {
  console.log("[manual-backend] server log tail:");
  console.log((await import("node:fs")).readFileSync(SERVER_LOG, "utf8").slice(-2000));
  process.exit(1);
}

// Sign in as the workstation fixture account the catalog sync uses.
// The suite's accounts live in apps/server/test/pos-e2e/baseline.ts — the
// ADMIN one used by products-flow is admin@pos-e2e.local / 123456.
const loginRes = await fetch(`${BASE_URL}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    identifier: "admin@pos-e2e.local",
    password: "123456",
  }),
});
console.log(`[manual-backend] login status=${loginRes.status}`);
const loginBody = await loginRes.json().catch(() => ({}));
const accessToken =
  loginBody.accessToken ??
  loginBody.access_token ??
  loginBody.data?.accessToken;
console.log(`[manual-backend] got access token: ${Boolean(accessToken)}`);

const tsRes = await fetch(`${BASE_URL}/catalog/tax-schemes`, {
  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
});
console.log(`[manual-backend] tax-schemes status=${tsRes.status}`);
const tsBody = await tsRes.json().catch(() => null);
console.log(
  `[manual-backend] tax-schemes body: ${JSON.stringify(tsBody)?.slice(0, 600)}`,
);

// Also probe the authenticated categories endpoint the same pull uses.
const catRes = await fetch(`${BASE_URL}/catalog/categories`, {
  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
});
console.log(`[manual-backend] categories status=${catRes.status}`);

child.on("exit", (code) => console.log(`[manual-backend] server exited ${code}`));
// Keep alive for manual inspection, then exit.
setTimeout(() => {
  spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true });
  process.exit(0);
}, 3000);
