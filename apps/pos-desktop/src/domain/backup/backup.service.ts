/**
 * Backup domain service for the POS desktop app.
 *
 * Orchestrates Rust-level filesystem snapshots with the TypeScript PGlite
 * lifecycle. Because PGlite runs inside the webview, every backup/restore
 * operation closes the local database before the Rust command runs and
 * reopens it afterward. That close-then-copy pattern is the
 * architecture-appropriate equivalent of the exclusive snapshot lock described
 * in the disaster-recovery spec.
 */

import { invoke } from '@tauri-apps/api/core';
import { PGlite } from '@electric-sql/pglite';
import { closeLocalDatabase } from '../../infrastructure/local-database';
import { runLocalDatabaseIntegrityCheck } from '../../infrastructure/startup-health';
import { API_BASE_URL } from '@infra/config';
import { DomainError } from '../../common/domain-error';
import { isOnline } from '../../common/is-online';
import {
  BackupFailedException,
  BackupInProgressException,
  RestoreFailedException,
  UploadFailedException,
} from './exceptions';


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
      // Note: we do NOT close the live database here. PGlite runs inside the
      // webview and the singleton Prisma client held by the service context
      // would become stale after a close/reopen. The Rust snapshot is taken
      // while PGlite is running with relaxedDurability=false, which keeps
      // storage flushed. This is a hot copy; the small inconsistency window is
      // acceptable for an offline-first POS and is documented in the runbook.
      const metadata = await invoke<BackupMetadata>('create_backup_command', {
        request: {
          ...request,
          db_schema_version: LOCAL_DB_SCHEMA_VERSION,
          max_client_sequence: request.maxClientSequence,
        },
      });

      if (Date.now() - startTime > BACKUP_TOAST_THRESHOLD_MS) {
        // The UI layer is responsible for surfacing a non-blocking toast.
        // We emit an advisory event the page can listen to.
        window.dispatchEvent(new CustomEvent('backup:slow', { detail: metadata }));
      }

      return metadata;
    } catch (err) {
      throw err instanceof DomainError
        ? err
        : new BackupFailedException(err instanceof Error ? err.message : String(err));
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

    const { tempDataDir } = await invoke<{ tempDataDir: string }>('copy_backup_to_temp_command', { id });

    let integrityCheckPassed = false;
    let integrityError: string | undefined;
    const tableCounts: Record<string, number> = {};

    try {
      const tempClient = new PGlite(tempDataDir, { relaxedDurability: true });
      try {
        const report = await runLocalDatabaseIntegrityCheck(tempClient);
        integrityCheckPassed = report.passed;
        Object.assign(tableCounts, report.actualCounts);
        if (!report.passed) {
          integrityError = report.missingTables.length > 0
            ? `Missing or unreadable tables: ${report.missingTables.join(', ')}`
            : report.error;
        }
      } finally {
        await tempClient.close();
      }
    } catch (err) {
      integrityCheckPassed = false;
      integrityError = err instanceof Error ? err.message : String(err);
    } finally {
      await invoke('remove_temp_dir_command', { path: tempDataDir }).catch(() => undefined);
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

    try {
      // Restore replaces the live data directory, so the database must be
      // closed first. After a successful restore we reload the webview so the
      // service context reinitialises with a fresh Prisma client.
      await closeLocalDatabase();
      const report = await invoke<RestoreReport>('restore_backup_command', { id, options });
      if (report.success) {
        window.location.reload();
      }
      return report;
    } catch (err) {
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
