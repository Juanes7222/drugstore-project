/**
 * Table section for sync error entries with sorting, filtering, and actions.
 *
 * Displays a sortable table of permanent failure and stale-pending entries
 * with colored left-border indicators. Admin-level actions (retry, discard)
 * are shown only for ADMIN roles.  Supports pagination via a "Load more"
 * button.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";
import { RoleType } from "@pharmacy/shared-types";
import { formatRelativeTime } from "../../../common/time-format";
import type { SortField, SortDir } from "./sync-health.types";

interface EntriesSectionProps {
  entries: PermanentFailureEntry[];
  actionLoading: string | null;
  sortField: SortField;
  sortDir: SortDir;
  hasMore: boolean;
  selectedCategory: string | null;
  showDiscarded: boolean;
  retryDisabledMessage?: string;
  sessionRole: string | undefined;
  onSort: (field: SortField) => void;
  onRetry?: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
  onSelect: (entry: PermanentFailureEntry) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}

type SortableColumn = {
  field: SortField;
  labelKey: string;
  labelFallback: string;
};

const SORTABLE_COLUMNS: SortableColumn[] = [
  { field: "operationType", labelKey: "sync.col_operation", labelFallback: "Operation" },
  { field: "lastAttemptAt", labelKey: "sync.col_last_attempt", labelFallback: "Last Attempt" },
  { field: "retryCount", labelKey: "sync.col_retries", labelFallback: "Retries" },
];

function getSortIndicator(
  field: SortField,
  sortField: SortField,
  sortDir: SortDir,
): string {
  if (sortField !== field) return "\u2195"; // ↕
  return sortDir === "asc" ? "\u2191" : "\u2193"; // ↑ or ↓
}

function getRowBorderClass(entry: PermanentFailureEntry): string {
  // Stale-pending entries (not yet permanent failures) get a yellow border;
  // permanent failures get red.
  if (entry.retryCount === 0 && entry.lastErrorMessage === null) {
    return "border-l-yellow-400";
  }
  return "border-l-red-500";
}

export const EntriesSection: FC<EntriesSectionProps> = ({
  entries,
  actionLoading,
  sortField,
  sortDir,
  hasMore,
  selectedCategory,
  showDiscarded,
  retryDisabledMessage,
  sessionRole,
  onSort,
  onRetry,
  onDiscard,
  onSelect,
  onLoadMore,
  onRefresh,
}) => {
  const { t } = useTranslation();

  const isAdmin = sessionRole === RoleType.ADMIN;

  const handleSort = useCallback(
    (field: SortField) => () => {
      onSort(field);
    },
    [onSort],
  );

  const handleRetry = useCallback(
    (entryId: string) => () => {
      onRetry?.(entryId);
    },
    [onRetry],
  );

  const handleDiscard = useCallback(
    (entryId: string) => () => {
      onDiscard(entryId);
    },
    [onDiscard],
  );

  const handleSelect = useCallback(
    (entry: PermanentFailureEntry) => () => {
      onSelect(entry);
    },
    [onSelect],
  );

  const handleLoadMore = useCallback(() => {
    onLoadMore();
  }, [onLoadMore]);

  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="mb-6">
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700">
            {t("sync.entries_title", "Error Entries")}
            {selectedCategory && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({t("sync.entries_filtered_by", {
                  defaultValue: "filtered: {{category}}",
                  category: selectedCategory,
                })})
              </span>
            )}
            {showDiscarded && (
              <span className="ml-2 inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                {t("sync.showing_discarded", "Showing discarded")}
              </span>
            )}
          </h3>
          {entries.length > 0 && (
            <span className="text-xs text-gray-400 tabular-nums">
              {entries.length.toLocaleString()}{" "}
              {t("sync.entries_count", "entries")}
            </span>
          )}
        </div>

        {/* Table */}
        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-gray-400">
              {t("sync.entries_empty", "No error entries found.")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("sync.col_type", "Type")}
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("sync.col_preview", "Preview")}
                  </th>
                  {SORTABLE_COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      className="cursor-pointer select-none px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500 hover:text-gray-700"
                      onClick={handleSort(col.field)}
                      aria-sort={
                        sortField === col.field
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {t(col.labelKey, col.labelFallback)}
                        <span className="text-gray-300">
                          {getSortIndicator(col.field, sortField, sortDir)}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("sync.col_category", "Category")}
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("sync.col_error", "Error")}
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                      {t("sync.col_actions", "Actions")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const isLoading = actionLoading === entry.id;

                  return (
                    <tr
                      key={entry.id}
                      className={`border-b border-gray-100 border-l-4 transition-colors hover:bg-gray-50 ${getRowBorderClass(entry)}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {entry.operationType}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-500">
                        <button
                          type="button"
                          onClick={handleSelect(entry)}
                          className="truncate text-left text-gray-600 underline-offset-2 hover:underline"
                          title={t("sync.view_details", "View details")}
                        >
                          {entry.payloadPreview}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-gray-600">
                        {entry.lastAttemptAt
                          ? formatRelativeTime(entry.lastAttemptAt)
                          : "\u2014"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-gray-600">
                        {entry.retryCount.toLocaleString()}
                      </td>
                      <td className="max-w-[150px] truncate px-4 py-3 text-xs text-gray-600">
                        {entry.failureCategory ?? "\u2014"}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-red-600">
                        {entry.lastErrorMessage ?? "\u2014"}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleRetry(entry.id)}
                              disabled={
                                isLoading ||
                                actionLoading !== null ||
                                Boolean(retryDisabledMessage)
                              }
                              title={retryDisabledMessage}
                              className="rounded px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
                            >
                              {isLoading
                                ? t("common.loading", "Loading\u2026")
                                : t("common.retry", "Retry")}
                            </button>
                            <button
                              type="button"
                              onClick={handleDiscard(entry.id)}
                              disabled={isLoading || actionLoading !== null}
                              className="rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
                            >
                              {t("sync.discard", "Discard")}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Load more */}
        {entries.length > 0 && hasMore && (
          <div className="border-t border-gray-100 px-4 py-3 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={actionLoading !== null}
              className="rounded-md bg-gray-100 px-4 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("sync.load_more", "Load more")}
            </button>
          </div>
        )}
      </div>

      {/* Refresh button below card */}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={actionLoading !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className={`h-4 w-4 ${actionLoading ? "animate-spin" : ""}`}
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
          {t("common.refresh", "Refresh")}
        </button>
      </div>
    </div>
  );
};
