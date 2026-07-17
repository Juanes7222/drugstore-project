/**
 * Toolbar row for Sync Health actions.
 *
 * Provides connection testing (with animated spinner while in progress),
 * manual sync trigger, CSV/JSON export, and toggles for retry-without-check
 * and showing discarded entries.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
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

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Auth status badge — shows token refresh state from the SyncScheduler */}
      <AuthStatusBadge />

      {/* Test connection button */}
      <button
        type="button"
        onClick={handleTestConnection}
        disabled={isTesting}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          isTesting
            ? "cursor-wait bg-gray-100 text-gray-400"
            : isReachable
              ? "bg-green-50 text-green-700 hover:bg-green-100 focus:ring-green-500"
              : isUnreachable
                ? "bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-500"
                : "bg-gray-50 text-gray-700 hover:bg-gray-100 focus:ring-gray-500"
        }`}
      >
        {isTesting && (
          <svg
            className="h-4 w-4 animate-spin text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {isReachable && (
          <svg
            className="h-4 w-4 text-green-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {isUnreachable && (
          <svg
            className="h-4 w-4 text-red-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
        )}
        {t("sync.test_connection", "Test connection")}
      </button>

      {/* Run sync now */}
      <button
        type="button"
        onClick={handleRunSyncNow}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <svg
          className="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
            clipRule="evenodd"
          />
        </svg>
        {t("sync.run_sync_now", "Run sync now")}
      </button>

      {/* Export CSV */}
      <button
        type="button"
        onClick={handleExportCsv}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
      >
        {t("sync.export_csv", "Export CSV")}
      </button>

      {/* Export JSON */}
      <button
        type="button"
        onClick={handleExportJson}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
      >
        {t("sync.export_json", "Export JSON")}
      </button>

      <div className="flex flex-1 items-center justify-end gap-4">
        {/* Retry without server check */}
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={retryWithoutCheck}
            onChange={handleRetryCheckChange}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t("sync.retry_without_check", "Retry without server check")}
        </label>

        {/* Show discarded */}
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showDiscarded}
            onChange={handleShowDiscardedChange}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t("sync.show_discarded", "Show discarded")}
        </label>
      </div>
    </div>
  );
};
