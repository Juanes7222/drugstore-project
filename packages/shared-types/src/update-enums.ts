/**
 * Shared enums for the auto-update system.
 *
 * These types are consumed by both the server (apps/server) and the
 * POS desktop (apps/pos-desktop).  Every enum value maps to a Prisma
 * enum of the same name in the server-only or local-only schema
 * fragments respectively.
 */

/** The type of an update — determines the user-facing UX. */
export enum UpdateType {
  CRITICAL = "CRITICAL",
  MANDATORY = "MANDATORY",
  OPTIONAL = "OPTIONAL",
  HOTFIX = "HOTFIX",
}

/** Distribution channel. */
export enum UpdateChannel {
  STABLE = "STABLE",
  BETA = "BETA",
}

/** Rollout strategy for an update version. */
export enum RolloutStrategy {
  PHASED = "PHASED",
  INSTANT = "INSTANT",
}

/** Client-side update-state-machine states. */
export enum UpdateStateMachine {
  IDLE = "IDLE",
  CHECKING = "CHECKING",
  UPDATE_AVAILABLE = "UPDATE_AVAILABLE",
  DOWNLOADING = "DOWNLOADING",
  DOWNLOAD_PAUSED = "DOWNLOAD_PAUSED",
  DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
  READY_TO_INSTALL = "READY_TO_INSTALL",
  INSTALLING = "INSTALLING",
  INSTALLED_PENDING_RESTART = "INSTALLED_PENDING_RESTART",
  INSTALLED_VERIFIED = "INSTALLED_VERIFIED",
  ROLLED_BACK = "ROLLED_BACK",
  NO_UPDATE = "NO_UPDATE",
  CHECK_FAILED = "CHECK_FAILED",
}

/** Download status stored in the local UpdateState singleton. */
export enum DownloadStatus {
  NOT_DOWNLOADED = "NOT_DOWNLOADED",
  DOWNLOADING = "DOWNLOADING",
  DOWNLOADED = "DOWNLOADED",
  FAILED = "FAILED",
}

/** Install status stored in the local UpdateState singleton. */
export enum InstallStatus {
  NOT_INSTALLED = "NOT_INSTALLED",
  READY_TO_INSTALL = "READY_TO_INSTALL",
  INSTALLING = "INSTALLING",
  INSTALLED_PENDING_RESTART = "INSTALLED_PENDING_RESTART",
  INSTALLED_VERIFIED = "INSTALLED_VERIFIED",
  ROLLED_BACK = "ROLLED_BACK",
}

/** Outcome of an individual update attempt (telemetry event). */
export enum UpdateOutcome {
  CHECK_OK = "CHECK_OK",
  CHECK_NO_UPDATE = "CHECK_NO_UPDATE",
  CHECK_FAILED = "CHECK_FAILED",
  DOWNLOAD_STARTED = "DOWNLOAD_STARTED",
  DOWNLOAD_COMPLETED = "DOWNLOAD_COMPLETED",
  DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
  INSTALL_STARTED = "INSTALL_STARTED",
  INSTALL_COMPLETED = "INSTALL_COMPLETED",
  INSTALL_FAILED = "INSTALL_FAILED",
  MIGRATION_STARTED = "MIGRATION_STARTED",
  MIGRATION_COMPLETED = "MIGRATION_COMPLETED",
  MIGRATION_FAILED = "MIGRATION_FAILED",
  RESTARTED_OK = "RESTARTED_OK",
  ROLLED_BACK = "ROLLED_BACK",
  TELEMETRY_SENT = "TELEMETRY_SENT",
}

/** Lifecycle state of an UpdateVersion row on the server. */
export enum UpdateVersionState {
  DRAFT = "DRAFT",
  ROLLING_OUT = "ROLLING_OUT",
  PAUSED = "PAUSED",
  FULLY_DEPLOYED = "FULLY_DEPLOYED",
  ROLLED_BACK = "ROLLED_BACK",
}
