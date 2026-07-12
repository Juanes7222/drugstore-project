/**
 * Update service — main orchestrator for the POS desktop auto-update module.
 *
 * Exposes the high-level API that the UI layer and startup interceptor call:
 * - checkForUpdate
 * - startDownload / pauseDownload / resumeDownload / cancelDownload
 * - installUpdate
 * - handleRollback
 * - sendTelemetry
 *
 * Internally delegates to the state machine, check strategy, download manager,
 * install orchestrator, migration runner, rollback detector, and telemetry
 * service. The service maintains a single UpdateStateMachine as the source
 * of truth for the current lifecycle phase.
 */

import type { HttpClient } from '../../infrastructure/http-client';
import { createHttpClient } from '../../infrastructure/http-client';
import { API_BASE_URL } from '../../infrastructure/config';
import { isOnline } from '../../common/is-online';
import {
  UpdateType,
  UpdateOutcome,
  type MigrationStep,
} from '@pharmacy/shared-types';
import type { UpdateCheckResponse } from '@pharmacy/shared-types';
import { UpdateStateMachine, type UpdateState } from './state-machine';
import {
  getCheckStrategy,
  type CheckTrigger,
} from './check-strategy';
import {
  createDownloadManager,
  type DownloadManager,
  type DownloadManagerConfig,
  type DownloadProgress,
} from './download-manager';
import {
  createInstallOrchestrator,
  type InstallOrchestrator,
  type InstallOrchestratorConfig,
  type InstallReport,
} from './install-orchestrator';
import {
  createRollbackDetector,
  type RollbackDetector,
} from './rollback-detector';
import {
  createTelemetryService,
  type TelemetryService,
  type TelemetryEvent,
} from './telemetry.service';
import {
  UpdateCheckFailedException,
  DownloadFailedException,
  InstallFailedException,
} from './exceptions';
import type { BackupService } from '../backup/backup.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateServiceConfig {
  /** PrismaClient for local DB access (cast from getLocalDatabase). */
  prisma: unknown;
  /** Current app version string. */
  currentVersion: string;
  /** Workstation ID for telemetry and API calls. */
  workstationId: string;
  /** Optional license ID for telemetry signing. */
  licenseId?: string;
  /** Access token provider for authenticated API calls. */
  accessToken?: () => Promise<string | null>;
  /** BackupService for pre-install snapshots. */
  backupService: BackupService;
}

export interface CheckResult {
  updateAvailable: boolean;
  version?: string;
  updateType?: UpdateType;
  releaseNotes?: string;
  downloadUrl?: string;
  fileSize?: number;
  fileHash?: string;
  mandatoryFrom?: string;
  reason?: string;
}

export interface UpdateService {
  /** The shared state machine instance. */
  readonly stateMachine: UpdateStateMachine;

  /** The current machine state (convenience accessor). */
  readonly state: UpdateState;

  // -- Check --
  checkForUpdate(trigger?: CheckTrigger): Promise<CheckResult>;

  // -- Download --
  startDownload(): Promise<string>;
  pauseDownload(): void;
  resumeDownload(): Promise<string>;
  cancelDownload(): Promise<void>;
  readonly downloadProgress: DownloadProgress | null;

  // -- Install --
  installUpdate(migrations?: MigrationStep[]): Promise<InstallReport>;
  handleRollback(): Promise<void>;

  // -- Rollback detector --
  checkStartupRollback(): Promise<{ needsRollback: boolean; reason: string | null }>;

  // -- Telemetry --
  sendTelemetry(event: TelemetryEvent): Promise<void>;
  flushTelemetry(): Promise<void>;
  startTelemetryFlush(): void;
  stopTelemetryFlush(): void;

  // -- Lifecycle --
  /** Cleanup resources. Call on app teardown. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUpdateService(
  config: UpdateServiceConfig,
): UpdateService {
  return new UpdateServiceImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class UpdateServiceImpl implements UpdateService {
  readonly stateMachine = new UpdateStateMachine();

  private readonly httpClient: HttpClient;
  private readonly prisma: unknown;
  private readonly currentVersion: string;
  private readonly workstationId: string;
  private readonly licenseId: string;
  private readonly accessToken?: () => Promise<string | null>;
  private readonly backupService: BackupService;

  private downloadManager: DownloadManager | null = null;
  private installOrchestrator: InstallOrchestrator | null = null;
  private rollbackDetector: RollbackDetector | null = null;
  private telemetryService: TelemetryService;

  // External state from last check
  private lastCheckResult: CheckResult | null = null;
  private _downloadProgress: DownloadProgress | null = null;
  private checkInProgress = false;

  // Track check timestamp for min-interval enforcement
  private lastCheckTimestamp = 0;

  constructor(config: UpdateServiceConfig) {
    this.prisma = config.prisma;
    this.currentVersion = config.currentVersion;
    this.workstationId = config.workstationId;
    this.licenseId = config.licenseId ?? 'unknown';
    this.accessToken = config.accessToken;
    this.backupService = config.backupService;

    this.httpClient = createHttpClient(API_BASE_URL, {
      getAccessToken: async () => (this.accessToken ? this.accessToken() : null),
    });

    // Initialize telemetry service
    this.telemetryService = createTelemetryService({
      prisma: this.prisma,
      workstationId: this.workstationId,
      accessToken: this.accessToken,
    });

    // Initialize rollback detector
    this.rollbackDetector = createRollbackDetector({
      prisma: this.prisma,
      currentVersion: this.currentVersion,
      onRollbackRecommended: (reason) => {
        this.stateMachine.rollback();
        void this.telemetryService.enqueue({
          workstationId: this.workstationId,
          licenseId: this.licenseId,
          fromVersion: this.currentVersion,
          toVersion: null,
          attemptId: globalThis.crypto.randomUUID(),
          outcome: UpdateOutcome.ROLLED_BACK,
          errorMessage: reason,
        });
      },
    });
  }

  get state(): UpdateState {
    return this.stateMachine.state;
  }

  get downloadProgress(): DownloadProgress | null {
    return this._downloadProgress;
  }

  // -----------------------------------------------------------------------
  // Check
  // -----------------------------------------------------------------------

  async checkForUpdate(
    trigger: CheckTrigger = 'PERIODIC',
  ): Promise<CheckResult> {
    if (this.checkInProgress) {
      return this.lastCheckResult ?? { updateAvailable: false };
    }

    const strategy = getCheckStrategy(trigger);

    // Enforce minimum interval for automatic checks
    if (trigger !== 'MANUAL') {
      const elapsed = Date.now() - this.lastCheckTimestamp;
      if (elapsed < strategy.minIntervalMs && this.lastCheckResult) {
        return this.lastCheckResult;
      }
    }

    if (!isOnline()) {
      if (trigger === 'MANUAL') {
        throw new UpdateCheckFailedException(
          'Cannot check for updates while offline.',
        );
      }
      return this.lastCheckResult ?? { updateAvailable: false };
    }

    this.checkInProgress = true;
    this.stateMachine.startCheck();

    try {
      const response = await this.httpClient.get<UpdateCheckResponse>(
        '/updates/check',
        {
          currentVersion: this.currentVersion,
          workstationId: this.workstationId,
          channel: 'STABLE',
        },
      );

      this.lastCheckTimestamp = Date.now();

      if (response.updateAvailable) {
        const result: CheckResult = {
          updateAvailable: true,
          version: response.version,
          updateType: response.updateType,
          releaseNotes: response.releaseNotes,
          downloadUrl: response.downloadUrl,
          fileSize: response.fileSize,
          fileHash: response.fileHash,
          mandatoryFrom: response.mandatoryFrom,
        };

        this.lastCheckResult = result;
        this.stateMachine.updateAvailable();

        // Record check outcome in UpdateAttempt
        await this.recordAttempt(UpdateOutcome.CHECK_OK);

        return result;
      }

      this.lastCheckResult = { updateAvailable: false };
      this.stateMachine.noUpdate();

      await this.recordAttempt(UpdateOutcome.CHECK_NO_UPDATE);

      return { updateAvailable: false };
    } catch (err) {
      this.stateMachine.checkFailed();

      await this.recordAttempt(
        UpdateOutcome.CHECK_FAILED,
        err instanceof Error ? err.message : String(err),
      );

      if (trigger === 'MANUAL') {
        throw err instanceof UpdateCheckFailedException
          ? err
          : new UpdateCheckFailedException(
              err instanceof Error ? err.message : String(err),
            );
      }

      return this.lastCheckResult ?? { updateAvailable: false };
    } finally {
      this.checkInProgress = false;
    }
  }

  // -----------------------------------------------------------------------
  // Download
  // -----------------------------------------------------------------------

  async startDownload(): Promise<string> {
    if (!this.lastCheckResult?.downloadUrl) {
      throw new DownloadFailedException(
        'No update available to download. Call checkForUpdate first.',
      );
    }

    this.stateMachine.startDownload();

    const config: DownloadManagerConfig = {
      downloadUrl: this.lastCheckResult.downloadUrl,
      expectedHash: this.lastCheckResult.fileHash ?? '',
      expectedSize: this.lastCheckResult.fileSize ?? 0,
      version: this.lastCheckResult.version ?? 'unknown',
    };

    this.downloadManager = createDownloadManager(config);

    // Wire progress updates
    this.downloadManager.onProgress((progress) => {
      this._downloadProgress = progress;
    });

    // Wire state changes
    this.downloadManager.onStateChange(async (state) => {
      switch (state.status) {
        case 'completed':
          this.stateMachine.downloadComplete();
          await this.recordAttempt(UpdateOutcome.DOWNLOAD_COMPLETED);
          break;
        case 'failed':
          this.stateMachine.downloadFailed();
          await this.recordAttempt(
            UpdateOutcome.DOWNLOAD_FAILED,
            state.error,
          );
          break;
        case 'paused':
          this.stateMachine.pauseDownload();
          break;
      }
    });

    await this.recordAttempt(UpdateOutcome.DOWNLOAD_STARTED);

    try {
      const filePath = await this.downloadManager.start();
      return filePath;
    } catch (err) {
      throw err instanceof DownloadFailedException
        ? err
        : new DownloadFailedException(
            err instanceof Error ? err.message : String(err),
          );
    }
  }

  pauseDownload(): void {
    this.downloadManager?.pause();
  }

  async resumeDownload(): Promise<string> {
    if (!this.downloadManager) {
      throw new DownloadFailedException('No download to resume.');
    }
    this.stateMachine.resumeDownload();
    return this.downloadManager.start();
  }

  async cancelDownload(): Promise<void> {
    await this.downloadManager?.cancel();
    this.downloadManager = null;
    this._downloadProgress = null;
    this.stateMachine.reset();
  }

  // -----------------------------------------------------------------------
  // Install
  // -----------------------------------------------------------------------

  async installUpdate(migrations?: MigrationStep[]): Promise<InstallReport> {
    if (!this.lastCheckResult?.version) {
      throw new InstallFailedException(
        'No update available to install. Call checkForUpdate first.',
      );
    }

    this.stateMachine.startInstall();

    // The download path should have been set by startDownload.
    // If not, the orchestrator will find a reasonable path.
    const downloadPath =
      this.downloadManager?.state.status === 'completed'
        ? (this.downloadManager.state as { status: 'completed'; filePath: string }).filePath
        : '';

    this.installOrchestrator = createInstallOrchestrator({
      prisma: this.prisma,
      backupService: this.backupService,
      version: this.lastCheckResult.version,
      downloadPath,
      workstationId: this.workstationId,
      migrations,
    } satisfies InstallOrchestratorConfig);

    await this.recordAttempt(UpdateOutcome.INSTALL_STARTED);

    try {
      const report = await this.installOrchestrator.install();

      if (report.success) {
        this.stateMachine.installPendingRestart();
        await this.recordAttempt(UpdateOutcome.INSTALL_COMPLETED);
      }

      return report;
    } catch (err) {
      if (err instanceof InstallFailedException) {
        await this.recordAttempt(UpdateOutcome.INSTALL_FAILED, err.message);
      }
      this.stateMachine.rollback();
      throw err;
    }
  }

  async handleRollback(): Promise<void> {
    this.stateMachine.rollback();

    if (this.installOrchestrator) {
      await this.installOrchestrator.rollback();
    }

    await this.recordAttempt(UpdateOutcome.ROLLED_BACK);
  }

  // -----------------------------------------------------------------------
  // Rollback detector
  // -----------------------------------------------------------------------

  async checkStartupRollback(): Promise<{
    needsRollback: boolean;
    reason: string | null;
  }> {
    if (!this.rollbackDetector) {
      return { needsRollback: false, reason: null };
    }

    const result = await this.rollbackDetector.checkForRollback();

    if (result.needsRollback) {
      this.stateMachine.rollback();
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Telemetry
  // -----------------------------------------------------------------------

  async sendTelemetry(event: TelemetryEvent): Promise<void> {
    await this.telemetryService.enqueue(event);
  }

  async flushTelemetry(): Promise<void> {
    await this.telemetryService.flush();
  }

  startTelemetryFlush(): void {
    this.telemetryService.start();
  }

  stopTelemetryFlush(): void {
    this.telemetryService.stop();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this.stopTelemetryFlush();
    void this.cancelDownload();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async recordAttempt(
    outcome: UpdateOutcome,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const toVersion = outcome === UpdateOutcome.CHECK_NO_UPDATE
        ? null
        : (this.lastCheckResult?.version ?? null);

      const db = this.prisma as any;
      await db.updateAttempt.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          at: new Date(),
          fromVersion: this.currentVersion,
          toVersion,
          outcome,
          errorMessage: errorMessage ?? null,
          durationMs: null,
        },
      });
    } catch {
      // Best-effort: audit logging failure should not break the update flow.
      console.warn('[update.service] Failed to record UpdateAttempt:', outcome);
    }
  }
}
