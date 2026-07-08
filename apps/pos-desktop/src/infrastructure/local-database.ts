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
 * First-run detection
 * -------------------
 * On every access we check whether the "Client" table exists.  If it does
 * not, we assume a fresh database and apply the full DDL from the local
 * (shared-only) Prisma schema.  This is NOT a migration system — an existing
 * database that somehow lacks a table would incorrectly re-apply the DDL and
 * fail.  That scenario should not occur in practice because the only way the
 * database exists is through this same initialization routine.
 *
 * Schema-upgrade-on-existing-install is deliberately unsolved here; see
 * README in this module for the open question.
 */

import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@pharmacy/database/local';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let instance: { client: PGlite; prisma: PrismaClient } | null = null;
let initPromise: Promise<{ client: PGlite; prisma: PrismaClient }> | null = null;

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
 */
export async function getLocalDatabase(): Promise<{
  client: PGlite;
  prisma: PrismaClient;
}> {
  if (instance) return instance;

  if (!initPromise) {
    initPromise = (async () => {
      // Data directory: use a predictable sub-directory of the Tauri
      // app-local-data folder so the database is namespaced to this app
      // and cleaned up on uninstall.
      const { appLocalDataDir } = await import('@tauri-apps/api/path');
      const dataDir = await appLocalDataDir();
      const dbPath = `${dataDir}/pglite-data`;

      const client = new PGlite(dbPath);

      // Check whether this is a fresh database
      const isEmpty = !(await tableExists(client, 'Client'));

      if (isEmpty) {
        await applySchema(client);
      }

      const adapter = new PrismaPGlite(client);
      const prisma = new PrismaClient({ adapter });

      // Warm up the connection (optional — catches misconfiguration early)
      await prisma.$connect();

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
    await instance.prisma.$disconnect();
    await instance.client.close();
    instance = null;
  }
  initPromise = null;
}
