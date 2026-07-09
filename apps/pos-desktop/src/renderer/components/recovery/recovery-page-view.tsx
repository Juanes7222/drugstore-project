/**
 * Presentational component for the recovery page.
 *
 * Styled POS admin table view with status banners, backup list,
 * restore confirmation modal, and audit log tab.
 */

import { type FC, type ReactNode, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  BackupHealthLevel,
  BackupMetadata,
  BackupStatus,
  VerificationReport,
} from "../../../domain/backup/backup.service";
import type { RecoveryLogEntry } from "../../../domain/backup/recovery-log.service";

export type RecoveryHealthStatus = "HEALTHY" | "UNHEALTHY_SHUTDOWN" | "INTEGRITY_FAILED";

export interface BackupViewModel extends BackupMetadata {
  ageText: string;
  isVerifying: boolean;
}

export interface RecoveryPageViewProps {
  loading: boolean;
  error: string | null;
  healthStatus: RecoveryHealthStatus;
  backupHealth: BackupHealthLevel;
  backups: BackupViewModel[];
  logEntries: RecoveryLogEntry[];
  activeTab: "backups" | "log";
  selectedBackup: BackupMetadata | null;
  verifyReport: VerificationReport | null;
  restoreConfirmText: string;
  isRestoring: boolean;
  isCreatingBackup: boolean;
  gapHint: number | null;
  onRefresh: () => void;
  onCreateBackup: () => void;
  onVerify: (id: string) => void;
  onSelectBackup: (backup: BackupMetadata) => void;
  onRestore: () => void;
  onCancelRestore: () => void;
  onConfirmTextChange: (text: string) => void;
  onTabChange: (tab: "backups" | "log") => void;
}

export const RecoveryPageView: FC<RecoveryPageViewProps> = ({
  loading,
  error,
  healthStatus,
  backupHealth,
  backups,
  logEntries,
  activeTab,
  selectedBackup,
  verifyReport,
  restoreConfirmText,
  isRestoring,
  isCreatingBackup,
  gapHint,
  onRefresh,
  onCreateBackup,
  onVerify,
  onSelectBackup,
  onRestore,
  onCancelRestore,
  onConfirmTextChange,
  onTabChange,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-6" aria-label={t("recovery.title")}>
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-pharma border-r-pharma border-transparent" />
          <p className="text-gray-500">{t("recovery.loading")}</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full items-center justify-center p-6" aria-label={t("recovery.title")}>
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">{t("recovery.error_title")}</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <button
            type="button"
            className="pos-button pos-button-primary mt-4"
            onClick={onRefresh}
          >
            {t("recovery.retry")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full overflow-hidden bg-slate-50" aria-label={t("recovery.title")}>
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="pos-page-title mb-6">{t("recovery.title")}</h1>

        <StatusBanner healthStatus={healthStatus} />
        <BackupHealthBanner backupHealth={backupHealth} />

        {error && (
          <div
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="pos-button pos-button-secondary"
            onClick={onRefresh}
            disabled={isCreatingBackup || isRestoring}
          >
            {t("recovery.refresh")}
          </button>
          <button
            type="button"
            className="pos-button pos-button-primary"
            onClick={onCreateBackup}
            disabled={isCreatingBackup || isRestoring}
          >
            {isCreatingBackup ? t("recovery.creating_backup") : t("recovery.create_backup")}
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-md border border-gray-200 bg-white p-1 shadow-sm">
          <TabButton
            isActive={activeTab === "backups"}
            onClick={() => onTabChange("backups")}
          >
            {t("recovery.tab_backups")}
          </TabButton>
          <TabButton
            isActive={activeTab === "log"}
            onClick={() => onTabChange("log")}
          >
            {t("recovery.tab_log")}
          </TabButton>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          {activeTab === "backups" && (
            <BackupList backups={backups} onVerify={onVerify} onSelect={onSelectBackup} />
          )}
          {activeTab === "log" && <AuditLog entries={logEntries} />}
        </div>
      </div>

      {selectedBackup && (
        <RestoreModal
          backup={selectedBackup}
          verifyReport={verifyReport}
          gapHint={gapHint}
          confirmText={restoreConfirmText}
          isRestoring={isRestoring}
          onConfirmTextChange={onConfirmTextChange}
          onRestore={onRestore}
          onCancel={onCancelRestore}
        />
      )}
    </section>
  );
};

// ── Status banners ────────────────────────────────────────────────────────

const StatusBanner: FC<{ healthStatus: RecoveryHealthStatus }> = ({ healthStatus }) => {
  const { t } = useTranslation();

  if (healthStatus === "HEALTHY") {
    return (
      <div
        className="mb-4 rounded-r-md border-l-4 border-green-600 bg-green-50 px-4 py-3 text-sm font-medium text-green-800"
        role="status"
      >
        {t("recovery.status_healthy")}
      </div>
    );
  }

  if (healthStatus === "UNHEALTHY_SHUTDOWN") {
    return (
      <div
        className="mb-4 rounded-r-md border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        role="status"
      >
        {t("recovery.status_unhealthy_shutdown")}
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-r-md border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
      role="alert"
    >
      {t("recovery.status_integrity_failed")}
    </div>
  );
};

const BackupHealthBanner: FC<{ backupHealth: BackupHealthLevel }> = ({ backupHealth }) => {
  const { t } = useTranslation();

  if (backupHealth === "CRITICAL") {
    return (
      <div
        className="mb-4 rounded-r-md border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        role="alert"
      >
        {t("recovery.backup_status_critical")}
      </div>
    );
  }

  if (backupHealth === "STALE") {
    return (
      <div
        className="mb-4 rounded-r-md border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        role="status"
      >
        {t("recovery.backup_status_stale")}
      </div>
    );
  }

  return null;
};

// ── Tabs ──────────────────────────────────────────────────────────────────

interface TabButtonProps {
  isActive: boolean;
  onClick: () => void;
  children: ReactNode;
}

const TabButton: FC<TabButtonProps> = ({ isActive, onClick, children }) => (
  <button
    type="button"
      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-pharma text-white"
        : "text-gray-600 hover:bg-gray-100"
    }`}
    aria-pressed={isActive}
    onClick={onClick}
  >
    {children}
  </button>
);

// ── Backup list ───────────────────────────────────────────────────────────

interface BackupListProps {
  backups: BackupViewModel[];
  onVerify: (id: string) => void;
  onSelect: (backup: BackupMetadata) => void;
}

const BackupList: FC<BackupListProps> = ({ backups, onVerify, onSelect }) => {
  const { t } = useTranslation();

  if (backups.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">{t("recovery.no_backups")}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_created")}
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_reason")}
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_size")}
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_pending")}
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_failed")}
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_status")}
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_actions")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {backups.map((backup) => {
            const isCorrupt = backup.status === "CORRUPT";
            return (
              <tr
                key={backup.id}
                className={`${isCorrupt ? "opacity-50" : "hover:bg-gray-50"}`}
              >
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  <div>{new Date(backup.createdAt).toLocaleString()}</div>
                  <div className="text-xs text-gray-400">{backup.ageText}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {t(`recovery.reason_${backup.reason.toLowerCase()}` as const)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-data text-gray-700">
                  {formatBytes(backup.sizeBytes)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-data text-gray-700">
                  {backup.pendingCount.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-data text-gray-700">
                  {backup.failedCount.toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={backup.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {!isCorrupt ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                        onClick={() => onVerify(backup.id)}
                        disabled={backup.isVerifying || isCorrupt}
                        aria-label={t("recovery.action_verify")}
                      >
                        {backup.isVerifying ? t("recovery.action_verifying") : t("recovery.action_verify")}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        onClick={() => onSelect(backup)}
                        disabled={backup.isVerifying}
                        aria-label={t("recovery.action_restore")}
                      >
                        {t("recovery.action_restore")}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">{t("recovery.status_corrupt")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const StatusBadge: FC<{ status: BackupStatus }> = ({ status }) => {
  const { t } = useTranslation();

  if (status === "CORRUPT") {
    return (
      <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        {t("recovery.status_corrupt")}
      </span>
    );
  }

  return (
    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      {t("recovery.status_healthy_short")}
    </span>
  );
};

// ── Restore modal ─────────────────────────────────────────────────────────

interface RestoreModalProps {
  backup: BackupMetadata;
  verifyReport: VerificationReport | null;
  gapHint: number | null;
  confirmText: string;
  isRestoring: boolean;
  onConfirmTextChange: (text: string) => void;
  onRestore: () => void;
  onCancel: () => void;
}

const RestoreModal: FC<RestoreModalProps> = ({
  backup,
  verifyReport,
  gapHint,
  confirmText,
  isRestoring,
  onConfirmTextChange,
  onRestore,
  onCancel,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreEnabled = confirmText.trim() === "RESTORE" && !isRestoring;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isRestoring) {
        onCancel();
      }
    },
    [isRestoring, onCancel],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const ageText = formatAge(backup.createdAt, t);
  const dataLossText =
    gapHint == null
      ? t("recovery.modal_data_loss_unknown")
      : t("recovery.modal_data_loss", { count: gapHint });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-modal-title"
      onClick={() => !isRestoring && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="restore-modal-title" className="mb-4 text-lg font-bold text-gray-800">
          {t("recovery.modal_title")}
        </h2>

        <p className="mb-3 text-sm text-gray-600">
          {t("recovery.modal_timestamp", {
            timestamp: new Date(backup.createdAt).toLocaleString(),
            age: ageText,
          })}
        </p>

        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">
          {dataLossText}
        </div>

        <div className="mb-4 space-y-1 text-sm text-gray-700">
          <p>{t("recovery.modal_pending", { count: backup.pendingCount })}</p>
          <p>{t("recovery.modal_failed", { count: backup.failedCount })}</p>
        </div>

        <div className="mb-4 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            {t("recovery.modal_verification")}:
            {" "}
            {verifyReport ? (
              verifyReport.passed ? (
                <span className="text-green-700">{t("recovery.modal_verification_passed")}</span>
              ) : (
                <span className="text-red-700">{t("recovery.modal_verification_failed")}</span>
              )
            ) : (
              <span className="text-gray-500">{t("recovery.modal_verification_none")}</span>
            )}
          </p>
          {verifyReport?.error && (
            <p className="mt-1 text-xs text-red-600">{verifyReport.error}</p>
          )}
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t("recovery.modal_confirm_label")}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={confirmText}
            onChange={(event) => onConfirmTextChange(event.target.value)}
            disabled={isRestoring}
            className="pos-input"
            autoComplete="off"
            aria-required="true"
          />
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="pos-button pos-button-secondary"
            onClick={onCancel}
            disabled={isRestoring}
          >
            {t("recovery.action_cancel")}
          </button>
          <button
            type="button"
            className="pos-button bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            onClick={onRestore}
            disabled={!restoreEnabled}
          >
            {isRestoring ? t("recovery.modal_restoring") : t("recovery.action_restore")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Audit log ─────────────────────────────────────────────────────────────

interface AuditLogProps {
  entries: RecoveryLogEntry[];
}

const AuditLog: FC<AuditLogProps> = ({ entries }) => {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">{t("recovery.no_log_entries")}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_time")}
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_action")}
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_actor")}
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
              {t("recovery.table_backup")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {entry.at.toLocaleString()}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                {t(`recovery.action_${entry.action}` as const)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">
                {entry.actorUserId}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                {entry.backupId ?? t("recovery.backup_none")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatAge(isoString: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return t("recovery.age_just_now");
  if (diffMin < 60) return t("recovery.age_minutes_ago", { count: diffMin });
  if (diffHours < 24) return t("recovery.age_hours_ago", { count: diffHours });
  return t("recovery.age_days_ago", { count: diffDays });
}
