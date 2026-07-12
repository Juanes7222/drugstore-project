/**
 * Auto-update domain module — barrel exports.
 *
 * Every public type and factory function that other modules or the UI layer
 * may consume is re-exported here. Internal helpers stay private to their
 * respective files.
 */

export { createUpdateService, type UpdateService, type UpdateServiceConfig, type CheckResult } from './update.service';
export { useUpdateStore, getUpdateStoreState, type UpdateStoreState } from './update.store';
export { UpdateStateMachine, IllegalStateTransitionException, type UpdateState, type InstallOutcome } from './state-machine';
export { getCheckStrategy, getDefaultMinIntervalMs, type CheckTrigger, type CheckStrategyConfig } from './check-strategy';
export { createDownloadManager, type DownloadManager, type DownloadManagerConfig, type DownloadProgress, type DownloadState } from './download-manager';
export { createInstallOrchestrator, type InstallOrchestrator, type InstallOrchestratorConfig, type InstallReport, type InstallPreCheckResult } from './install-orchestrator';
export { createMigrationRunner, type MigrationRunner, type MigrationRunnerConfig } from './migration-runner';
export { createRollbackDetector, type RollbackDetector, type RollbackDetectorConfig } from './rollback-detector';
export { createTelemetryService, type TelemetryService, type TelemetryServiceConfig, type TelemetryEvent } from './telemetry.service';
export {
  UpdateCheckFailedException,
  DownloadFailedException,
  InstallFailedException,
  MigrationFailedException,
  RollbackDetectedException,
} from './exceptions';
