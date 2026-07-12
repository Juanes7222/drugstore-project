/**
 * Shared TypeScript interfaces for the auto-update system.
 *
 * These types mirror the Prisma models but are importable without a Prisma
 * client dependency, making them suitable for shared-validation DTOs and
 * for the POS desktop's domain layer.
 */
import type {
  UpdateType,
  UpdateChannel,
  RolloutStrategy,
  UpdateStateMachine,
  DownloadStatus,
  InstallStatus,
  UpdateOutcome,
  UpdateVersionState,
} from "./update-enums";

/** Server-side version record (maps to UpdateVersion model). */
export interface UpdateVersion {
  id: string;
  version: string;
  channel: UpdateChannel;
  downloadUrl: string;
  signature: string;
  fileSize: number;
  fileHash: string;
  releaseNotes: string;
  releaseDate: string;
  updateType: UpdateType;
  state: UpdateVersionState;
  mandatoryFrom: string | null;
  rolloutStrategy: RolloutStrategy;
  rolloutStartDate: string;
  rolloutSchedule: Array<{ percent: number; afterDays: number }>;
  minAppVersion: string | null;
  maxAppVersion: string | null;
  requiredPlanFeatures: string[];
  minPlan: string | null;
  isActive: boolean;
  isPaused: boolean;
  pausedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Client-side update state singleton (maps to local UpdateState). */
export interface UpdateState {
  id: string;
  currentVersion: string;
  lastCheckAt: string | null;
  lastAvailableVersion: string | null;
  lastAvailableType: UpdateType | null;
  lastAvailableChangelog: string | null;
  lastAvailableDownloadUrl: string | null;
  lastAvailableSignature: string | null;
  lastAvailableFileSize: number | null;
  downloadStatus: DownloadStatus | null;
  downloadProgress: number;
  installStatus: InstallStatus | null;
  crashCount: number;
  lastErrorMessage: string | null;
  userDismissedVersion: string | null;
  channel: UpdateChannel;
  autoDownload: boolean;
  installOnClose: boolean;
}

/** Telemetry / audit record (maps to UpdateAttempt / UpdateAttemptLog). */
export interface UpdateAttempt {
  id: string;
  at: string;
  fromVersion: string;
  toVersion: string | null;
  outcome: UpdateOutcome;
  errorMessage: string | null;
  durationMs: number | null;
}

/** Response shape of GET /updates/check. */
export interface UpdateCheckResponse {
  updateAvailable: boolean;
  version?: string;
  downloadUrl?: string;
  signature?: string;
  fileSize?: number;
  fileHash?: string;
  releaseNotes?: string;
  updateType?: UpdateType;
  mandatoryFrom?: string;
  rolloutPercentage?: number;
  minAppVersion?: string;
  maxAppVersion?: string;
  reason?: string;
}

/** Body of POST /updates/telemetry. */
export interface UpdateTelemetryPayload {
  workstationId: string;
  licenseId: string;
  fromVersion: string;
  toVersion: string | null;
  attemptId: string;
  outcome: UpdateOutcome;
  errorMessage?: string;
  durationMs?: number;
  occurredAt: string;
  signature: string;
}

/** Rollout schedule step. */
export interface RolloutScheduleStep {
  percent: number;
  afterDays: number;
}

/** Schema migration step inside an update bundle. */
export interface MigrationStep {
  name: string;
  type: "PRISMA" | "SQL" | "CUSTOM";
  payload: unknown;
}

/** Migration log entry (local MigrationLog table). */
export interface MigrationLogEntry {
  id: string;
  name: string;
  appliedAt: string;
  success: boolean;
  errorMessage: string | null;
}
