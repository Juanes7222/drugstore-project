/**
 * PGlite data export/import for backup/restore.
 *
 * PGlite with `idb://` stores its data in IndexedDB, invisible to Rust's
 * filesystem-level backup.  This module bridges that gap by dumping all
 * table data to JSON (export) and replaying it (import) so the Rust
 * backup subsystem can create/restore snapshots from the filesystem.
 */

import type { PGlite } from '@electric-sql/pglite';

// ---------------------------------------------------------------------------
// Constants — table list sourced from LOCAL_SCHEMA_SQL
// ---------------------------------------------------------------------------

/**
 * Tables that belong to the local-only schema (no server counterpart).
 * Excluded from export/import by default — caller opts in.
 */
const LOCAL_ONLY_TABLES = new Set([
  'PrinterConfig',
  'PrintJob',
  'RecoveryLog',
  'UpdateState',
  'UpdateAttempt',
  'MigrationLog',
  'PendingTelemetry',
]);

/**
 * All user-data tables in the local schema.
 */
const ALL_TABLES: readonly string[] = [
  'CashShift',
  'Category',
  'PharmaceuticalForm',
  'ClientClassification',
  'Client',
  'Invoice',
  'ContingencyEvent',
  'InvoiceLocalAdjustment',
  'FiscalCounter',
  'InventoryMovement',
  'Lot',
  'PaymentMethod',
  'PrinterConfig',
  'PrintJob',
  'ReceiptTemplate',
  'ProductBarcode',
  'ProductPriceHistory',
  'ProductTaxHistory',
  'Product',
  'RecoveryLog',
  'SaleItemLot',
  'SaleItem',
  'SalePayment',
  'Sale',
  'ShiftCashCount',
  'SyncQueue',
  'SyncAttempt',
  'SyncRecoveryLog',
  'TaxScheme',
  'UpdateState',
  'UpdateAttempt',
  'MigrationLog',
  'PendingTelemetry',
];

/**
 * Reverse table order so child tables (with FK references) are deleted first.
 */
const ALL_TABLES_REVERSED: readonly string[] = [...ALL_TABLES].reverse();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Backup data format: table name → array of rows.
 * Each row is a record of column name → raw value.
 * null values are stored as null.  Strings, numbers, booleans are stored
 * as their native JSON types.
 */
export interface BackupJson {
  schemaVersion: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface ExportOptions {
  /** Tables to skip (e.g. ephemeral/derived tables). */
  excludeTables?: Set<string>;
}

export interface ImportOptions {
  /** Tables to skip during import. */
  excludeTables?: Set<string>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Dump every user-data table from the running PGlite instance to a JSON blob.
 *
 * The live PGlite is NOT closed or modified — this is a read-only snapshot.
 * Callers should flush any pending writes before calling.
 */
export async function exportPgliteToJson(
  client: PGlite,
  options?: ExportOptions,
): Promise<BackupJson> {
  const exclude = options?.excludeTables ?? LOCAL_ONLY_TABLES;
  const tables = ALL_TABLES.filter((t) => !exclude.has(t));
  const tableData: Record<string, Record<string, unknown>[]> = {};

  for (const tableName of tables) {
    // eslint-disable-next-line no-await-in-loop
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM "${tableName}"`,
    );
    // PGlite returns `rows` as an array of row objects.  null cells come
    // through as null; PostgreSQL numeric values are JavaScript numbers or
    // strings depending on size; timestamps are ISO-8601 strings.
    tableData[tableName] = result.rows.map(normaliseRow);
  }

  const payload: BackupJson = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    tables: tableData,
  };

  return payload;
}

/**
 * Deep-normalise a row so JSON serialisation is predictable.
 *
 * - BigInt → Number (safe for POS data sizes).
 * - Date → ISO string.
 * - Buffer/Uint8Array → base64 string.
 * - null stays null (JSON serialises it correctly).
 */
function normaliseRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (value instanceof Uint8Array) {
      // Convert binary data to base64 for JSON-safe transport.
      const bytes = new Uint8Array(value);
      const binary = Array.from(bytes)
        .map((b) => String.fromCodePoint(b))
        .join('');
      out[key] = btoa(binary);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      // JSONB / nested objects — keep as-is (JSON.stringify handles them).
      out[key] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Delete all rows from every user-data table in the correct order (children
 * first) so FK constraints are satisfied.
 */
export async function clearAllTableData(
  client: PGlite,
  options?: ImportOptions,
): Promise<void> {
  const exclude = options?.excludeTables ?? LOCAL_ONLY_TABLES;
  const tables = ALL_TABLES_REVERSED.filter((t) => !exclude.has(t));

  for (const tableName of tables) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(`DELETE FROM "${tableName}"`);
  }
}

/**
 * Restore data into a fresh PGlite instance from a previously-exported
 * BackupJson payload.
 *
 * The caller MUST have already executed the full DDL (LOCAL_SCHEMA_SQL)
 * on the target PGlite instance.  This function only inserts rows.
 *
 * Insert order follows the table list so that FK references are satisfied
 * (parents before children).
 */
export async function importJsonToPglite(
  client: PGlite,
  backup: BackupJson,
  options?: ImportOptions,
): Promise<void> {
  const exclude = options?.excludeTables ?? LOCAL_ONLY_TABLES;
  const tables = ALL_TABLES.filter((t) => !exclude.has(t));

  for (const tableName of tables) {
    const rows = backup.tables[tableName];
    if (!rows || rows.length === 0) continue;

    // Build a parameterised INSERT for batch insert.
    // We insert one row at a time so each row gets its own parameter
    // set — PGlite handles this well in WASM.
    const columns = Object.keys(rows[0]);
    const quotedColumns = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const stmt = `INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`;

    // eslint-disable-next-line no-await-in-loop
    for (const row of rows) {
      const params = columns.map((col) => row[col] ?? null);
      // eslint-disable-next-line no-await-in-loop
      await client.query(stmt, params);
    }
  }
}
