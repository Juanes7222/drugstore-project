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
 * Schema version — bump this when LOCAL_SCHEMA_SQL changes.
 * applyMissingSchema runs only when stored version differs.
 */
const SCHEMA_VERSION = 1;

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
// Schema-version tracking
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
 * Read the stored schema version, or null if never set.
 */
async function getStoredSchemaVersion(client: PGlite): Promise<number | null> {
  try {
    const result = await client.query<{ value: string }>(
      `SELECT value FROM "_SchemaMeta" WHERE key = 'schema_version'`,
    );
    return result.rows.length > 0 ? Number(result.rows[0].value) : null;
  } catch {
    return null;
  }
}

/**
 * Write (upsert) the current schema version so subsequent startups can skip
 * `applyMissingSchema` when nothing changed.
 */
async function storeSchemaVersion(client: PGlite, version: number): Promise<void> {
  // DELETE + INSERT is simpler than ON CONFLICT and avoids any PGlite
  // compatibility risk with PostgreSQL upsert syntax.
  await client.query(`DELETE FROM "_SchemaMeta" WHERE key = 'schema_version'`);
  await client.query(
    `INSERT INTO "_SchemaMeta" (key, value) VALUES ('schema_version', $1)`,
    [String(version)],
  );
}

/**
 * Apply missing schema objects to an existing database.
 *
 * Strategy (instead of fighting with Prisma's generated DDL line-by-line):
 *
 *  1. Parse every `CREATE TABLE "Name" (...)` from the DDL to build a map
 *     of expected columns.
 *  2. Query `information_schema.columns` to learn what already exists.
 *  3. For any column the DDL declares but the live table lacks, issue
 *     `ALTER TABLE ADD COLUMN` first — this is safe and idempotent.
 *  4. Then execute each DDL statement individually, silently skipping
 *     "already exists" errors.  Because all columns are already in place,
 *     the `ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY` statements will no
 *     longer fail with "referenced column does not exist".
 *
 * This handles any schema evolution where columns are added to an
 * already-deployed table — not just `receiptTemplateId`, but any future
 * addition as well.
 */
async function applyMissingSchema(client: PGlite): Promise<void> {
  const sql = LOCAL_SCHEMA_SQL
    .replace(/^--\s*CreateSchema[\s\S]*?CREATE SCHEMA IF NOT EXISTS "public";\s*/m, '')
    .trim();

  if (!sql) return;

  const statements = splitSqlStatements(sql);

  // ---- Phase 1: introspect and backfill missing columns ----
  const expectedColumns = new Map<string, Map<string, string>>();
  for (const [i, stmt] of statements.entries()) {
    // NOTE: statements after splitSqlStatements often start with a
    // `-- CreateTable` comment.  The `^` anchor would reject them, so we
    // search for "CREATE TABLE" anywhere in the statement.
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
    `[local-database] Phase 1: ${expectedColumns.size} tables in DDL, checking information_schema...`,
  );

  if (expectedColumns.size > 0) {
    let existingKeys: Set<string>;
    try {
      existingKeys = await getExistingColumnKeys(client, [...expectedColumns.keys()]);
      // eslint-disable-next-line no-console
      console.log(`[local-database] Phase 1: found ${existingKeys.size} existing column keys in information_schema`);
    } catch (infoErr: unknown) {
      // eslint-disable-next-line no-console
      console.error('[local-database] Phase 1: FAILED to query information_schema.columns:', infoErr);
      throw infoErr;
    }

    for (const [tableName, cols] of expectedColumns) {
      for (const [colName, colDef] of cols) {
        const key = `"${tableName}"."${colName}"`;
        if (existingKeys.has(key)) continue; // Column already present.

        // eslint-disable-next-line no-console
        console.log(
          `[local-database] Backfilling column "${colName}" on "${tableName}"...`,
        );
        try {
          // eslint-disable-next-line no-await-in-loop
          await client.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${colDef};`);
        } catch (backfillErr: unknown) {
          const bMsg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
          // "already exists" / "duplicate column" can occur in a race where
          // the column was added between our query and our ALTER.
          if (
            bMsg.includes('already exists') ||
            bMsg.includes('duplicate column')
          ) {
            continue;
          }
          // Unexpected error — surface during startup.
          throw backfillErr;
        }
      }
    }
  }

  // ---- Phase 2: apply the DDL statements individually ----
  // All missing columns are now in place, so FK ALTER TABLE statements
  // should succeed.  We still skip "already exists" for tables, enums,
  // indexes, and constraints that are already present.
  // eslint-disable-next-line no-console
  console.log(`[local-database] Phase 2: executing ${statements.length} DDL statements...`);
  for (const [i, stmt] of statements.entries()) {
    const isFk = /ALTER\s+TABLE.*ADD\s+CONSTRAINT.*FOREIGN\s+KEY/i.test(stmt);
    if (isFk) {
      // eslint-disable-next-line no-console
      console.log(`[local-database] Phase 2 [${i}/${statements.length}] FK: ${stmt.slice(0, 120)}...`);
    }
    try {
      await client.exec(stmt);
      if (isFk) {
        // eslint-disable-next-line no-console
        console.log(`[local-database] Phase 2 [${i}/${statements.length}] FK succeeded.`);
      }
    } catch (err: unknown) {
      if (isFk) {
        // eslint-disable-next-line no-console
        console.error(`[local-database] Phase 2 [${i}/${statements.length}] FK FAILED:`, err);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('already exists') ||
        msg.includes('duplicate key') ||
        msg.includes('duplicate table') ||
        msg.includes('duplicate object')
      ) {
        // Object already exists — skip silently.
        continue;
      }
      // Unexpected error — surface during startup.
      throw err;
    }
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
      await ensureSchemaMetaTable(client);
      const isEmpty = !(await tableExists(client, 'Client'));

      if (isEmpty) {
        // Fresh database — apply full schema, store version.
        // eslint-disable-next-line no-console
        console.log('[local-database] Fresh database — applying full schema...');
        await applySchema(client);
        await storeSchemaVersion(client, SCHEMA_VERSION);
        // eslint-disable-next-line no-console
        console.log(`[local-database] Database initialized (schema v${SCHEMA_VERSION}).`);
      } else {
        const storedVersion = await getStoredSchemaVersion(client);

        if (storedVersion === SCHEMA_VERSION) {
          // Schema is current — skip schema work entirely.  Single-line OK.
          // eslint-disable-next-line no-console
          console.log(`[local-database] Database ready (schema v${SCHEMA_VERSION}).`);
        } else {
          // Version mismatch (null, older, or newer) — apply missing schema.
          // eslint-disable-next-line no-console
          console.log(
            `[local-database] Schema version change: v${storedVersion ?? '?'} → v${SCHEMA_VERSION}. Applying missing schema...`,
          );
          await applyMissingSchema(client);
          await storeSchemaVersion(client, SCHEMA_VERSION);
          // eslint-disable-next-line no-console
          console.log(`[local-database] Schema upgraded to v${SCHEMA_VERSION}.`);
        }
      }

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