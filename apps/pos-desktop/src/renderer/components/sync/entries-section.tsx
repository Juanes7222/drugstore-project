/**
 * Table section for sync error entries with sorting, filtering, and actions.
 *
 * Uses design-system tokens, shared ui/icons components, motion staggered entrance,
 * and truncated error messages to avoid leaking stack traces. Admin-level
 * retry action renders only for ADMIN roles.
 *
 * There is deliberately no discard/delete action: queued business movements
 * must never be discarded from the UI (discarding would punch an
 * unrecoverable hole in the per-workstation movement sequence).
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ArrowUpDownIcon, ChevronDownIcon, ChevronUpIcon, RefreshCwIcon, RotateCwIcon } from "@/components/ui/icons";
import type { PermanentFailureEntry } from "../../../domain/sync/sync-metrics.service";
import { RoleType } from "@pharmacy/shared-types";
import { formatRelativeTimeEs } from "../../hooks/use-relative-time";
import { summarizePayload, truncateError } from "./sync-utils";
import { StickyScrollX } from "../ui/sticky-scroll-x";
import type { SortField, SortDir } from "./sync-health.types";

// ── Helpers ────────────────────────────────────────────────────────────────

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
  onSelect: (entry: PermanentFailureEntry) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}

type SortableColumn = {
  field: SortField;
  labelKey: string;
};

const SORTABLE_COLUMNS: SortableColumn[] = [
  { field: "operationType", labelKey: "sync.col_operation" },
  { field: "lastAttemptAt", labelKey: "sync.col_last_attempt" },
  { field: "retryCount", labelKey: "sync.col_retries" },
];

function getSortIndicator(field: SortField, sortField: SortField, sortDir: SortDir): React.ReactNode {
  if (sortField !== field) {
    return <ArrowUpDownIcon className="h-3 w-3 text-ink-muted/50" aria-hidden="true" />;
  }
  return sortDir === "asc"
    ? <ChevronUpIcon className="h-3 w-3 text-pharma" aria-hidden="true" />
    : <ChevronDownIcon className="h-3 w-3 text-pharma" aria-hidden="true" />;
}

function getRowBorderClass(entry: PermanentFailureEntry): string {
  return entry.retryCount === 0 && entry.lastErrorMessage === null
    ? "border-l-warning"    // stale-pending
    : "border-l-error";     // permanent failure
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
  onSelect,
  onLoadMore,
  onRefresh,
}) => {
  const { t } = useTranslation();

  const isAdmin = sessionRole === RoleType.ADMIN;

  const handleSort = useCallback((field: SortField) => () => onSort(field), [onSort]);
  const handleRetry = useCallback((entryId: string) => () => onRetry?.(entryId), [onRetry]);
  const handleSelect = useCallback((entry: PermanentFailureEntry) => () => onSelect(entry), [onSelect]);
  const handleLoadMore = useCallback(() => onLoadMore(), [onLoadMore]);
  const handleRefresh = useCallback(() => onRefresh(), [onRefresh]);

  return (
    <div className="mb-6">
      <div className="rounded-lg border border-border bg-panel shadow-pos-panel">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-body-sm font-semibold text-ink">
            {t("sync.entries_title")}
            {selectedCategory && (
              <span className="ml-2 text-caption font-normal text-ink-muted">
                ({t("sync.entries_filtered_by", { category: t(`sync.failure_cat.${selectedCategory}`, { defaultValue: selectedCategory }) })})
              </span>
            )}
            {showDiscarded && (
              <span className="ml-2 inline-flex items-center rounded-full bg-urgency/10 px-2 py-0.5 text-caption font-medium text-urgency">
                {t("sync.showing_discarded")}
              </span>
            )}
          </h3>
          {entries.length > 0 && (
            <span className="text-caption text-ink-muted tabular-nums">
              {entries.length.toLocaleString()} {t("sync.entries_count")}
            </span>
          )}
        </div>

        {/* ── Table / Empty ── */}
        {entries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-body-sm text-ink-muted">{t("sync.entries_empty")}</p>
          </div>
        ) : (
          <StickyScrollX>
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-border bg-surface/60">
                  <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">{t("sync.col_type")}</th>
                  <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">{t("sync.col_preview")}</th>
                  {SORTABLE_COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      className="cursor-pointer select-none px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted hover:text-ink"
                      onClick={handleSort(col.field)}
                      aria-sort={
                        sortField === col.field
                          ? sortDir === "asc" ? "ascending" : "descending"
                          : "none"
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {t(col.labelKey)}
                        {getSortIndicator(col.field, sortField, sortDir)}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">{t("sync.col_category")}</th>
                  <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">{t("sync.col_error")}</th>
                  {isAdmin && (
                    <th className="px-4 py-2.5 text-caption font-semibold uppercase tracking-wider text-ink-muted">{t("sync.col_actions")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const isLoading = actionLoading === entry.id;
                  return (
                    <motion.tr
                      key={entry.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: idx * 0.03, ease: "easeOut" }}
                      className={`border-b border-border border-l-4 transition-colors hover:bg-surface/40 ${getRowBorderClass(entry)}`}
                    >
                      <td className="font-data px-4 py-3 text-caption text-ink">
                        {t(`sync.op_type.${entry.operationType}`, { defaultValue: entry.operationType })}
                      </td>
                      <td className="max-w-37.5 truncate px-4 py-3 font-data text-caption text-ink-muted">
                        <button
                          type="button"
                          onClick={handleSelect(entry)}
                          className="truncate text-left text-ink-muted underline-offset-2 hover:underline"
                          title={t("sync.view_details")}
                        >
                          {summarizePayload(entry.payloadPreview, t)}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-data text-caption tabular-nums text-ink">
                        {entry.lastAttemptAt ? formatRelativeTimeEs(entry.lastAttemptAt) : "\u2014"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-data text-caption tabular-nums text-ink">
                        {entry.retryCount.toLocaleString()}
                      </td>
                      <td className="max-w-37.5 truncate px-4 py-3 text-caption text-ink">
                        {entry.failureCategory
                          ? t(`sync.failure_cat.${entry.failureCategory}`, { defaultValue: entry.failureCategory })
                          : "\u2014"}
                      </td>
                      <td className="max-w-50 truncate px-4 py-3 font-data text-caption text-error">
                        {truncateError(entry.lastErrorMessage) ?? "\u2014"}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-2">
                            {/* Retry now — requeues the entry and forces an
                                immediate push attempt. Never deletes it. */}
                            <button
                              type="button"
                              onClick={handleRetry(entry.id)}
                              disabled={isLoading || actionLoading !== null || Boolean(retryDisabledMessage)}
                              title={retryDisabledMessage}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-caption font-medium text-pharma transition-colors hover:bg-pharma/10 focus:outline-none focus:ring-2 focus:ring-pharma disabled:cursor-not-allowed disabled:text-ink-muted/40 disabled:hover:bg-transparent"
                            >
                              {isLoading ? (
                                <RefreshCwIcon className="h-3 w-3 animate-spin" aria-hidden="true" />
                              ) : (
                                <RotateCwIcon className="h-3 w-3" aria-hidden="true" />
                              )}
                              {isLoading ? t("common.loading") : t("sync.retry_now")}
                            </button>
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </StickyScrollX>
        )}

        {/* ── Load more ── */}
        {entries.length > 0 && hasMore && (
          <div className="border-t border-border px-4 py-3 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={actionLoading !== null}
              className="rounded-md bg-surface px-4 py-1.5 text-body-sm font-medium text-ink transition-colors hover:bg-surface-variant focus:outline-none focus:ring-2 focus:ring-pharma disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("sync.load_more")}
            </button>
          </div>
        )}
      </div>

      {/* ── Refresh ── */}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={actionLoading !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-1.5 text-body-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-pharma focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCwIcon className={`h-4 w-4 ${actionLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          {t("common.refresh")}
        </button>
      </div>
    </div>
  );
};
