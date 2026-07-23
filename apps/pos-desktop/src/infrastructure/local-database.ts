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
 * Schema-upgrade-on-existing-install uses automatic hash-based detection:
 * `computeSchemaHash` produces a deterministic hash of the processed DDL.
 * On startup the stored hash is compared to the current hash; if they
 * differ, `applyMissingSchema` introspects `information_schema` to find
 * exactly what changed and applies only the missing objects — no manual
 * version bump needed, no "already exists" errors.
 */

import { PGlite } from '@electric-sql/pglite';
import { LOCAL_SCHEMA_SQL } from '@pharmacy/database/local-schema';

/**
 * Compute a deterministic 32-bit hash of the processed schema SQL.
 *
 * Used to detect schema changes automatically — no manual version bump needed.
 * The hash changes when `LOCAL_SCHEMA_SQL` changes (which is auto-generated
 * from the Prisma schema by `generate-local-sql.mjs`), which triggers
 * `applyMissingSchema` on next startup.
 */
function computeSchemaHash(sql: string): string {
  // DJB2 variant — fast, deterministic, no external API needed.
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Coerce to 32-bit integer
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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
 * Split a multi-statement SQL string into individual statements.
 *
 * Splits on `;\n` or `;` followed by whitespace and a `--` comment line,
 * which is the pattern used by Prisma's generated DDL.  Keeps the delimiter
 * attached to each fragment so the caller can pass it to `client.exec()`.
 */
function splitSqlStatements(sql: string): string[] {
  const fragments: string[] = [];
  // Match statement boundaries: a semicolon followed by optional whitespace
  // and either end-of-string or a new comment line (-- or \n).
  // This avoids splitting inside multi-line column constraint definitions.
  const raw = sql.split(/;(?:\s*\n|$)/);

  for (const stmt of raw) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    // Re-attach the delimiter unless this is the last fragment
    fragments.push(trimmed.endsWith(';') ? trimmed : `${trimmed};`);
  }

  // If the split produced only one fragment it means no delimiter was found
  // — return the original SQL as one statement.
  if (fragments.length === 0) return [sql];
  return fragments;
}

/**
 * Apply the full DDL to a fresh database in a single batch.
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

/**
 * Parse a `CREATE TABLE "Name" (...)` DDL statement, extracting the table
 * name and a map of column-name → column-definition fragment.
 *
 * Constraint-only lines (CONSTRAINT, PRIMARY KEY, FOREIGN KEY, UNIQUE, INDEX,
 * CHECK) are excluded — they are not column definitions.
 */
function parseCreateTableColumns(stmt: string): { tableName: string; columnDefs: Map<string, string> } | null {
  const tableMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s*\(/i);
  if (!tableMatch) return null;

  const tableName = tableMatch[1];

  // Extract the body between the first `(` and the last `)`.
  const bodyStart = stmt.indexOf('(');
  const bodyEnd = stmt.lastIndexOf(')');
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) return null;
  const body = stmt.slice(bodyStart + 1, bodyEnd);

  const columnDefs = new Map<string, string>();
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip table-level constraints
    if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|INDEX|CHECK)\b/i.test(trimmed)) continue;
    // Only process lines that start a column definition
    if (trimmed.startsWith('"')) {
      const colDef = trimmed.replace(/,$/, '');
      const colNameMatch = colDef.match(/^"([^"]+)"/);
      if (colNameMatch) {
        columnDefs.set(colNameMatch[1], colDef);
      }
    }
  }

  return { tableName, columnDefs };
}

/**
 * Extract the constraint name from an `ALTER TABLE … ADD CONSTRAINT "name" …` statement.
 */
function parseConstraintName(stmt: string): string | null {
  const match = stmt.match(
    /ALTER\s+TABLE\s+"[^"]+"\s+ADD\s+CONSTRAINT\s+"([^"]+)"/i,
  );
  return match?.[1] ?? null;
}

/**
 * Extract the index name from a `CREATE INDEX "name" ON …` statement.
 */
function parseIndexName(stmt: string): string | null {
  const match = stmt.match(
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([^"\s(]+)"?\s+ON/i,
  );
  return match?.[2] ?? null;
}

/**
 * Extract the type name from a `CREATE TYPE "name" AS ENUM (…)` statement.
 */
function parseEnumTypeName(stmt: string): string | null {
  const match = stmt.match(/CREATE\s+TYPE\s+"([^"]+)"\s+AS\s+ENUM/i);
  return match?.[1] ?? null;
}

/**
 * Extract the enum values from a `CREATE TYPE "name" AS ENUM ('v1', 'v2')` statement.
 * Returns the list of value strings, or null if parsing fails.
 */
function parseEnumValues(stmt: string): string[] | null {
  const match = stmt.match(/CREATE\s+TYPE\s+"[^"]+"\s+AS\s+ENUM\s*\(([^)]+)\)/i);
  if (!match) return null;
  // Split by comma, trim whitespace and surrounding single-quotes.
  return match[1].split(',').map((v) => v.trim().replace(/^'(.*)'$/, '$1'));
}

/**
 * Extract the table name from a `CREATE TABLE "name" (…)` statement.
 */
function parseTableName(stmt: string): string | null {
  const match = stmt.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i,
  );
  return match?.[1] ?? null;
}

/**
 * Query `information_schema.columns` for every column on every table listed
 * in the DDL, returning a Set of `"tableName"."columnName"` keys already
 * present in the database.
 */
async function getExistingColumnKeys(
  client: PGlite,
  tableNames: string[],
): Promise<Set<string>> {
  if (tableNames.length === 0) return new Set();

  // Build a parameterised IN-list of table names
  const placeholders = tableNames.map((_, i) => `$${i + 1}`).join(', ');
  const result = await client.query<{ tableName: string; columnName: string }>(
    `SELECT table_name AS "tableName", column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${placeholders})`,
    tableNames,
  );
  const keys = new Set<string>();
  for (const row of result.rows) {
    keys.add(`"${row.tableName}"."${row.columnName}"`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Pre-check helpers — query what already exists so we avoid "already exists"
// errors instead of catching them.
// ---------------------------------------------------------------------------

/**
 * Query `information_schema.table_constraints` for every FOREIGN KEY
 * constraint name already present in the database.
 */
async function getExistingForeignKeyNames(
  client: PGlite,
): Promise<Set<string>> {
  const result = await client.query<{ constraintName: string }>(
    `SELECT tc.constraint_name AS "constraintName"
       FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'`,
  );
  return new Set(result.rows.map((r) => r.constraintName));
}

/**
 * Query `pg_indexes` for every index name already present.
 */
async function getExistingIndexNames(client: PGlite): Promise<Set<string>> {
  const result = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  return new Set(result.rows.map((r) => r.indexname));
}

/**
 * Query `pg_type` for every enum type name already present.
 */
async function getExistingEnumTypeNames(
  client: PGlite,
): Promise<Set<string>> {
  const result = await client.query<{ typname: string }>(
    `SELECT typname FROM pg_type WHERE typtype = 'e'`,
  );
  return new Set(result.rows.map((r) => r.typname));
}

/**
 * Query `pg_enum` (via `pg_type`) for the current set of values per enum type.
 * Returns a map of lowercase-type-name → Set of value strings.
 */
async function getExistingEnumValues(
  client: PGlite,
): Promise<Map<string, Set<string>>> {
  const result = await client.query<{ typname: string; enumlabel: string }>(
    `SELECT t.typname, e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typtype = 'e'
      ORDER BY t.typname, e.enumsortorder`,
  );
  const map = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const key = row.typname.toLowerCase();
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(row.enumlabel);
  }
  return map;
}

/**
 * Query `information_schema.tables` for every table name already present.
 */
async function getExistingTableNames(client: PGlite): Promise<Set<string>> {
  const result = await client.query<{ tableName: string }>(
    `SELECT table_name AS "tableName"
       FROM information_schema.tables
      WHERE table_schema = 'public'`,
  );
  return new Set(result.rows.map((r) => r.tableName));
}

// ---------------------------------------------------------------------------
// Schema-hash tracking
// ---------------------------------------------------------------------------

/**
 * Ensure the _SchemaMeta key-value table exists.
 */
async function ensureSchemaMetaTable(client: PGlite): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS "_SchemaMeta" (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Read the stored schema hash, or null if never set.
 * Accepts both the new `schema_hash` key and the legacy `schema_version` key
 * so existing databases upgrade gracefully without re-applying unchanged DDL.
 */
async function getStoredSchemaHash(client: PGlite): Promise<string | null> {
  try {
    const result = await client.query<{ value: string }>(
      `SELECT value FROM "_SchemaMeta" WHERE key = 'schema_hash'`,
    );
    if (result.rows.length > 0) return result.rows[0].value;

    // Fallback: migrate from legacy schema_version key
    const legacy = await client.query<{ value: string }>(
      `SELECT value FROM "_SchemaMeta" WHERE key = 'schema_version'`,
    );
    if (legacy.rows.length > 0) {
      // Return the value so applyMissingSchema runs; the new hash will be
      // written afterwards, replacing the legacy key on first upgrade.
      return legacy.rows[0].value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write (upsert) the current schema hash so subsequent startups can skip
 * `applyMissingSchema` when nothing changed.  Cleans up the legacy
 * `schema_version` key if it still exists.
 */
async function storeSchemaHash(
  client: PGlite,
  hash: string,
): Promise<void> {
  // Clean up legacy key in the same transaction
  await client.query(
    `DELETE FROM "_SchemaMeta" WHERE key IN ('schema_version', 'schema_hash')`,
  );
  await client.query(
    `INSERT INTO "_SchemaMeta" (key, value) VALUES ('schema_hash', $1)`,
    [hash],
  );
}

/**
 * Apply missing schema objects to an existing database.
 *
 * Strategy (pre-check-then-execute, not catch-and-skip):
 *
 *  1. Parse all expected objects from the DDL — tables, columns, enums,
 *     indexes, foreign keys.
 *  2. Query `information_schema` / `pg_type` / `pg_indexes` once to
 *     learn what already exists in the live database.
 *  3. Skip every object that already exists; execute DDL only for
 *     genuinely missing objects.
 *  4. Phase 1: backfill missing columns via `ALTER TABLE ADD COLUMN`.
 *  5. Phase 2: execute all remaining DDL statements that still have
 *     work to do (new tables, new enums, new indexes, new FKs).
 *
 * This is entirely automatic — no manual version bump or migration script
 * is needed.  The caller decides when to run based on a schema-hash change.
 */
async function applyMissingSchema(client: PGlite): Promise<void> {
  const sql = LOCAL_SCHEMA_SQL
    .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
    .trim();

  if (!sql) return;

  const statements = splitSqlStatements(sql);

  // ---- Pre-query: what already exists in the live database? ----
  const [existingFks, existingIndexes, existingEnums, existingTables] =
    await Promise.all([
      getExistingForeignKeyNames(client),
      getExistingIndexNames(client),
      getExistingEnumTypeNames(client),
      getExistingTableNames(client),
    ]);

  // ---- Phase 1: introspect and backfill missing columns ----
  const expectedColumns = new Map<string, Map<string, string>>();
  for (const [i, stmt] of statements.entries()) {
    if (!stmt.includes('CREATE TABLE')) {
      continue;
    }
    const parsed = parseCreateTableColumns(stmt);
    if (parsed) {
      // eslint-disable-next-line no-console
      console.log(`[local-database] Phase 1 [${i}]: parsed table "${parsed.tableName}" with ${parsed.columnDefs.size} columns`);
      expectedColumns.set(parsed.tableName, parsed.columnDefs);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[local-database] Phase 1 [${i}]: FAILED to parse CREATE TABLE statement (first 120 chars): "${stmt.slice(0, 120).replace(/\n/g, '\\n')}"`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[local-database] Phase 1: ${expectedColumns.size} tables in DDL, checking information_schema.columns...`,
  );

  if (expectedColumns.size > 0) {
    let existingKeys: Set<string>;
    try {
      existingKeys = await getExistingColumnKeys(client, [...expectedColumns.keys()]);
      // eslint-disable-next-line no-console
      console.log(`[local-database] Phase 1: found ${existingKeys.size} existing column keys in information_schema.columns`);
    } catch (infoErr: unknown) {
      // eslint-disable-next-line no-console
      console.error('[local-database] Phase 1: FAILED to query information_schema.columns:', infoErr);
      throw infoErr;
    }

    for (const [tableName, cols] of expectedColumns) {
      // Skip tables that do not exist yet — Phase 2 creates them.
      if (!existingTables.has(tableName)) {
        // eslint-disable-next-line no-console
        console.log(
          `[local-database] Phase 1: skipping backfill for new table "${tableName}" (will be created in Phase 2)`,
        );
        continue;
      }

      for (const [colName, colDef] of cols) {
        const key = `"${tableName}"."${colName}"`;
        if (existingKeys.has(key)) continue;

        // eslint-disable-next-line no-console
        console.log(
          `[local-database] Backfilling column "${colName}" on "${tableName}"...`,
        );
        try {
          // eslint-disable-next-line no-await-in-loop
          await client.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${colDef};`);
        } catch (backfillErr: unknown) {
          const bMsg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
          if (
            bMsg.includes('already exists') ||
            bMsg.includes('duplicate column')
          ) {
            continue;
          }
          throw backfillErr;
        }
      }
    }
  }

  // ---- Phase 2: apply DDL statements for genuinely missing objects ----
  // Build a skip-list per statement type so we never attempt to create
  // something that already exists.  This avoids noisy "already exists"
  // errors and wasted startup time.
  // eslint-disable-next-line no-console
  console.log(
    `[local-database] Phase 2: checking ${statements.length} DDL statements against existing schema...`,
  );

  let executedCount = 0;
  for (const stmt of statements) {
    // Determine whether this statement is needed based on what exists.
    const shouldSkip = ((): boolean => {
      // Tables
      if (stmt.includes('CREATE TABLE')) {
        const name = parseTableName(stmt);
        return name !== null && existingTables.has(name);
      }

      // Enums
      if (stmt.includes('CREATE TYPE') && stmt.includes('AS ENUM')) {
        const name = parseEnumTypeName(stmt);
        return name !== null && existingEnums.has(name);
      }

      // Indexes
      if (
        stmt.includes('CREATE INDEX') ||
        stmt.includes('CREATE UNIQUE INDEX')
      ) {
        const name = parseIndexName(stmt);
        // PostgreSQL auto-creates indexes for UNIQUE and PK constraints,
        // so the index may exist even though we never explicitly created
        // it.  Check by name.
        return name !== null && existingIndexes.has(name);
      }

      // Foreign keys
      if (
        stmt.includes('ALTER TABLE') &&
        stmt.includes('ADD CONSTRAINT') &&
        stmt.includes('FOREIGN KEY')
      ) {
        const name = parseConstraintName(stmt);
        return name !== null && existingFks.has(name);
      }

      return false;
    })();

    if (shouldSkip) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await client.exec(stmt);
    executedCount++;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[local-database] Phase 2: executed ${executedCount} of ${statements.length} statements (${statements.length - executedCount} skipped).`,
  );

}

/**
 * Backfill missing values on existing enum types.
 *
 * `CREATE TYPE IF NOT EXISTS` is a no-op when the type already exists, so new
 * values added to an existing Prisma enum never get applied by the normal DDL
 * path.  This function compares each `CREATE TYPE ... AS ENUM (...)` DDL
 * statement against the live `pg_enum` values and emits
 * `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for every missing value.
 *
 * Runs every startup — lightweight because it queries `pg_enum` once and
 * compares in-memory sets.
 */
async function backfillEnumValues(client: PGlite): Promise<void> {
  const sql = LOCAL_SCHEMA_SQL
    .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
    .trim();
  if (!sql) return;
  const statements = splitSqlStatements(sql);
  const existingEnumValues = await getExistingEnumValues(client);
  let fixCount = 0;
  for (const stmt of statements) {
    if (!stmt.includes('CREATE TYPE') || !stmt.includes('AS ENUM')) continue;
    const typeName = parseEnumTypeName(stmt);
    if (!typeName) continue;
    const existingVals = existingEnumValues.get(typeName.toLowerCase());
    if (!existingVals) continue;
    const expectedVals = parseEnumValues(stmt);
    if (!expectedVals) continue;
    for (const val of expectedVals) {
      if (existingVals.has(val)) continue;
      // eslint-disable-next-line no-await-in-loop
      await client.exec(
        `ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS '${val.replace(/'/g, "''")}'`,
      );
      fixCount++;
    }
  }
  if (fixCount > 0) {
    console.log(`[local-database] Backfilled ${fixCount} missing enum value(s).`);
  }
}

// ---------------------------------------------------------------------------
// Seed data for offline-first operation
// ---------------------------------------------------------------------------

/**
 * Colombian tax schemes — seeded locally so the app works fully offline.
 * Overwritten by server data when sync runs.
 */
const DEFAULT_TAX_SCHEMES = [
  {
    id: 'seed-iva-19',
    code: 'IVA',
    name: 'IVA 19%',
    taxType: 'IVA',
    rate: 0.19,
  },
  {
    id: 'seed-iva-5',
    code: 'IVA',
    name: 'IVA 5%',
    taxType: 'IVA',
    rate: 0.05,
  },
  {
    id: 'seed-exento',
    code: 'EXENTO',
    name: 'Exento',
    taxType: 'EXENTO',
    rate: 0.0,
  },
  {
    id: 'seed-inc',
    code: 'INC',
    name: 'Impuesto al Consumo (INC)',
    taxType: 'IMPOCONSUMO',
    rate: 0.08,
  },
] as const;

/**
 * Insert default tax schemes into the local TaxScheme table if it is empty.
 *
 * This runs once on first app startup (or first startup after this code is
 * deployed) so the product form always has tax scheme options even when
 * offline.  Server sync later upserts authoritative data by id, overwriting
 * these seed rows without creating duplicates.
 */
async function seedTaxSchemesIfEmpty(client: PGlite): Promise<void> {
  const hasRows = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM "TaxScheme"`,
  );
  if ((hasRows.rows[0]?.count ?? 0) > 0) return;

  const now = new Date().toISOString();

  for (const scheme of DEFAULT_TAX_SCHEMES) {
    await client.query(
      `INSERT INTO "TaxScheme" ("id", "code", "name", "taxType", "rate", "effectiveFrom", "isActive", "createdAt", "updatedAt", "createdById")
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, 'system')
       ON CONFLICT ("id") DO NOTHING`,
      [
        scheme.id,
        scheme.code,
        scheme.name,
        scheme.taxType,
        scheme.rate,
        now,
        now,
        now,
      ],
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `[local-database] Seeded ${DEFAULT_TAX_SCHEMES.length} default tax schemes.`,
  );
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
/**
 * Fetch PGlite WASM and data files from the `/pglite/` path served by the
 * Vite dev-server middleware (dev) or from the copied dist/pglite/ directory
 * (Tauri production build).
 *
 * PGlite normally resolves these files relative to its own module URL via
 * `new URL('./pglite.wasm', import.meta.url)`.  In Tauri's custom protocol
 * environment this URL resolution can fail, or the file may be served with
 * a wrong content type.  Providing the compiled modules explicitly bypasses
 * the URL-resolution path entirely.
 */
async function loadPgliteAssets(): Promise<{
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
}> {
  /**
   * Fetch a URL and return the raw ArrayBuffer, throwing on non-OK responses
   * with a message that includes the HTTP status and the first bytes of the
   * body so we can diagnose content-type mismatches.
   */
  async function fetchBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}` +
          ` (Content-Type: ${response.headers.get('content-type') ?? 'none'})`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await response.arrayBuffer();
    const preview = Array.from(new Uint8Array(buffer.slice(0, 8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    console.log(
      `[local-database] Fetched ${url}: ${buffer.byteLength} bytes,` +
        ` Content-Type: ${contentType}, magic: 0x${preview}`,
    );
    return buffer;
  }

  // Fetch raw buffers first, then compile.  This gives us a chance to inspect
  // the response before WebAssembly.compileStreaming fails on bad content.
  const [pgliteWasmBuffer, initdbWasmBuffer, fsBundleResponse] = await Promise.all([
    fetchBuffer('/pglite/pglite.wasm'),
    fetchBuffer('/pglite/initdb.wasm'),
    fetch('/pglite/pglite.data').then((r) => {
      if (!r.ok)
        throw new Error(
          `Failed to fetch /pglite/pglite.data: ${r.status} ${r.statusText}`,
        );
      return r.blob();
    }),
  ]);

  const pgliteWasmModule = await WebAssembly.compile(pgliteWasmBuffer);
  const initdbWasmModule = await WebAssembly.compile(initdbWasmBuffer);
  const fsBundle = fsBundleResponse;

  return { pgliteWasmModule, initdbWasmModule, fsBundle };
}

export async function getLocalDatabase(): Promise<{
  client: PGlite;
  prisma: unknown;
}> {
  if (instance) return instance;

  if (!initPromise) {
    initPromise = (async () => {
      let client: PGlite;

      // ---- Step 0: install fetch monkey-patch for PGlite asset requests ----
      // PGlite's internal Emscripten runtime and WASM loader use `fetch()` to
      // load .wasm and .data files from URLs relative to `import.meta.url`.
      // In Tauri's webview with Vite dev server, those URLs go through Vite's
      // static-file middleware which may serve .wasm files with a base64-wrapped
      // response instead of raw binary (because Vite's module transform can
      // rewrite .wasm imports).  Our Vite catch-all middleware runs *after*
      // Vite's static server in the Connect stack and never sees these requests.
      //
      // This patch intercepts any fetch whose URL ends with a PGlite asset
      // filename and redirects it to our known-good `/pglite/` URL prefix,
      // which is served with correct binary content by the Vite middleware.
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        const filename = url.split('/').pop()?.split('?')[0] ?? '';
        if (
          filename === 'pglite.wasm' ||
          filename === 'initdb.wasm' ||
          filename === 'pglite.data'
        ) {
          const mappedUrl = `/pglite/${filename}`;
          // eslint-disable-next-line no-console
          console.log(
            `[local-database] fetch redirect: "${url}" → "${mappedUrl}"`,
          );
          return originalFetch(mappedUrl, init);
        }
        return originalFetch(input, init);
      };

      // ---- Step 1: load WASM assets via fetch ----
      // eslint-disable-next-line no-console
      console.log('[local-database] Loading PGlite WASM assets...');
      let pgliteWasmModule: WebAssembly.Module;
      let initdbWasmModule: WebAssembly.Module;
      let fsBundle: Blob;
      try {
        const assets = await loadPgliteAssets();
        pgliteWasmModule = assets.pgliteWasmModule;
        initdbWasmModule = assets.initdbWasmModule;
        fsBundle = assets.fsBundle;
      } catch (assetsError) {
        console.error(
          '[local-database] FAILED to load PGlite WASM assets:',
          assetsError,
        );
        throw assetsError;
      }

      // ---- Step 2: create PGlite instance with pre-compiled modules ----
      // Install a one-shot handler to catch async errors thrown from inside
      // PGlite's internal initdb worker flow that aren't surfaced through the
      // returned promise (e.g. unhandled rejections in Emscripten's WASM init).
      const onRejection = (event: PromiseRejectionEvent) => {
        console.error(
          '[local-database] UNHANDLED REJECTION during PGlite init:',
          event.reason?.constructor?.name ?? typeof event.reason,
          event.reason,
        );
        if (event.reason?.stack) console.error('[local-database] Stack:', event.reason.stack);
        if (event.reason?.cause) console.error('[local-database] Cause:', event.reason.cause);
      };
      window.addEventListener('unhandledrejection', onRejection);
      try {
        if (isTauri()) {
          // Tauri environment: persist via PGlite's IdbFs (IndexedDB-backed
          // filesystem) using an `idb://` prefix.  Bare filesystem paths
          // (e.g. `C:\Users\...`) cause PGlite to select its NodeFS backend,
          // which requires real OS filesystem access unavailable in the
          // webview and triggers crashes via fs.lstat / fs.lstatSync.
          // See: https://github.com/electric-sql/pglite/issues/...
          // relaxedDurability: false ensures PGlite flushes storage on commit,
          // matching the durability expectations of an offline-first POS.
          //
          // Provide explicit WASM modules to avoid URL-resolution failures in
          // Tauri's custom-protocol webview.
          // eslint-disable-next-line no-console
          console.log('[local-database] Creating PGlite (Tauri mode: idb://pglite-data)...');
          client = await PGlite.create('idb://pglite-data', {
            relaxedDurability: false,
            pgliteWasmModule,
            initdbWasmModule,
            fsBundle,
          });
          console.log('[local-database] PGlite created successfully.');
        } else {
          // Browser / dev-server environment: use an ephemeral in-memory database.
          // Logged so developers know the data will not survive a page refresh.
          // eslint-disable-next-line no-console
          console.info('[local-database] Outside Tauri — using in-memory PGlite.');
          client = await PGlite.create('memory://', {
            pgliteWasmModule,
            initdbWasmModule,
            fsBundle,
          });
        }
        window.removeEventListener('unhandledrejection', onRejection);
      } catch (pgliteError) {
        window.removeEventListener('unhandledrejection', onRejection);
        console.error(
          '[local-database] FAILED to create PGlite instance:',
          pgliteError?.constructor?.name ?? typeof pgliteError,
          pgliteError,
        );
        if (pgliteError instanceof Error) {
          console.error('[local-database]   message:', pgliteError.message);
          console.error('[local-database]   stack:', pgliteError.stack);
          if ((pgliteError as any).cause) console.error('[local-database]   cause:', (pgliteError as any).cause);
        }
        throw pgliteError;
      }

      // ---- Schema init / upgrade check ----
      // The schema SQL is auto-generated from the Prisma schema, so we use a
      // deterministic hash to detect changes — no manual version bump needed.
      await ensureSchemaMetaTable(client);
      const processedSql = LOCAL_SCHEMA_SQL
        .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
        .trim();
      const currentHash = computeSchemaHash(processedSql);
      const isEmpty = !(await tableExists(client, 'Client'));

      if (isEmpty) {
        // Fresh database — apply full schema, store hash.
        // eslint-disable-next-line no-console
        console.log('[local-database] Fresh database — applying full schema...');
        await applySchema(client);
        await storeSchemaHash(client, currentHash);
        // eslint-disable-next-line no-console
        console.log(`[local-database] Database initialized (hash=${currentHash}).`);
      } else {
        const storedHash = await getStoredSchemaHash(client);

        if (storedHash === currentHash) {
          // Schema is current — skip schema work entirely.
          // eslint-disable-next-line no-console
          console.log(`[local-database] Database ready (hash=${currentHash}).`);
        } else {
          // Hash mismatch — schema changed since last startup.
          // eslint-disable-next-line no-console
          console.log(
            `[local-database] Schema hash change: "${storedHash ?? '?'}" → "${currentHash}". Applying missing schema...`,
          );
          await applyMissingSchema(client);
          await storeSchemaHash(client, currentHash);
          // eslint-disable-next-line no-console
          console.log(`[local-database] Schema upgraded (hash=${currentHash}).`);
        }
      }

      // ---- Backfill enum values ----
      // Ensures new values added to existing enum types (e.g. PRODUCT_UPDATE
      // added to SyncOperationType) are applied even when the schema hash
      // already matches.  Runs every startup — lightweight single query.
      await backfillEnumValues(client);

      // ---- Seed reference data for offline-first operation ----
      // Seed tax schemes so the product form works without a server.
      // Server sync later overwrites these with authoritative data.
      await seedTaxSchemesIfEmpty(client);

      let prisma: unknown;

      if (isTauri()) {
        // Tauri mode: full PrismaClient with pglite-prisma-adapter (Prisma
        // runtime is available because Tauri's Chromium webview supports our
        // polyfills).
        const { PrismaPGlite } = await import('pglite-prisma-adapter');
        const { PrismaClient } = await import('@pharmacy/database/local');
        const adapter = new PrismaPGlite(client);
        // PGlite has a single connection.  The WriteLock (dbWriteLock)
        // serializes long-running callers (sale confirm, sync steps) so they
        // never contend.  These timeouts are a safety net — not the primary
        // mechanism — so we keep them at modest defaults.
        const pc = new PrismaClient({
          adapter,
          transactionOptions: {
            maxWait: 5_000,  // 5 s to acquire the connection
            timeout:  10_000, // 10 s to complete the transaction
          },
        });
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
  // In-memory model storage so domain services and audit view work
  // during Vite dev without a real PrismaClient.
  const modelData = new Map<string, Array<Record<string, unknown>>>();

  function createModelDelegate(modelName: string) {
    if (!modelData.has(modelName)) {
      modelData.set(modelName, []);
    }
    const data = modelData.get(modelName)!;

    return {
      findMany: (
        args: {
          where?: Record<string, unknown>;
          orderBy?: Record<string, 'asc' | 'desc'>;
          take?: number;
          skip?: number;
        } = {},
      ) => {
        let results = [...data];

        // Apply where filter
        const where = args.where as Record<string, unknown> | undefined;
        if (where && Object.keys(where).length > 0) {
          results = results.filter((item) =>
            (Object.entries(where) as Array<[string, unknown]>).every(([key, value]) => {
              // Handle Prisma-style date range: { gte, lte }
              if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const range = value as Record<string, string>;
                const itemDate = new Date(item[key] as string).getTime();
                if (range.gte && itemDate < new Date(range.gte).getTime()) return false;
                if (range.lte && itemDate > new Date(range.lte).getTime()) return false;
                return true;
              }
              return item[key] === value;
            }),
          );
        }

        // Apply orderBy
        if (args.orderBy) {
          const [[key, dir]] = Object.entries(args.orderBy);
          results.sort((a, b) => {
            const aVal = String(a[key] ?? '');
            const bVal = String(b[key] ?? '');
            return dir === 'desc'
              ? bVal.localeCompare(aVal)
              : aVal.localeCompare(bVal);
          });
        }

        // Apply skip / take
        const skip = args.skip ?? 0;
        const take = args.take ?? results.length;
        return Promise.resolve(results.slice(skip, skip + take));
      },

      count: (args: { where?: Record<string, unknown> } = {}) => {
        const where = args.where as Record<string, unknown> | undefined;
        if (where && Object.keys(where).length > 0) {
          const filtered = data.filter((item) =>
            (Object.entries(where) as Array<[string, unknown]>).every(([key, value]) => {
              if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                const range = value as Record<string, string>;
                const itemDate = new Date(item[key] as string).getTime();
                if (range.gte && itemDate < new Date(range.gte).getTime()) return false;
                if (range.lte && itemDate > new Date(range.lte).getTime()) return false;
                return true;
              }
              return item[key] === value;
            }),
          );
          return Promise.resolve(filtered.length);
        }
        return Promise.resolve(data.length);
      },

      create: (args: { data: Record<string, unknown> }) => {
        const entry = { ...args.data };
        data.push(entry);
        return Promise.resolve(entry);
      },
    };
  }

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
        if (typeof prop === 'string' && prop !== '_client') {
          if (!warned) {
            warned = true;
            console.warn(
              '[local-database] Dev-mode PrismaClient shim in use. ' +
              'Model "%s" uses in-memory store — data lost on reload.',
              String(prop),
            );
          }
          return createModelDelegate(String(prop));
        }
        return undefined;
      },
    },
  );
}