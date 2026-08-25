/**
 * Devtools helper for inspecting the local PGlite database from the browser
 * console. Only loaded in development mode (Vite dev server).
 *
 * Exposes `window.__db` with:
 *   query(sql, params?)       — raw SQL, returns rows
 *   tables()                  — list all user tables
 *   columns(table)            — column names + types
 *   count(table)              — row count for one table
 *   counts()                  — row count for ALL user tables
 *   inspect(table)            — column info + row count
 *   exportJSON(opts?)         — download tables as JSON files
 *   exportAsInsert(table)     — generate INSERT statements
 *   fetchServerTable(table)   — fetch table from server API
 *   diffTable(table, baseUrl?)— compare local vs server
 *   diffTableWithJSON(table, serverRows) — compare local vs pasted JSON
 *   reset(opts?)              — WIPE the whole local database and reload
 *                               (guarded: refuses while unsynced SyncQueue
 *                               operations exist unless { force: true })
 *   client                    — raw PGlite instance
 *   prisma                    — PrismaClient (Tauri mode only)
 */

import type { PGlite } from '@electric-sql/pglite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbDevtools {
  /** Execute raw SQL. Returns rows array. */
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  /** List all user tables (public schema, excluding internal/_ tables). */
  tables(): Promise<string[]>;
  /** Column names + data types for a table. */
  columns(table: string): Promise<ColumnInfo[]>;
  /** Row count for one table. */
  count(table: string): Promise<number>;
  /** Row count for every user table. */
  counts(): Promise<Array<{ table: string; rows: number }>>;
  /** Column info + row count for a table. */
  inspect(table: string): Promise<{ columns: ColumnInfo[]; rowCount: number }>;
  /**
   * Export table(s) as downloadable JSON file(s).
   * If `tables` is omitted, exports ALL user tables as individual files.
   * Returns a list of filenames generated.
   */
  exportJSON(opts?: { tables?: string[]; format?: 'pretty' | 'compact' }): Promise<string[]>;
  /** Generate INSERT statements for a table (useful for seeding another DB). */
  exportAsInsert(table: string, limit?: number): Promise<string>;
  /**
   * Fetch a table from the server's dev API and return rows.
   * Uses VITE_API_BASE_URL by default; pass a different URL to override.
   */
  fetchServerTable(tableName: string, baseUrl?: string): Promise<unknown[]>;
  /**
   * Compare a local table against the server version.
   * Returns a structured diff with added/missing/changed rows.
   */
  diffTable(tableName: string, baseUrl?: string): Promise<TableDiff>;
  /**
   * Compare a local table against server data you already have (e.g. from
   * DBeaver export).  `serverRows` is an array of row objects with matching
   * column names.
   */
  diffTableWithJSON(tableName: string, serverRows: unknown[]): Promise<TableDiff>;
  /**
   * Wipe the entire local database and reload the app into a fresh state.
   * See `resetLocalDatabase` for the safety guards.
   */
  reset(opts?: { force?: boolean }): Promise<void>;
  /** Raw PGlite client reference. */
  readonly client: PGlite;
  /** PrismaClient (only in Tauri mode; undefined in dev Vite). */
  readonly prisma: unknown;
}

export interface ColumnInfo {
  column: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

/** Result of comparing a local table against the server. */
export interface TableDiff {
  table: string;
  /** Columns that exist in one side but not the other. */
  columnDifferences: Array<{
    column: string;
    localType: string | null;
    serverType: string | null;
  }>;
  /** Number of rows only in local. */
  localOnlyCount: number;
  /** Number of rows only in server. */
  serverOnlyCount: number;
  /** Number of rows in both but with different values. */
  changedCount: number;
  /** Sample rows only in local (up to 5). */
  localOnlySample: unknown[];
  /** Sample rows only in server (up to 5). */
  serverOnlySample: unknown[];
  /** Sample rows with changed values (up to 5). */
  changedSample: Array<{ local: unknown; server: unknown }>;
  /** Summary string for quick console read. */
  summary: string;
}

/** Pre-reset scan: what a wipe would destroy that exists nowhere else. */
export interface ResetSafetyReport {
  /**
   * SyncQueue operations the server never confirmed
   * (PENDING / PROCESSING / FAILED / PERMANENT_FAILURE). These are the
   * offline POS's only copy of the sales, shifts, and adjustments they
   * carry — losing them is unrecoverable.
   */
  unsyncedOperations: number;
  /** Breakdown of `unsyncedOperations` by SyncQueue status. */
  byStatus: Record<string, number>;
  /** Total user-table rows the wipe would delete. */
  totalRows: number;
  /** Number of user tables the wipe would drop. */
  tableCount: number;
}

/** Injected side effects of `resetLocalDatabase`, overridable in tests. */
export interface ResetDependencies {
  /** Close Prisma/PGlite singletons so IndexedDB releases its locks. */
  closeDatabase(): Promise<void>;
  /** Delete the persisted PGlite store (no-op outside Tauri). */
  deletePersistentStore(): Promise<void>;
  /** Restart the app into the freshly-created database. */
  reloadPage(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise identifier: double-quote if needed. */
function q(id: string): string {
  return /^[a-z_][a-z0-9_]*$/i.test(id) ? `"${id}"` : `"${id}"`;
}

function escapeLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

/** Check if two values are equal (handles Date, BigInt, nested objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object' && typeof b === 'object') {
    // Date
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }
    // Both are objects — compare keys
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
  }

  return a === b;
}

/**
 * Create a unique key for a row based on its first column (assumed to be
 * the primary key "id").  Falls back to JSON.stringify of all values.
 */
function rowKey(row: Record<string, unknown>): string {
  if (row['id'] !== undefined && row['id'] !== null) {
    return String(row['id']);
  }
  return JSON.stringify(row);
}

/**
 * Compute the difference between two arrays of row objects.
 * Rows are matched by their first-column (id) value.
 */
function computeRowDiff(
  localRows: Record<string, unknown>[],
  serverRows: Record<string, unknown>[],
): {
  localOnly: Record<string, unknown>[];
  serverOnly: Record<string, unknown>[];
  changed: Array<{ local: Record<string, unknown>; server: Record<string, unknown> }>;
} {
  const localMap = new Map<string, Record<string, unknown>>();
  for (const row of localRows) localMap.set(rowKey(row), row);

  const serverMap = new Map<string, Record<string, unknown>>();
  for (const row of serverRows) serverMap.set(rowKey(row), row);

  const localOnly: Record<string, unknown>[] = [];
  const serverOnly: Record<string, unknown>[] = [];
  const changed: Array<{ local: Record<string, unknown>; server: Record<string, unknown> }> = [];

  for (const [key, localRow] of localMap) {
    const serverRow = serverMap.get(key);
    if (!serverRow) {
      localOnly.push(localRow);
    } else if (!deepEqual(localRow, serverRow)) {
      changed.push({ local: localRow, server: serverRow });
    }
  }

  for (const [key, serverRow] of serverMap) {
    if (!localMap.has(key)) {
      serverOnly.push(serverRow);
    }
  }

  return {
    localOnly,
    serverOnly,
    changed,
  };
}

/**
 * Scan the live database and report what a wipe would destroy.
 *
 * Exported for tests: the reset guard is exercised against a fake PGlite
 * client, mirroring how `applyMissingSchema` is tested in local-database.
 */
export async function collectResetSafetyReport(
  client: Pick<PGlite, 'query'>,
): Promise<ResetSafetyReport> {
  // Unsynced sync-queue operations — the only truly unrecoverable loss.
  const byStatus: Record<string, number> = {};
  try {
    const queueRows = await client.query<{ status: string; count: number }>(
      `SELECT status::text AS status, COUNT(*)::int AS count
         FROM "SyncQueue"
        WHERE status IN ('PENDING', 'PROCESSING', 'FAILED', 'PERMANENT_FAILURE')
        GROUP BY status`,
    );
    for (const row of queueRows.rows) {
      byStatus[row.status] = row.count;
    }
  } catch {
    // SyncQueue missing (fresh or broken database) — nothing to protect.
  }
  const unsyncedOperations = Object.values(byStatus).reduce((a, b) => a + b, 0);

  // Volume overview across all user tables.
  const tables = await client.query<{ tableName: string }>(
    `SELECT table_name AS "tableName"
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%'
      ORDER BY table_name`,
  );

  let totalRows = 0;
  for (const { tableName } of tables.rows) {
    // eslint-disable-next-line no-await-in-loop
    const counted = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "${tableName}"`,
    );
    totalRows += counted.rows[0]?.count ?? 0;
  }

  return { unsyncedOperations, byStatus, totalRows, tableCount: tables.rows.length };
}

/**
 * Detect the Tauri webview — same check as local-database's `isTauri`.
 * Kept local so devtools does not import the eager side effects of the
 * database module at top level.
 */
function isTauriWebview(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Delete an IndexedDB database, rejecting if blocked by an open connection.
 * PGlite holds its store open until `client.close()`, so callers must close
 * the database singletons first or this promise never settles.
 */
function deleteIndexedDbDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('[devtools] indexedDB API unavailable in this context.'));
      return;
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(
        request.error ??
          new Error(`[devtools] Failed to delete IndexedDB database "${name}".`),
      );
    request.onblocked = () =>
      reject(
        new Error(
          `[devtools] Deleting IndexedDB database "${name}" is blocked by another ` +
            'open connection. Close other windows/tabs of the app and retry.',
        ),
      );
  });
}

/** List every IndexedDB database name, or [] if enumeration is unavailable. */
async function listIndexedDbDatabases(): Promise<string[]> {
  if (
    typeof indexedDB === 'undefined' ||
    typeof indexedDB.databases !== 'function'
  ) {
    return [];
  }
  try {
    // Newer DOM libs type databases() as a Promise-returning API.
    const infos = await indexedDB.databases();
    return (infos ?? [])
      .map((info) => info.name)
      .filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}

/**
 * Known IndexedDB database names PGlite data can live under.
 *
 * PGlite mounts Emscripten's IDBFS at `/pglite/<dataDir>` and Emscripten
 * names the backing IndexedDB database after the FULL mount-point path —
 * so for `idb://pglite-data` (local-database.ts) the actual database is
 * literally named "/pglite/pglite-data". Deleting the bare "pglite-data"
 * succeeds silently as a no-op on a nonexistent database, which is exactly
 * how a first cut of this helper failed to wipe anything. The bare variant
 * is kept in the fallback list for older/other layout possibilities.
 */
const PGLITE_IDB_DB_NAMES = ['/pglite/pglite-data', 'pglite-data'];

/**
 * Delete every IndexedDB database belonging to PGlite, then verify none
 * remain. Verification matters: a silent no-op delete (wrong name) or a
 * blocked deletion would otherwise reload the app straight back into the
 * old data with no signal that anything went wrong.
 */
export async function deletePgliteIndexedDbStores(): Promise<void> {
  const listed = await listIndexedDbDatabases();

  let targets = listed.filter((name) => name.toLowerCase().includes('pglite'));

  if (targets.length === 0 && listed.length > 0) {
    // Enumeration works and nothing matches — genuinely nothing to wipe.
    return;
  }
  if (targets.length === 0) {
    // databases() unavailable (or empty) — fall back to the known names.
    targets = [...PGLITE_IDB_DB_NAMES];
  }

  for (const name of targets) {
    // eslint-disable-next-line no-await-in-loop
    await deleteIndexedDbDatabase(name);
    console.log(`[devtools] Deleted IndexedDB database "${name}".`);
  }

  const remaining = (await listIndexedDbDatabases()).filter((name) =>
    name.toLowerCase().includes('pglite'),
  );
  if (remaining.length > 0) {
    throw new Error(
      `[devtools] IndexedDB still contains PGlite database(s) after deletion: ` +
        `${remaining.join(', ')}. Close other windows/tabs and retry.`,
    );
  }
}

/** Side effects wired for the real app environment. */
export function createDefaultResetDependencies(): ResetDependencies {
  return {
    closeDatabase: async () => {
      const { closeLocalDatabase } = await import('./local-database');
      await closeLocalDatabase();
    },
    deletePersistentStore: async () => {
      if (!isTauriWebview()) {
        console.log(
          '[devtools] Browser dev mode uses an in-memory database — nothing persisted to delete.',
        );
        return;
      }
      await deletePgliteIndexedDbStores();
    },
    reloadPage: () => {
      location.reload();
    },
  };
}

/**
 * Wipe the local database and reload the app into a fresh state.
 *
 * Guards, in order:
 *
 * 1. **Data-loss gate** — refuses while `SyncQueue` holds operations the
 *    server never confirmed (PENDING / PROCESSING / FAILED /
 *    PERMANENT_FAILURE), unless `{ force: true }` is passed. Those rows are
 *    the only copy of offline sales/shifts/adjustments; DISCARDED rows are
 *    already manager-approved losses and do not block.
 * 2. **Close before delete** — Prisma and PGlite are closed first because
 *    an open PGlite connection blocks `deleteDatabase` indefinitely.
 *
 * On next boot local-database.ts recreates schema + seeds automatically
 * (tax schemes, CONSUMIDOR FINAL). Session token and workstation id live
 * in localStorage and survive the wipe deliberately.
 *
 * Dev-only surface: `window.__db` is stripped from production builds.
 */
export async function resetLocalDatabase(
  client: Pick<PGlite, 'query'>,
  opts: { force?: boolean } | undefined,
  deps: ResetDependencies,
): Promise<void> {
  const report = await collectResetSafetyReport(client);

  if (report.unsyncedOperations > 0 && !opts?.force) {
    throw new Error(
      `[devtools] reset aborted — ${report.unsyncedOperations} sync operation(s) were never ` +
        `confirmed by the server (${JSON.stringify(report.byStatus)}). Pushing them first is ` +
        'the safe path; call __db.reset({ force: true }) to discard them permanently.',
    );
  }

  console.log(
    `[devtools] Resetting local database: ${report.totalRows} row(s) across ` +
      `${report.tableCount} table(s) will be deleted.`,
  );

  await deps.closeDatabase();
  await deps.deletePersistentStore();
  deps.reloadPage();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDbDevtools(client: PGlite, prisma: unknown): DbDevtools {
  const devtools: DbDevtools = {
    client,
    prisma,

    async query(sql: string, params?: unknown[]): Promise<unknown[]> {
      const result = params
        ? await client.query(sql, params)
        : await client.query(sql);
      return result.rows;
    },

    async tables(): Promise<string[]> {
      const rows = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
            AND table_name NOT LIKE '\\_%'
          ORDER BY table_name`,
      );
      return rows.rows.map((r) => r.table_name);
    },

    async columns(table: string): Promise<ColumnInfo[]> {
      const rows = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table],
      );
      return rows.rows.map((r) => ({
        column: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        default: r.column_default,
      }));
    },

    async count(table: string): Promise<number> {
      const result = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${q(table)}`,
      );
      return result.rows[0]?.count ?? 0;
    },

    async counts(): Promise<Array<{ table: string; rows: number }>> {
      const all = await devtools.tables();
      const result: Array<{ table: string; rows: number }> = [];
      for (const t of all) {
        const n = await devtools.count(t);
        result.push({ table: t, rows: n });
      }
      return result;
    },

    async inspect(table: string): Promise<{ columns: ColumnInfo[]; rowCount: number }> {
      const [cols, rowCount] = await Promise.all([
        devtools.columns(table),
        devtools.count(table),
      ]);
      return { columns: cols, rowCount };
    },

    async exportJSON(
      opts: { tables?: string[]; format?: 'pretty' | 'compact' } = {},
    ): Promise<string[]> {
      const targetTables = opts.tables ?? (await devtools.tables());
      const pretty = opts.format !== 'compact';
      const exported: string[] = [];

      for (const table of targetTables) {
        const rows = await client.query(`SELECT * FROM ${q(table)} ORDER BY 1`);
        const json = pretty
          ? JSON.stringify(rows.rows, null, 2)
          : JSON.stringify(rows.rows);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${table}.json`;
        a.click();
        URL.revokeObjectURL(url);
        exported.push(`${table}.json`);
      }

      return exported;
    },

    async exportAsInsert(table: string, limit?: number): Promise<string> {
      const sql = limit
        ? `SELECT * FROM ${q(table)} ORDER BY 1 LIMIT ${limit}`
        : `SELECT * FROM ${q(table)} ORDER BY 1`;
      const rows = await client.query(sql);
      if (rows.rows.length === 0) return `-- ${table}: empty`;

      const cols = Object.keys(rows.rows[0] as Record<string, unknown>);
      const colList = cols.map((c) => q(c)).join(', ');

      const statements = rows.rows.map((row) => {
        const vals = cols.map((c) => {
          const v = (row as Record<string, unknown>)[c];
          return escapeLiteral(v);
        });
        return `INSERT INTO ${q(table)} (${colList}) VALUES (${vals.join(', ')});`;
      });

      return `-- ${table}: ${statements.length} rows\n${statements.join('\n')}`;
    },

    async fetchServerTable(
      tableName: string,
      baseUrl?: string,
    ): Promise<unknown[]> {
      const apiBase = baseUrl ?? (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';
      const url = `${apiBase}/api/dev/db-export?tables=${encodeURIComponent(tableName)}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Server returned 404. Either NODE_ENV !== 'development' on the server, ` +
            `or table "${tableName}" is not in the export whitelist.`,
          );
        }
        throw new Error(
          `Failed to fetch server table: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown[]>;
      return data[tableName] ?? [];
    },

    async diffTable(tableName: string, baseUrl?: string): Promise<TableDiff> {
      const [localRowsRaw, serverRows] = await Promise.all([
        devtools.query(`SELECT * FROM ${q(tableName)} ORDER BY 1`),
        devtools.fetchServerTable(tableName, baseUrl),
      ]);

      return computeTableDiff(
        tableName,
        localRowsRaw as Record<string, unknown>[],
        serverRows as Record<string, unknown>[],
      );
    },

    async diffTableWithJSON(
      tableName: string,
      serverRows: unknown[],
    ): Promise<TableDiff> {
      const localRowsRaw = await devtools.query(
        `SELECT * FROM ${q(tableName)} ORDER BY 1`,
      );

      return computeTableDiff(
        tableName,
        localRowsRaw as Record<string, unknown>[],
        serverRows as Record<string, unknown>[],
      );
    },

    reset(opts?: { force?: boolean }): Promise<void> {
      return resetLocalDatabase(client, opts, createDefaultResetDependencies());
    },
  };

  return devtools;
}

// ---------------------------------------------------------------------------
// Diff computation (shared by diffTable and diffTableWithJSON)
// ---------------------------------------------------------------------------

async function computeTableDiff(
  table: string,
  localRows: Record<string, unknown>[],
  serverRows: Record<string, unknown>[],
): Promise<TableDiff> {
  // ---- Column differences -----------------------------------------------
  const localCols = localRows.length > 0 ? Object.keys(localRows[0]) : [];
  const serverCols = serverRows.length > 0 ? Object.keys(serverRows[0]) : [];
  const allCols = new Set([...localCols, ...serverCols]);
  const columnDifferences: TableDiff['columnDifferences'] = [];

  for (const col of allCols) {
    const hasLocal = localCols.includes(col);
    const hasServer = serverCols.includes(col);
    if (!hasLocal || !hasServer) {
      columnDifferences.push({
        column: col,
        localType: null,
        serverType: null,
      });
    }
  }

  // ---- Row differences --------------------------------------------------
  const { localOnly, serverOnly, changed } = computeRowDiff(localRows, serverRows);

  const summaryLines: string[] = [];
  if (columnDifferences.length > 0) {
    summaryLines.push(
      `⚠ ${columnDifferences.length} column(s) differ between schemas`,
    );
  }
  summaryLines.push(
    `📊 ${table}: local=${localRows.length} rows, server=${serverRows.length} rows`,
  );
  if (localOnly.length > 0) summaryLines.push(`  ➕ ${localOnly.length} rows only in local`);
  if (serverOnly.length > 0) summaryLines.push(`  ➖ ${serverOnly.length} rows only in server`);
  if (changed.length > 0) summaryLines.push(`  ✏️ ${changed.length} rows changed`);

  return {
    table,
    columnDifferences,
    localOnlyCount: localOnly.length,
    serverOnlyCount: serverOnly.length,
    changedCount: changed.length,
    localOnlySample: localOnly.slice(0, 5),
    serverOnlySample: serverOnly.slice(0, 5),
    changedSample: changed.slice(0, 5),
    summary: summaryLines.join('\n'),
  };
}
