/**
 * Toolbar row for Sync Health actions.
 *
 * Connection testing (with animated spinner), manual sync trigger, CSV/JSON
 * export, and toggles for retry-without-check and showing discarded entries.
 * Uses design-system tokens and shared ui/icons components.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircleIcon, FileDownIcon, FileJsonIcon, RadioIcon, RefreshCwIcon, XCircleIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import type { ConnectionStatus } from "./sync-health.types";
import { AuthStatusBadge } from "./auth-status-badge";

interface ActionBarProps {
  connectionStatus: ConnectionStatus;
  onTestConnection: () => void;
  onRunSyncNow: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  retryWithoutCheck: boolean;
  onRetryWithoutCheckChange: (v: boolean) => void;
  showDiscarded: boolean;
  onShowDiscardedChange: (v: boolean) => void;
}

export const ActionBar: FC<ActionBarProps> = ({
  connectionStatus,
  onTestConnection,
  onRunSyncNow,
  onExportCsv,
  onExportJson,
  retryWithoutCheck,
  onRetryWithoutCheckChange,
  showDiscarded,
  onShowDiscardedChange,
}) => {
  const { t } = useTranslation();

  const handleTestConnection = useCallback(() => {
    onTestConnection();
  }, [onTestConnection]);

  const handleRunSyncNow = useCallback(() => {
    onRunSyncNow();
  }, [onRunSyncNow]);

  const handleExportCsv = useCallback(() => {
    onExportCsv();
  }, [onExportCsv]);

  const handleExportJson = useCallback(() => {
    onExportJson();
  }, [onExportJson]);

  const handleRetryCheckChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onRetryWithoutCheckChange(e.target.checked);
    },
    [onRetryWithoutCheckChange],
  );

  const handleShowDiscardedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onShowDiscardedChange(e.target.checked);
    },
    [onShowDiscardedChange],
  );

  const isTesting = connectionStatus.type === "testing";
  const isReachable = connectionStatus.type === "reachable";
  const isUnreachable = connectionStatus.type === "unreachable";

  const testBtnStyle = isTesting
    ? "bg-ink/8 text-ink-muted cursor-wait"
    : isReachable
      ? "bg-success-container text-success hover:brightness-95"
      : isUnreachable
        ? "bg-error-container text-error hover:brightness-95"
        : "bg-surface text-ink hover:bg-surface-variant";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-panel p-4 shadow-pos-panel">
      <AuthStatusBadge />

      {/* Test connection */}
      <button
        type="button"
        onClick={handleTestConnection}
        disabled={isTesting}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-pharma focus:ring-offset-2 ${testBtnStyle}`}
      >
        {isTesting ? (
          <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : isReachable ? (
          <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
        ) : isUnreachable ? (
          <XCircleIcon className="h-4 w-4" aria-hidden="true" />
        ) : (
          <RadioIcon className="h-4 w-4" aria-hidden="true" />
        )}
        {isReachable
          ? t("sync.connected_label")
          : isUnreachable
            ? t("sync.unreachable_label")
            : t("sync.test_connection")}
      </button>

      {/* Connection status feedback */}
      <AnimatePresence>
        {connectionStatus.type === "reachable" && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="text-caption text-success"
          >
            {t("sync.server_reachable")}
          </motion.span>
        )}
        {connectionStatus.type === "unreachable" && (
          <motion.span
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="text-caption text-error"
          >
            {connectionStatus.message ??
              t("sync.server_unreachable")}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Run sync now */}
      <button
        type="button"
        onClick={handleRunSyncNow}
        className="inline-flex items-center gap-2 rounded-md bg-pharma px-3 py-1.5 text-body-sm font-medium text-panel shadow-sm transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-pharma focus:ring-offset-2"
      >
        <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
        {t("sync.run_sync_now")}
      </button>

      {/* Export CSV */}
      <button
        type="button"
        onClick={handleExportCsv}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-body-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-pharma focus:ring-offset-2"
      >
        <FileDownIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        {t("sync.export_csv")}
      </button>

      {/* Export JSON */}
      <button
        type="button"
        onClick={handleExportJson}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-body-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-pharma focus:ring-offset-2"
      >
        <FileJsonIcon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        {t("sync.export_json")}
      </button>

      <div className="flex flex-1 items-center justify-end gap-4">
        {/* Retry without server check */}
        <label className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
          <input
            type="checkbox"
            checked={retryWithoutCheck}
            onChange={handleRetryCheckChange}
            className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma"
          />
          {t("sync.retry_without_check")}
        </label>

        {/* Show discarded */}
        <label className="inline-flex items-center gap-2 text-body-sm text-ink-muted">
          <input
            type="checkbox"
            checked={showDiscarded}
            onChange={handleShowDiscardedChange}
            className="h-4 w-4 rounded border-border text-pharma focus:ring-pharma"
          />
          {t("sync.show_discarded")}
        </label>
      </div>
    </div>
  );
};
