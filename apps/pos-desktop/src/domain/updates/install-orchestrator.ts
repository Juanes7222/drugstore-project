/**
 * Install orchestrator for the POS desktop auto-update module.
 *
 * Coordinates the complete install sequence:
 * 1. Pre-install checks (no active sale, shift closed or manager-approved)
 * 2. System state verification (no long-running operations)
 * 3. Backup via BackupService
 * 4. Schema migrations via MigrationRunner
 * 5. Tauri updater install trigger
 * 6. On failure — rollback
 */

import { invoke } from '@tauri-apps/api/core';
import { InstallFailedException } from './exceptions';
import { createMigrationRunner, type MigrationRunner, type MigrationRunnerConfig } from './migration-runner';
import type { MigrationStep } from '@pharmacy/shared-types';
import type { BackupService } from '../backup/backup.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallPreCheckResult {
  canInstall: boolean;
  /** Human-readable reason if install is blocked. */
  blockedReason: string | null;
}

export interface InstallOrchestratorConfig {
  /** PrismaClient for pre-checks (sale-in-progress, etc.). */
  prisma: unknown;
  /** BackupService for pre-install snapshot. */
  backupService: BackupService;
  /** The app version being installed. */
  version: string;
  /** Path to the downloaded update binary/source. */
  downloadPath: string;
  /** Workstation ID for backup metadata. */
  workstationId: string;
  /** Schema migrations to apply, if any. */
  migrations?: MigrationStep[];
  /** Bundle extraction path for CUSTOM migrations. */
  bundlePath?: string;
}

export interface InstallReport {
  success: boolean;
  backupCreated: boolean;
  migrated: boolean;
  restartTriggered: boolean;
  error?: string;
}

export interface InstallOrchestrator {
  /** Run pre-install checks. */
  runPreInstallChecks(): Promise<InstallPreCheckResult>;

  /**
   * Execute the full install sequence.
   * Throws InstallFailedException on failure.
   */
  install(): Promise<InstallReport>;

  /**
   * Trigger rollback after a failed install.
   */
  rollback(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createInstallOrchestrator(
  config: InstallOrchestratorConfig,
): InstallOrchestrator {
  return new InstallOrchestratorImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class InstallOrchestratorImpl implements InstallOrchestrator {
  private migrationRunner: MigrationRunner | null = null;

  constructor(private readonly config: InstallOrchestratorConfig) {}

  async runPreInstallChecks(): Promise<InstallPreCheckResult> {
    const db = this.config.prisma as any;

    // Check 1: No sale in progress (open sale with status PENDING or IN_PROGRESS)
    try {
      const openSaleCount = await db.sale.count({
        where: {
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
      });
      if (openSaleCount > 0) {
        return {
          canInstall: false,
          blockedReason: `${openSaleCount} sale(s) are still in progress. Complete all sales before installing.`,
        };
      }
    } catch {
      // If the Sale table doesn't exist or query fails, proceed with caution.
      // This handles fresh databases where the model may not yet be migrated.
    }

    // Check 2: Cash shift closed (no open shift)
    try {
      const openShiftCount = await db.cashShift.count({
        where: { closedAt: null },
      });
      if (openShiftCount > 0) {
        return {
          canInstall: false,
          blockedReason:
            'There is an open cash shift. Close the shift before installing the update.',
        };
      }
    } catch {
      // Not all databases have CashShift; proceed if query fails.
    }

    // Check 3: No long-running sync operations in permanent failure
    try {
      const stalledSyncCount = await db.syncQueue.count({
        where: { status: 'PERMANENT_FAILURE' },
      });
      if (stalledSyncCount > 10) {
        // Warn but don't block — the install will trigger a backup first.
        console.warn(
          `[install-orchestrator] ${stalledSyncCount} permanently failed sync operations present.`,
        );
      }
    } catch {
      // SyncQueue may not exist yet.
    }

    return { canInstall: true, blockedReason: null };
  }

  async install(): Promise<InstallReport> {
    const report: InstallReport = {
      success: false,
      backupCreated: false,
      migrated: false,
      restartTriggered: false,
    };

    try {
      // Step 1: Pre-install checks
      const checks = await this.runPreInstallChecks();
      if (!checks.canInstall) {
        throw new InstallFailedException(checks.blockedReason!);
      }

      // Step 2: Create a pre-install backup
      try {
        await this.config.backupService.createBackup({
          reason: 'MANUAL',
          workstationId: this.config.workstationId,
          dbSchemaVersion: 1,
          pendingCount: 0,
          failedCount: 0,
          maxClientSequence: 0,
          note: `Pre-update backup for version ${this.config.version}`,
        });
        report.backupCreated = true;
      } catch (err) {
        // Backup failure is non-fatal for the install (the health-check policy
        // can require a valid backup before allowing install; adjust per policy).
        console.warn(
          '[install-orchestrator] Pre-install backup failed, proceeding with install:',
          err,
        );
      }

      // Step 3: Apply schema migrations
      if (this.config.migrations && this.config.migrations.length > 0) {
        this.migrationRunner = createMigrationRunner({
          prisma: this.config.prisma,
          migrations: this.config.migrations,
          bundlePath: this.config.bundlePath,
        } satisfies MigrationRunnerConfig);

        try {
          const applied = await this.migrationRunner.runPending();
          report.migrated = true;
          console.info(
            `[install-orchestrator] Applied ${applied.length} migration(s).`,
          );
        } catch (migrateErr) {
          // Migration failure triggers rollback
          await this.rollback();
          throw migrateErr instanceof InstallFailedException
            ? migrateErr
            : new InstallFailedException(
                `Migration failed: ${migrateErr instanceof Error ? migrateErr.message : String(migrateErr)}`,
              );
        }
      } else {
        report.migrated = true; // No migrations needed.
      }

      // Step 4: Trigger install via Tauri updater
      try {
        await invoke('trigger_update_install_command', {
          downloadPath: this.config.downloadPath,
        });
        report.restartTriggered = true;
      } catch (installErr) {
        throw new InstallFailedException(
          `Failed to trigger installer: ${installErr instanceof Error ? installErr.message : String(installErr)}`,
        );
      }

      report.success = true;
      return report;
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
      throw err instanceof InstallFailedException
        ? err
        : new InstallFailedException(report.error!);
    }
  }

  async rollback(): Promise<void> {
    console.info('[install-orchestrator] Rolling back update...');

    try {
      // Signal rollback to the Tauri updater
      await invoke('rollback_update_command');
    } catch (err) {
      console.error('[install-orchestrator] Rollback invoke failed:', err);
      // Even if the invoke fails, the rollback-detector on next startup
      // will detect the crash and trigger recovery.
    }
  }
}
