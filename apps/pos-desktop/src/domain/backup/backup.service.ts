/**
 * Backup domain service for the POS desktop app.
 *
 * PGlite runs inside the webview with IndexedDB (`idb://`), invisible to the
 * OS filesystem that Rust reads.  This service bridges that gap:
 *
 * - **Backup**: dump PGlite data to JSON, write it to a temporary directory
 *   on the real filesystem via a Rust command, then invoke the Rust backup
 *   (which copies the directory into the backup store).
 * - **Restore**: ask Rust to restore the backup directory, read the JSON dump,
 *   delete the IndexedDB database, recreate a fresh PGlite, and replay the
 *   data into it.
 * - **Verify**: hash the JSON file (Rust), then parse and validate it (TS).
 *
 * Because every backup/restore cycle touches the live singleton PGlite instance,
 * careful close/reopen ordering prevents stale Prisma clients.
 */

import { invoke } from '@tauri-apps/api/core';
import { closeLocalDatabase, getLocalDatabase } from '../../infrastructure/local-database';
import { API_BASE_URL } from '@infra/config';
import { DomainError } from '../../common/domain-error';
import { isOnline } from '../../common/is-online';
import {
  BackupFailedException,
  BackupInProgressException,
  RestoreFailedException,
  UploadFailedException,
} from './exceptions';
import { clearAllTableData, exportPgliteToJson, importJsonToPglite } from './backup-export';
import type { BackupJson } from './backup-export';


// ---------------------------------------------------------------------------
// Types (mirrored from Rust)
// ---------------------------------------------------------------------------

export type BackupReason = 'SHIFT_CLOSE' | 'MANUAL' | 'PERIODIC';

export type BackupStatus = 'HEALTHY' | 'CORRUPT';

export type BackupHealthLevel = 'HEALTHY' | 'STALE' | 'CRITICAL';

export interface BackupMetadata {
  id: string;
  createdAt: string;
  workstationId: string;
  appVersion: string;
  dbSchemaVersion: number;
  sizeBytes: number;
  sha256: string;
  reason: BackupReason;
  containsUnpushedOperations: boolean;
  pendingCount: number;
  failedCount: number;
  maxClientSequence: number;
  note: string | null;
  clockSkewSeconds: number | null;
  status: BackupStatus;
}

export interface VerificationReport {
  id: string;
  passed: boolean;
  hashMatched: boolean;
  integrityCheckPassed: boolean;
  tableCounts: Record<string, number>;
  error?: string;
}

export interface RestoreOptions {
  skipSchemaVersionCheck: boolean;
}

export interface RestoreReport {
  id: string;
  success: boolean;
  restarted: boolean;
  error?: string;
}

export interface BackupSummary {
  lastBackupAt: string | null;
  lastBackupReason: BackupReason | null;
  totalBackups: number;
  oldestBackupAt: string | null;
  totalBackupSizeBytes: number;
}

export interface RetentionPolicy {
  keepLastN?: number;
  keepDays?: number;
  storageLimitBytes?: number;
}

export interface UploadReceipt {
  uploadId: string;
  workstationId: string;
  createdAt: string;
}

export interface CreateBackupRequest {
  reason: BackupReason;
  workstationId: string;
  dbSchemaVersion: number;
  pendingCount: number;
  failedCount: number;
  maxClientSequence: number;
  note?: string;
  clockSkewSeconds?: number;
}

export interface ServerLocalNumberHint {
  workstationId: string;
  maxLocalNumber: number | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const LOCAL_DB_SCHEMA_VERSION = 1;
const PERIODIC_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BACKUP_TOAST_THRESHOLD_MS = 2000;

/**
 * File name used for the JSON data dump inside the `pglite-data` directory.
 */
const DUMP_FILE_NAME = 'db-dump.json';

export interface BackupService {
  createBackup(request: CreateBackupRequest): Promise<BackupMetadata>;
  listBackups(): Promise<BackupMetadata[]>;
  verifyBackup(id: string): Promise<VerificationReport>;
  restoreBackup(id: string, options?: RestoreOptions): Promise<RestoreReport>;
  pruneBackups(policy?: RetentionPolicy): Promise<number>;
  getBackupSummary(): Promise<BackupSummary>;
  getBackupHealth(): Promise<BackupHealthLevel>;
  uploadBackupToServer(
    id: string,
    password: string,
    accessToken: string,
  ): Promise<UploadReceipt>;
  fetchLocalNumberHint(workstationId: string, accessToken: string): Promise<number | null>;
  shouldRunPeriodicBackup(lastBackupAt: string | null): boolean;
}

export const createBackupService = (): BackupService => new BackupServiceImpl();

class BackupServiceImpl implements BackupService {
  private inProgress = false;
  private periodicBackupTimer: ReturnType<typeof setInterval> | null = null;

  async createBackup(request: CreateBackupRequest): Promise<BackupMetadata> {
    if (this.inProgress) {
      throw new BackupInProgressException();
    }
    this.inProgress = true;
    const startTime = Date.now();

    try {
      // ---- Step 1: export live PGlite data to JSON ----
      // PGlite uses IndexedDB, invisible to the filesystem.  We dump every
      // user-data table to a JSON blob that Rust can copy into the backup.
      // The database remains running during the export (hot copy).
      const { client } = await getLocalDatabase();
      const backupJson = await exportPgliteToJson(client);
      const jsonStr = JSON.stringify(backupJson, null, 2);

      // ---- Step 2: write the JSON dump to the filesystem ----
      // Rust's `write_data_dir_file_command` creates the `pglite-data/`
      // directory (if missing) and writes `db-dump.json` inside it.
      await invoke('write_data_dir_file_command', {
        file_name: DUMP_FILE_NAME,
        contents: jsonStr,
      });

      // ---- Step 3: invoke the Rust backup (copies the directory) ----
      const metadata = await invoke<BackupMetadata>('create_backup_command', {
        request: {
          reason: request.reason,
          workstation_id: request.workstationId,
          db_schema_version: LOCAL_DB_SCHEMA_VERSION,
          pending_count: request.pendingCount,
          failed_count: request.failedCount,
          max_client_sequence: request.maxClientSequence,
          note: request.note,
          clock_skew_seconds: request.clockSkewSeconds,
        },
      });

      // ---- Step 4: clean up the temporary JSON dump ----
      await invoke('delete_data_dir_file_command', {
        file_name: DUMP_FILE_NAME,
      }).catch(() => undefined);

      if (Date.now() - startTime > BACKUP_TOAST_THRESHOLD_MS) {
        window.dispatchEvent(new CustomEvent('backup:slow', { detail: metadata }));
      }

      return metadata;
    } catch (err) {
      // Clean up the temp file on failure too.
      await invoke('delete_data_dir_file_command', {
        file_name: DUMP_FILE_NAME,
      }).catch(() => undefined);

      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as Record<string, unknown>).message)
            : String(err);

      throw err instanceof DomainError
        ? err
        : new BackupFailedException(message);
    } finally {
      this.inProgress = false;
    }
  }

  async listBackups(): Promise<BackupMetadata[]> {
    return invoke<BackupMetadata[]>('list_backups_command');
  }

  async verifyBackup(id: string): Promise<VerificationReport> {
    const rustReport = await invoke<VerificationReport>('verify_backup_command', { id });
    if (!rustReport.hashMatched) {
      await invoke('mark_backup_corrupt_command', { id });
      return {
        ...rustReport,
        passed: false,
        integrityCheckPassed: false,
      };
    }

    // Read the JSON dump directly from the stored backup via Rust.
    let integrityCheckPassed = false;
    let integrityError: string | undefined;
    const tableCounts: Record<string, number> = {};

    try {
      const jsonStr = await invoke<string>('read_backup_dump_command', { id });
      const parsed = JSON.parse(jsonStr) as BackupJson;
      for (const [tableName, rows] of Object.entries(parsed.tables)) {
        tableCounts[tableName] = rows.length;
      }
      integrityCheckPassed = true;
    } catch (err) {
      integrityCheckPassed = false;
      integrityError = err instanceof Error ? err.message : String(err);
    }

    if (!integrityCheckPassed) {
      await invoke('mark_backup_corrupt_command', { id });
    }

    return {
      id,
      passed: rustReport.hashMatched && integrityCheckPassed,
      hashMatched: rustReport.hashMatched,
      integrityCheckPassed,
      tableCounts,
      error: integrityError,
    };
  }

  async restoreBackup(id: string, options: RestoreOptions = { skipSchemaVersionCheck: false }): Promise<RestoreReport> {
    if (this.inProgress) {
      throw new BackupInProgressException();
    }
    this.inProgress = true;
    let dataCleared = false;

    try {
      // ---- Phase 1: read the JSON dump from the backup store ----
      const jsonStr = await invoke<string>('read_backup_dump_command', { id });
      const backup = JSON.parse(jsonStr) as BackupJson;

      // ---- Phase 2: replace live PGlite data in-place ----
      const { client } = await getLocalDatabase();
      await clearAllTableData(client);
      dataCleared = true;
      await importJsonToPglite(client, backup);

      // ---- Phase 3: close the database so the Prisma client is fresh ----
      await closeLocalDatabase();

      // ---- Phase 4: tell Rust to restore (filesystem bookkeeping) ----
      const report = await invoke<RestoreReport>('restore_backup_command', { id, options });

      if (report.success) {
        window.location.reload();
      }
      return report;
    } catch (err) {
      // If data was cleared but import failed, reload triggers schema init
      // on the empty IndexedDB — safer than a half-imported state.
      if (dataCleared) {
        window.location.reload();
      }
      throw err instanceof DomainError
        ? err
        : new RestoreFailedException(err instanceof Error ? err.message : String(err));
    } finally {
      this.inProgress = false;
    }
  }

  async pruneBackups(policy?: RetentionPolicy): Promise<number> {
    return invoke<number>('prune_backups_command', { policy: policy ?? null });
  }

  async getBackupSummary(): Promise<BackupSummary> {
    return invoke<BackupSummary>('get_backup_summary_command');
  }

  async getBackupHealth(): Promise<BackupHealthLevel> {
    return invoke<BackupHealthLevel>('get_backup_health_command');
  }

  async uploadBackupToServer(
    id: string,
    password: string,
    accessToken: string,
  ): Promise<UploadReceipt> {
    const backups = await this.listBackups();
    const backup = backups.find((b) => b.id === id);
    if (!backup) {
      throw new UploadFailedException('Backup not found');
    }

    const encryptedBytes = await invoke<Uint8Array>('encrypt_backup_command', {
      request: { id, password },
    });

    const response = await fetch(
      `${API_BASE_URL.replace(/\/$/, '')}/terminals/${backup.workstationId}/backup-upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'X-Backup-Id': id,
          'X-Backup-Created-At': backup.createdAt,
          'X-Backup-Sha256': backup.sha256,
        },
        body: new Blob([encryptedBytes as unknown as BlobPart]),
      },
    );

    if (!response.ok) {
      throw new UploadFailedException(
        `Server returned ${response.status}: ${await response.text()}`,
      );
    }

    const receipt = (await response.json()) as UploadReceipt;
    return receipt;
  }

  async fetchLocalNumberHint(
    workstationId: string,
    accessToken: string,
  ): Promise<number | null> {
    if (!isOnline()) return null;

    try {
      const response = await fetch(
        `${API_BASE_URL.replace(/\/$/, '')}/sync/local-number-hint?workstationId=${encodeURIComponent(workstationId)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as ServerLocalNumberHint;
      return data.maxLocalNumber;
    } catch {
      return null;
    }
  }

  shouldRunPeriodicBackup(lastBackupAt: string | null): boolean {
    if (!lastBackupAt) return true;
    return Date.now() - new Date(lastBackupAt).getTime() >= PERIODIC_BACKUP_INTERVAL_MS;
  }

  /**
   * Register a timer that fires a periodic backup every 6 hours, but only if
   * no backup has been created in the last 6 hours. Callers must pass an
   * async factory so the timer can build queue-state information each tick.
   */
  startPeriodicBackup(
    factory: () => Promise<CreateBackupRequest>,
    onSuccess?: (metadata: BackupMetadata) => void,
    onError?: (error: Error) => void,
  ): void {
    if (this.periodicBackupTimer !== null) return;

    const tick = async () => {
      try {
        const summary = await this.getBackupSummary();
        if (!this.shouldRunPeriodicBackup(summary.lastBackupAt)) return;

        const request = await factory();
        const metadata = await this.createBackup(request);
        onSuccess?.(metadata);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void tick();
    this.periodicBackupTimer = setInterval(() => void tick(), PERIODIC_BACKUP_INTERVAL_MS);
  }

  stopPeriodicBackup(): void {
    if (this.periodicBackupTimer !== null) {
      clearInterval(this.periodicBackupTimer);
      this.periodicBackupTimer = null;
    }
  }
}
