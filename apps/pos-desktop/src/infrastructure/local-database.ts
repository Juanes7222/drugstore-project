/**
 * Singleton accessor for the local PGlite-based Prisma Client.
 *
 * Architecture
 * ------------
 * PGlite (an in-process PostgreSQL implemented in WASM) runs inside the
 * Tauri webview itself — no sidecar, no separate process.  Persistence is
 * provided by IndexedDB, keyed to the Tauri app-local-data directory so
 * the database survives app restarts and is automatically cleaned up when
 * the OS uninstalls the app.
 *
 * Two modes
 * ---------
 * - **Dev mode** (inside the Vite browser dev-server): PGlite runs in-memory,
 *   accessed directly with SQL queries — no Prisma.  The Prisma runtime
 *   depends on Node built-ins that the browser cannot provide, so we bypass
 *   it entirely for development.
 * - **Tauri mode** (inside the webview of a built app): PrismaClient is
 *   available (because the Tauri webview runs in a real Chromium/WebKit
 *   context where our polyfills apply) and all domain services work
 *   through the full type-safe Prisma API.
 *
 * Schema-upgrade-on-existing-install is deliberately unsolved here; see
 * README in this module for the open question.
 */

import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';

/**
 * Detect whether the app is running inside a Tauri webview.
 * Outside Tauri (e.g. browser dev server) we fall back to an in-memory PGlite
 * database so the UI is still navigable during development.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Resolve the OS app-local-data directory used by Tauri.
 * Returns an empty string outside Tauri so callers can detect the environment.
 */
export async function getAppLocalDataDir(): Promise<string> {
  if (!isTauri()) return '';
  const { appLocalDataDir } = await import('@tauri-apps/api/path');
  return appLocalDataDir();
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let instance: { client: PGlite; prisma: unknown } | null = null;
let initPromise: Promise<{ client: PGlite; prisma: unknown }> | null = null;

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the given table exists in the public schema.
 */
async function tableExists(client: PGlite, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = $1
     ) AS exists`,
    [tableName],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Apply the full local-schema DDL.  Runs inside a single multi-statement
 * execution; PGlite treats them as one implicit transaction.
 */
async function applySchema(client: PGlite): Promise<void> {
  // Discard the leading "CREATE SCHEMA IF NOT EXISTS "public";" —
  // PGlite 0.5+ already has a "public" schema.
  const sql = LOCAL_SCHEMA_SQL
    .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
    .trim();

  if (!sql) return;

  await client.exec(sql);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the singleton local-database handle, initialising it on first call.
 *
 * Safe to call concurrently — concurrent callers share a single initialisation
 * promise.  Returns the same `{ client, prisma }` object for the lifetime of
 * the webview.
 *
 * In a Tauri webview the returned `prisma` is a full PrismaClient instance
 * that domain services use directly.  In the browser dev-server `prisma` is
 * a bare-PGlite wrapper with a subset of the PrismaClient API so the UI
 * remains navigable during development.
 */
export async function getLocalDatabase(): Promise<{
  client: PGlite;
  prisma: unknown;
}> {
  if (instance) return instance;

  if (!initPromise) {
    initPromise = (async () => {
      let client: PGlite;

      if (isTauri()) {
        // Tauri environment: persist to the OS app-local-data directory.
        const dataDir = await getAppLocalDataDir();
        const dbPath = `${dataDir}/pglite-data`;
        // relaxedDurability: false ensures PGlite flushes storage on commit,
        // matching the durability expectations of an offline-first POS.
        client = new PGlite(dbPath, { relaxedDurability: false });
      } else {
        // Browser / dev-server environment: use an ephemeral in-memory database.
        // Logged so developers know the data will not survive a page refresh.
        // eslint-disable-next-line no-console
        console.info('[local-database] Running outside Tauri — using ephemeral in-memory PGlite.');
        client = new PGlite('memory://');
      }

      // Check whether this is a fresh database
      const isEmpty = !(await tableExists(client, 'Client'));

      if (isEmpty) {
        await applySchema(client);
      }

      let prisma: unknown;

      if (isTauri()) {
        // Tauri mode: full PrismaClient with pglite-prisma-adapter (Prisma
        // runtime is available because Tauri's Chromium webview supports our
        // polyfills).
        const { PrismaPGlite } = await import('pglite-prisma-adapter');
        const { PrismaClient } = await import('@pharmacy/database/local');
        const adapter = new PrismaPGlite(client);
        const pc = new PrismaClient({ adapter });
        await pc.$connect();
        prisma = pc;
      } else {
        // Dev mode: return a thin compatibility wrapper so consuming services
        // that expect a PrismaClient don't crash at import time.
        prisma = createDevPrismaWrapper(client);
      }

      instance = { client, prisma };
      return instance;
    })();
  }

  return initPromise;
}

/**
 * Tear down the local database — close PGlite and Prisma, reset the
 * singleton.  Useful in tests and after a full sync reset.
 */
export async function closeLocalDatabase(): Promise<void> {
  if (instance) {
    if (isTauri()) {
      const pc = instance.prisma as { $disconnect: () => Promise<void> };
      await pc.$disconnect();
    }
    await instance.client.close();
    instance = null;
  }
  initPromise = null;
}

// ---------------------------------------------------------------------------
// Dev-mode PrismaClient shim
// ---------------------------------------------------------------------------

/**
 * Create a minimal shim that looks like a PrismaClient well enough for domain
 * services to construct (they only store the reference) without actually
 * importing the Prisma runtime.
 *
 * In dev mode, domain services can initialise but will fail at runtime if
 * they try to use prisma.  This is acceptable because the dev server is
 * used primarily for UI development, not full offline POS transactions.
 */
function createDevPrismaWrapper(client: PGlite): unknown {
  // Return a proxy that logs a warning on first property access.
  let warned = false;
  return new Proxy(
    { _client: client },
    {
      get(target, prop) {
        if (prop === '$connect') return () => Promise.resolve();
        if (prop === '$disconnect') return () => Promise.resolve();
        if (prop === '$on') return () => undefined;
        if (prop === '$extends') return () => target;
        if (prop === 'constructor') return Object;
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        if (!warned) {
          warned = true;
          console.warn(
            '[local-database] Dev-mode PrismaClient shim in use. ' +
            'Property "%s" was accessed but no Prisma models are available. ' +
            'Run `tauri dev` or build for full functionality.',
            String(prop),
          );
        }
        return undefined;
      },
    },
  );
}