/**
 * Right-side slide-out drawer showing details for a single sync entry.
 *
 * Displays permanent failure / stale-pending entry metadata, a retry
 * history section, and a recovery actions section.  Both history sections
 * show empty states when no data is available.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";
import { formatRelativeTime } from "../../../common/time-format";

interface EntryDetailDrawerProps {
  entry: PermanentFailureEntry;
  onClose: () => void;
}

export const EntryDetailDrawer: FC<EntryDetailDrawerProps> = ({
  entry,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col overflow-y-auto border-l border-gray-200 bg-white shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t("sync.entry_detail_title", "Entry detail")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-800">
            {t("sync.entry_detail_title", "Entry Detail")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400"
            aria-label={t("common.close", "Close")}
          >
            <svg
              className="h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 p-4">
          {/* Entry Metadata */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("sync.detail_metadata", "Details")}
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_operation", "Operation")}
                </dt>
                <dd className="font-mono text-gray-800">{entry.operationType}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">UUID</dt>
                <dd className="max-w-[180px] truncate font-mono text-xs text-gray-600">
                  {entry.operationUuid}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_status", "Status")}
                </dt>
                <dd>
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    PERMANENT_FAILURE
                  </span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_category", "Category")}
                </dt>
                <dd className="text-gray-800">
                  {entry.failureCategory ?? "\u2014"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_error", "Error")}
                </dt>
                <dd className="max-w-[200px] text-right font-mono text-xs text-red-600">
                  {entry.lastErrorMessage ?? "\u2014"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_retries", "Retries")}
                </dt>
                <dd className="font-mono tabular-nums text-gray-800">
                  {entry.retryCount.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_created", "Created")}
                </dt>
                <dd className="font-mono text-xs text-gray-600">
                  {formatRelativeTime(entry.sourceCreatedAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">
                  {t("sync.detail_last_attempt", "Last Attempt")}
                </dt>
                <dd className="font-mono text-xs text-gray-600">
                  {entry.lastAttemptAt
                    ? formatRelativeTime(entry.lastAttemptAt)
                    : "\u2014"}
                </dd>
              </div>
            </dl>
          </section>

          {/* Payload Preview */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("sync.detail_payload_preview", "Payload Preview")}
            </h3>
            <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">
              {entry.payloadPreview || t("sync.no_payload", "No payload data")}
            </pre>
          </section>

          {/* Retry History */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("sync.detail_retry_history", "Retry History")}
            </h3>
            <div className="rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-400">
              {t(
                "sync.retry_history_empty",
                "No retry history available for this entry.",
              )}
            </div>
          </section>

          {/* Recovery Actions */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {t("sync.detail_recovery_actions", "Recovery Actions")}
            </h3>
            <div className="rounded-lg bg-gray-50 p-4 text-center text-sm text-gray-400">
              {t(
                "sync.recovery_actions_empty",
                "No recovery actions have been recorded.",
              )}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
};
