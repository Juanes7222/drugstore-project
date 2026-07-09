/**
 * Startup health checks and sentinel management for the local database.
 *
 * PGlite runs inside the Tauri webview, so the actual integrity check is
 * performed from TypeScript after the database is opened. Rust owns the
 * clean-shutdown sentinel file; this module bridges the two sides via Tauri
 * commands and exposes the integrity verification logic.
 */

import { invoke } from '@tauri-apps/api/core';
import type { PGlite } from '@electric-sql/pglite';

export type StartupHealthStatus = 'OK' | 'UNHEALTHY_SHUTDOWN' | 'INTEGRITY_FAILED';

export interface StartupHealth {
  status: StartupHealthStatus;
  message: string;
}

export interface IntegrityReport {
  passed: boolean;
  expectedTables: string[];
  actualCounts: Record<string, number>;
  missingTables: string[];
  error?: string;
}

const EXPECTED_TABLES = [
  'Client',
  'CashShift',
  'Sale',
  'SaleItem',
  'SaleItemLot',
  'SyncQueue',
  'SyncAttempt',
  'SyncRecoveryLog',
  'PaymentMethod',
  'Product',
  'ProductBarcode',
  'Category',
  'PharmaceuticalForm',
  'Lot',
];

/**
 * Query Rust for the startup health derived from sentinel files.
 */
export async function getStartupHealth(): Promise<StartupHealth> {
  return invoke<StartupHealth>('get_startup_health');
}

/**
 * Tell Rust to clear the clean-shutdown sentinel after a successful integrity
 * check. Safe to call when no sentinel exists.
 */
export async function acknowledgeCleanStartup(): Promise<void> {
  await invoke<void>('acknowledge_clean_startup');
}

/**
 * Tell Rust to persist an integrity-failure marker so the next launch routes
 * to recovery.
 */
export async function reportIntegrityFailure(): Promise<void> {
  await invoke<void>('report_integrity_failure');
}

/**
 * Run a lightweight integrity check against the opened PGlite instance.
 *
 * PGlite does not expose `PRAGMA integrity_check`, so we verify that every
 * table expected by the local schema can be read in a single read transaction.
 * Any failure means the database is suspect and should be restored from backup.
 */
export async function runLocalDatabaseIntegrityCheck(
  client: PGlite,
): Promise<IntegrityReport> {
  const report: IntegrityReport = {
    passed: false,
    expectedTables: EXPECTED_TABLES,
    actualCounts: {},
    missingTables: [],
  };

  try {
    for (const tableName of EXPECTED_TABLES) {
      try {
        const result = await client.query<{ count: bigint }>(
          `SELECT count(*) AS count FROM "${tableName}"`,
        );
        report.actualCounts[tableName] = Number(result.rows[0]?.count ?? 0n);
      } catch (err) {
        report.missingTables.push(tableName);
        report.actualCounts[tableName] = 0;
      }
    }

    report.passed = report.missingTables.length === 0;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    report.passed = false;
  }

  return report;
}
