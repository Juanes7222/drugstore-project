/**
 * Sync Health Page — manager/admin observability surface.
 *
 * Shows KPI tiles, a timeline sparkline, failure breakdown, a paginated
 * entries table with Retry/Discard actions, and an entry detail drawer.
 *
 * Role-gated to ADMIN (the POS desktop's equivalent of the task's MANAGER
 * role). Re-checks role on every action (Retry / Discard) so a downgraded
 * session cannot perform recovery actions.
 */

import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createSyncMetricsService } from "./sync-metrics.service";
import {
  createSyncRecoveryService,
  EntryNotInPermanentFailureException,
  EntryStateChangedException,
} from "./sync-recovery.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { RoleType } from "@pharmacy/shared-types";
import { getLocalDatabase } from "../../infrastructure/local-database";
import type {
  QueueCounts,
  FailureBreakdownEntry,
  PermanentFailureEntry,
  HealthTimelineBucket,
  PaginatedEntries,
} from "./sync-metrics.service";
import { DomainError } from "../../common/domain-error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortField = "lastAttemptAt" | "retryCount" | "operationType";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export const SyncHealthPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Metrics state
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [breakdown, setBreakdown] = useState<FailureBreakdownEntry[]>([]);
  const [timeline, setTimeline] = useState<HealthTimelineBucket[]>([]);
  const [entries, setEntries] = useState<PaginatedEntries<PermanentFailureEntry> | null>(null);

  // UI state
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("lastAttemptAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [cursor, setCursor] = useState<string | null>(null);
  const [drawerEntry, setDrawerEntry] = useState<PermanentFailureEntry | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [discardModal, setDiscardModal] = useState<{ entryId: string } | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discardSubmitting, setDiscardSubmitting] = useState(false);

  // Services (initialized once)
  const services = useMemo(() => {
    return {
      metricsService: null as ReturnType<typeof createSyncMetricsService> | null,
      recoveryService: null as ReturnType<typeof createSyncRecoveryService> | null,
    };
  }, []);

  // Show toast and auto-dismiss
  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const { prisma } = await getLocalDatabase();
      const metricsService = createSyncMetricsService(prisma);
      const recoveryService = createSyncRecoveryService({ prisma });
      services.getMetricsService = () => metricsService;
      services.getRecoveryService = () => recoveryService;

      const [c, b, tml, e] = await Promise.all([
        metricsService.getQueueCounts(),
        metricsService.getFailureBreakdown(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        metricsService.getSyncHealthTimeline(24),
        metricsService.getPermanentFailureEntries({ limit: 20 }),
      ]);

      setCounts(c);
      setBreakdown(b);
      setTimeline(tml);
      setEntries(e);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync health data");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load more (pagination)
  const loadMore = useCallback(async () => {
    if (!cursor || !services.getMetricsService) return;
    const ms = services.getMetricsService();
    const next = await ms.getPermanentFailureEntries({ limit: 20, cursor });
    setEntries(next);
    setCursor(next.cursor);
  }, [cursor, services]);

  // Filter by category
  const filteredEntries = useMemo(() => {
    if (!entries?.data) return [];
    if (!selectedFilterCategory) return entries.data;
    return entries.data.filter((e) => e.failureCategory === selectedFilterCategory);
  }, [entries, selectedFilterCategory]);

  // Handle retry
  const handleRetry = useCallback(async (entryId: string) => {
    const session = useLocalSessionStore.getState().session;
    if (!session || !session.role) {
      showToast("error", "No active session");
      return;
    }

    // Re-check role on submit
    const role = session.role as RoleType;
    if (role !== RoleType.ADMIN) {
      showToast("error", "Only administrators can retry sync entries");
      return;
    }

    setActionLoading(entryId);
    try {
      if (!services.getRecoveryService) throw new Error("Services not ready");
      const rs = services.getRecoveryService();
      await rs.retryEntry(entryId, session.userId);
      showToast("success", "Entry queued for retry");
      // Refresh data
      await loadData();
    } catch (err) {
      if (err instanceof EntryStateChangedException) {
        showToast("error", "This entry was just actioned by someone else. The list has been refreshed.");
        await loadData();
      } else if (err instanceof EntryNotInPermanentFailureException) {
        showToast("error", (err as DomainError).message);
        await loadData();
      } else {
        showToast("error", err instanceof Error ? err.message : "Retry failed");
      }
    } finally {
      setActionLoading(null);
    }
  }, [loadData, showToast, services]);

  // Open discard modal
  const openDiscard = useCallback((entryId: string) => {
    setDiscardModal({ id: entryId });
    setDiscardReason("");
  }, []);

  // Submit discard
  const submitDiscard = useCallback(async () => {
    if (!discardModal) return;
    const session = useLocalSessionStore.getState().session;
    if (!session) return;

    const role = session.role as RoleType;
    if (role !== RoleType.ADMIN) {
      showToast("error", "Only ADMIN can discard sync entries");
      return;
    }

    if (!discardReason.trim()) {
      showToast("error", "A discard reason is required");
      return;
    }

    setDiscardSubmitting(true);
    try {
      if (!services.getRecoveryService) throw new Error("Services not ready");
      const rs = services.getRecoveryService();
      await rs.discardEntry(discardModal.id, discardReason.trim(), session.userId);
      showToast("success", "Entry discarded");
      setDiscardModal(null);
      await loadData();
    } catch (err) {
      if (err instanceof EntryStateChangedException) {
        showToast("error", "This entry was just actioned by someone else.");
        await loadData();
      } else if (err instanceof Error) {
        showToast("error", err.message);
      } else {
        showToast("error", "Discard failed");
      }
    } finally {
      setDiscardSubmitting(false);
    }
  }, [discardModal, discardReason, loadData, showToast, services]);

  // Sort entries
  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      let cmp = 0;
      if (sortField === "lastAttemptAt") {
        cmp = (a.lastAttemptAt ?? "").localeCompare(b.lastAttemptAt ?? "");
      } else if (sortField === "retryCount") {
        cmp = a.retryCount - b.retryCount;
      } else if (sortField === "operationType") {
        cmp = a.operationType.localeCompare(b.operationType);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [filteredEntries, sortField, sortDir]);

  // Render
  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-transparent"
            style={{ borderTopColor: "#22c55e", borderRightColor: "#22c55e" }} />
          <p className="text-gray-500">Loading sync health data…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-bold text-red-700">Error loading data</h2>
          <p className="mt-2 text-red-600">{error}</p>
          <button
            className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
            onClick={loadData}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  // --- Data loaded ---
  const successRate24h = counts
    ? (counts.completed24h / (counts.completed24h + counts.failed + counts.permanentFailure || 1)) * 100
    : 0;

  return (
    <section className="flex h-full overflow-hidden" style={{ backgroundColor: "#f8fafc" }}>
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">Sync Health</h1>

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${
              toast.type === "success"
                ? "bg-green-100 text-green-800 border border-green-300"
                : "bg-red-100 text-red-800 border border-red-300"
            }`}
            role="alert"
          >
            {toast.message}
          </div>
        )}

        {/* KPI tiles */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          {renderKpiTile("Pending", counts?.pending ?? 0, counts?.pending ?? 0 > 0 ? "#f59e0b" : "#22c55e")}
          {renderKpiTile("Failed (24h)", counts?.failed ?? 0, counts?.failed ?? 0 > 0 ? "#ef4444" : "#22c55e")}
          {renderKpiTile("Permanent Failures", counts?.permanentFailure ?? 0, counts?.permanentFailure ?? 0 > 0 ? "#dc2626" : "#22c55e")}
          {renderKpiTile(
            "Success Rate (24h)",
            `${successRate24h.toFixed(1)}%`,
            successRate24h >= 95 ? "#22c55e" : successRate24h >= 80 ? "#f59e0b" : "#ef4444",
          )}
        </div>

        {/* Timeline sparkline */}
        {timeline.length > 0 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wide">
              Sync Timeline (24h)
            </h2>
            <SparklineChart data={timeline} />
          </div>
        )}

        {/* No data state */}
        {timeline.length === 0 && counts && counts.completedTotal === 0 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-400 text-lg">No sync data yet</p>
            <p className="text-gray-300 text-sm mt-1">
              This terminal has not processed any sync operations.
            </p>
          </div>
        )}

        {/* Failure breakdown */}
        {breakdown.length > 0 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Failure Breakdown
            </h2>
            <div className="flex flex-wrap gap-2">
              {breakdown.map((b) => (
                <button
                  key={b.category}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedFilterCategory === b.category
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  onClick={() =>
                    setSelectedFilterCategory(
                      selectedFilterCategory === b.category ? null : b.category,
                    )
                  }
                >
                  {b.category}: {b.count}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No failures state */}
        {breakdown.length === 0 && counts && counts.completedTotal > 0 && (
          <div className="mb-6 rounded-lg border border-green-100 bg-green-50 p-4 text-center">
            <p className="text-green-700 text-sm font-medium">
              ✓ All operations completed successfully. No failures detected.
            </p>
          </div>
        )}

        {/* Entries table section */}
        {sortedEntries.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                Permanent Failure Entries
                {selectedFilterCategory && (
                  <span className="ml-2 text-blue-500">
                    (filtered: {selectedFilterCategory})
                  </span>
                )}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <EntriesTable
                entries={sortedEntries}
                actionLoading={actionLoading}
                sortField={sortField}
                sortDir={sortDir}
                onSort={(field) => {
                  if (sortField === field) {
                  setSortDir(sortDir === "asc" ? "desc" : "asc");
                } else {
                  setSortField(field);
                  setSortDir("desc");
                }
              }}
              onRetry={handleRetry}
              onDiscard={openDiscard}
              onSelect={setDrawerEntry}
              sessionRole={useLocalSessionStore.getState().session?.role as RoleType}
            />
          </div>

          {/* Pagination */}
          {entries && entries.hasMore && (
            <div className="border-t border-gray-200 px-4 py-3 text-center">
              <button
                className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
                onClick={loadMore}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Detail drawer */}
      {drawerEntry && (
        <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
          <EntryDetailDrawer
            entry={drawerEntry}
            onClose={() => setDrawerEntry(null)}
          />
        </div>
      )}

      {/* Discard confirmation modal */}
      {discardModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !discardSubmitting && setDiscardModal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-bold text-gray-800">Discard Sync Entry</h2>
            <p className="mb-4 text-sm text-gray-600">
              This action cannot be undone. The operation will be permanently excluded
              from sync and must be performed manually on the server.
            </p>
            <label className="block mb-4">
              <span className="text-sm font-medium text-gray-700">Reason for discarding</span>
              <textarea
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
                placeholder="e.g., Duplicate entry, no longer applicable…"
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                disabled={discardSubmitting}
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
                onClick={() => setDiscardModal(null)}
                disabled={discardSubmitting}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                onClick={submitDiscard}
                disabled={discardSubmitting || !discardReason.trim()}
              >
                {discardSubmitting ? "Discarding…" : "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

function renderKpiTile(label: string, value: string | number, accentColor: string) {
  return (
    <div
      key={label}
      className="rounded-lg border border-gray-200 bg-white p-4"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={{ color: accentColor }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline chart
// ---------------------------------------------------------------------------

const SparklineChart: FC<{ data: HealthTimelineBucket[] }> = ({ data }) => {
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.completed, d.nonCompleted)));
  const width = 1000;
  const height = 80;
  const padding = 2;
  const barWidth = Math.max(2, (width - padding * 2) / data.length);
  const chartHeight = height - padding * 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 80 }}>
      {data.map((d, i) => {
        const h = chartHeight * (Math.max(d.completed, d.nonCompleted) / maxVal);
        const x = padding + i * barWidth;
        const y = height - padding - h;
        return (
          <g key={d.id}>
            <rect
              x={x}
              y={y}
              width={barWidth - 1}
              height={h}
              fill="#22c55e"
              opacity={0.8}
            />
            {d.nonCompleted > 0 && (
              <rect
                x={x}
                y={y}
                width={barWidth - 1}
                height={chartHeight * (d.nonCompleted / maxVal)}
                fill="#ef4444"
                opacity={0.8}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Entries table
// ---------------------------------------------------------------------------

interface EntriesTableProps {
  entries: PermanentFailureEntry[];
  actionLoading: string | null;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  onRetry: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
  onSelect: (entry: PermanentFailureEntry) => void;
  sessionRole: string | undefined;
}

const EntriesTable: FC<EntriesTableProps> = ({
  entries,
  actionLoading,
  sortField,
  sortDir,
  onSort,
  onRetry,
  onDiscard,
  onSelect,
  sessionRole,
}) => {
  const isManager = sessionRole === RoleType.ADMIN.toString();

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <Th onClick={() => onSort("operationType")}>
            Type{sortIndicator("operationType")}
          </Th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Preview
          </th>
          <Th onClick={() => onSort("lastAttemptAt")}>
            Last Attempt{sortIndicator("lastAttemptAt")}
          </Th>
          <Th onClick={() => onSort("retryCount")}>
            Retries{sortIndicator("retryCount")}
          </Th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Category
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            Error
          </th>
          {isManager && (
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white">
        {entries.map((entry) => (
          <tr
            key={entry.id}
            className="cursor-pointer hover:bg-gray-50"
            onClick={() => onSelect(entry)}
          >
            <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
              {entry.operationType.replace(/_/g, " ")}
            </td>
            <td className="max-w-xs truncate px-4 py-3 text-gray-500">
              {entry.payloadPreview}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-gray-500">
              {entry.lastAttemptAt
                ? formatRelativeTime(entry.lastAttemptAt)
                : "—"}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-gray-500">
              {entry.retryCount}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                entry.failureCategory === "NETWORK" ? "bg-yellow-100 text-yellow-800"
                : entry.failureCategory === "VALIDATION" ? "bg-purple-100 text-purple-800"
                : entry.failureCategory === "CONFLICT" ? "bg-orange-100 text-orange-800"
                : entry.failureCategory === "AUTH" ? "bg-red-100 text-red-800"
                : entry.failureCategory === "BUSINESS_RULE" ? "bg-blue-100 text-blue-800"
                : "bg-gray-100 text-gray-800"
              }`}>
                {entry.failureCategory ?? "UNKNOWN"}
              </span>
            </td>
            <td className="max-w-xs truncate px-4 py-3 text-gray-500">
              {entry.lastErrorMessage ?? "—"}
            </td>
            {isManager && (
              <td className="whitespace-nowrap px-4 py-3 text-right">
                <button
                  className="mr-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  onClick={(e) => { e.stopPropagation(); onRetry(entry.id); }}
                  disabled={actionLoading === entry.id}
                >
                  {actionLoading === entry.id ? "…" : "Retry"}
                </button>
                <button
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={(e) => { e.stopPropagation(); onDiscard(entry.id); }}
                  disabled={actionLoading === entry.id}
                >
                  Discard
                </button>
              </td>
            )}
          </tr>
        ))}
        {entries.length === 0 && (
          <tr>
            <td colSpan={isManager ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
              No permanent failure entries found.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
};

// ---------------------------------------------------------------------------
// Entry detail drawer
// ---------------------------------------------------------------------------

interface EntryDetailDrawerProps {
  entry: PermanentFailureEntry;
  onClose: () => void;
}

const EntryDetailDrawer: FC<EntryDetailDrawerProps> = ({ entry, onClose }) => {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [recoveryLog, setRecoveryLog] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { prisma } = await getLocalDatabase();
        const [att, log] = await Promise.all([
          prisma.syncAttempt.findMany({
            where: { syncQueueEntryId: entry.id },
            orderBy: { attemptedAt: "desc" as const },
          }),
          prisma.syncRecoveryLog.findMany({
            where: { syncQueueEntryId: entry.id },
            orderBy: { at: "desc" as const },
          }),
        ]);
        setAttempts(att as any[]);
        setRecoveryLog(log as any[]);
      } catch {
        // Silently fail
      }
    })();
  }, [entry.id]);

  const formattedPayload = useMemo(() => {
    try {
      // We don't have the raw payload here, so we show a message.
      // The payloadPreview is shown in the entries table.
      return entry.payloadPreview;
    } catch {
      return "—";
    }
  }, [entry]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Entry Detail</h2>
        <button
          className="text-gray-400 hover:text-gray-600"
          onClick={onClose}
          aria-label="Close drawer"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Summary */}
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Operation</dt>
            <dd className="mt-0.5 text-gray-900">{entry.operationType.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">UUID</dt>
            <dd className="mt-0.5 font-mono text-xs text-gray-700">{entry.operationUuid}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Status</dt>
            <dd className="mt-0.5">
              <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                PERMANENT_FAILURE
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Category</dt>
            <dd className="mt-0.5 text-gray-900">{entry.failureCategory ?? "UNKNOWN"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Error Message</dt>
            <dd className="mt-0.5 text-gray-700">{entry.lastErrorMessage ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Retries</dt>
            <dd className="mt-0.5 text-gray-900">{entry.retryCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Created (POS)</dt>
            <dd className="mt-0.5 text-gray-700">{entry.sourceCreatedAt ? formatRelativeTime(entry.sourceCreatedAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Last Attempt</dt>
            <dd className="mt-0.5 text-gray-700">{entry.lastAttemptAt ? formatRelativeTime(entry.lastAttemptAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase">Payload Preview</dt>
            <dd className="mt-0.5 text-xs text-gray-600 break-words">{formattedPayload}</dd>
          </div>
        </dl>

        {/* Retry history */}
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-gray-500 uppercase">Retry History ({attempts.length})</h3>
          {attempts.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No retry history recorded</p>
          ) : (
            <ul className="space-y-2">
              {attempts.map((a: any) => (
                <li key={a.id} className="rounded bg-gray-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${
                      a.outcome === "ACCEPTED" ? "text-green-700"
                      : a.outcome === "ALREADY_ACCEPTED" ? "text-blue-700"
                      : a.outcome === "REJECTED" ? "text-red-700"
                      : "text-yellow-700"
                    }`}>
                      {a.outcome}
                    </span>
                    <span className="text-gray-400">
                      {a.attemptedAt ? formatRelativeTime(a.attemptedAt) : "—"}
                    </span>
                  </div>
                  {a.errorMessage && (
                    <p className="mt-1 text-gray-500 truncate">{a.errorMessage}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recovery log */}
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-gray-700 uppercase">Recovery Actions ({recoveryLog.length})</h3>
          {recoveryLog.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No recovery actions taken</p>
          ) : (
            <ul className="space-y-2">
              {recoveryLog.map((log: any) => (
                <li key={log.id} className="rounded bg-gray-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${
                      log.action === "RETRY" ? "text-blue-700"
                      : "text-red-700"
                    }`}>
                      {log.action}
                    </span>
                    <span className="text-gray-400">{log.at ? formatRelativeTime(log.at) : "—"}</span>
                  </div>
                  {log.reason && <p className="mt-1 text-gray-500">{log.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Simple Th component with sort handler */
const Th: FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <th
    className="cursor-pointer px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-700"
    onClick={onClick}
  >
    {children}
  </th>
);