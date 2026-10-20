export type UpdateChannel = "STABLE" | "BETA";

export type UpdateType = "CRITICAL" | "MANDATORY" | "OPTIONAL" | "HOTFIX";

export type RolloutStrategy = "PHASED" | "INSTANT";

export type UpdateVersionState =
  | "DRAFT"
  | "ROLLING_OUT"
  | "PAUSED"
  | "FULLY_DEPLOYED"
  | "ROLLED_BACK";

/** One published update version, as returned by GET /admin/updates/versions. */
export interface UpdateVersionRow {
  id: string;
  version: string;
  channel: UpdateChannel;
  updateType: UpdateType;
  state: UpdateVersionState;
  rolloutStrategy: RolloutStrategy;
  releaseNotes: string;
  releaseDate: string;
  fileSize: number;
  fileHash: string;
  downloadUrl: string;
  isActive: boolean;
  isPaused: boolean;
  pausedReason: string | null;
}

export interface UpdateVersionTelemetry {
  successRate: number;
  totalInstalls: number;
  totalRollbacks: number;
  uniqueWorkstations: number;
  errorBreakdown: Array<{
    outcome: string;
    count: number;
    sampleError: string | null;
  }>;
  failedWorkstations: Array<{
    workstationId: string;
    errorMessage: string | null;
  }>;
}

export interface UpdateVersionDetail extends UpdateVersionRow {
  telemetry: UpdateVersionTelemetry;
}

/** Metadata sent with the binary on POST /admin/updates/versions. */
export interface PublishUpdateMetadata {
  version: string;
  channel: UpdateChannel;
  updateType: UpdateType;
  rolloutStrategy: RolloutStrategy;
  releaseNotes: string;
}

export interface UpdateTelemetrySummary {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  rollbackCount: number;
  byOutcome: Record<string, number>;
}
