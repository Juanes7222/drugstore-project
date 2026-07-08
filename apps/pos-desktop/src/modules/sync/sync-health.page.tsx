/**
 * Manager/admin sync health page.
 *
 * Shows KPI tiles (pending, stale-pending, failed, permanent-failures,
 * success-rate), timeline sparkline, failure-breakdown filter, paginated
 * entries table with Retry/Discard actions, and an entry-detail drawer.
 *
 * Role-gated to ADMIN. Re-checks role on every action.
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createSyncMetricsService } from "./sync-metrics.service";
import {
  createSyncRecoveryService,
  EntryNotInPermanentFailureException,
  EntryStateChangedException,
  EntryNotReplayableException,
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
  EntryFilter,
} from "./sync-metrics.service";
import { DomainError } from "../../common/domain-error";

const AUTO_REFRESH_MS = 30_000;
const TIMELINE_HOURS = 24;
const BADGE_DURATION_MS = 5000;

type SortField = "lastAttemptAt" | "retryCount" | "operationType";
type SortDir = "asc" | "desc";

interface ConnectionStatus {
  type: "reachable" | "unreachable" | "testing" | null;
  message?: string;
}

// ── Page component ─────────────────────────────────────────────────────

export const SyncHealthPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [breakdown, setBreakdown] = useState<FailureBreakdownEntry[]>([]);
  const [timeline, setTimeline] = useState<HealthTimelineBucket[]>([]);
  const [entries, setEntries] = useState<PaginatedEntries<PermanentFailureEntry> | null>(null);

  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("lastAttemptAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [cursor, setCursor] = useState<string | null>(null);
  const [drawerEntry, setDrawerEntry] = useState<PermanentFailureEntry | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [discardModal, setDiscardModal] = useState<{ id: string } | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discardSubmitting, setDiscardSubmitting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);
  const [retryWithoutCheck, setRetryWithoutCheck] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);

  const servicesRef = useRef<{
    metricsService: ReturnType<typeof createSyncMetricsService> | null;
    recoveryService: ReturnType<typeof createSyncRecoveryService> | null;
  }>({ metricsService: null, recoveryService: null });

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const { prisma } = await getLocalDatabase();
      const metricsService = createSyncMetricsService(prisma);
      const recoveryService = createSyncRecoveryService({ prisma });
      servicesRef.current = { metricsService, recoveryService };

      const [c, b, tml, permanentFailures, stalePending] = await Promise.all([
        metricsService.getQueueCounts(),
        metricsService.getFailureBreakdown(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        metricsService.getSyncHealthTimeline(TIMELINE_HOURS),
        metricsService.getPermanentFailureEntries({ limit: 20 }),
        metricsService.getStalePendingEntries({ limit: 5 }),
      ]);

      const combined = [...permanentFailures.data, ...stalePending.data];
      setCounts(c);
      setBreakdown(b);
      setTimeline(tml);
      setEntries({
        data: combined,
        total: permanentFailures.total + stalePending.total,
        hasMore: permanentFailures.hasMore || stalePending.hasMore,
        cursor: permanentFailures.cursor ?? stalePending.cursor,
      });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync health data");
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Auto-refresh KPI tiles & breakdown every 30s, pause on tab hide.
  useEffect(() => {
    const refreshTiles = async () => {
      if (document.visibilityState !== "visible") return;
      const ms = servicesRef.current.metricsService;
      if (!ms) return;
      try {
        const [c, b] = await Promise.all([
          ms.getQueueCounts(),
          ms.getFailureBreakdown(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ]);
        setCounts(c);
        setBreakdown(b);
      } catch { /* advisory */ }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshTiles();
        autoRefreshRef.current = setInterval(refreshTiles, AUTO_REFRESH_MS);
      } else if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    autoRefreshRef.current = setInterval(refreshTiles, AUTO_REFRESH_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || !servicesRef.current.metricsService) return;
    const next = await servicesRef.current.metricsService.getPermanentFailureEntries({
      limit: 20, cursor, category: selectedFilterCategory ?? undefined,
    });
    setEntries(next);
    setCursor(next.cursor);
  }, [cursor, selectedFilterCategory]);

  // Client-side category filter for the current page
  const filteredEntries = useMemo(() => {
    if (!entries?.data) return [];
    if (!selectedFilterCategory) return entries.data;
    return entries.data.filter((e) => e.failureCategory === selectedFilterCategory);
  }, [entries, selectedFilterCategory]);

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

  const handleTestConnection = useCallback(async () => {
    setConnectionStatus({ type: "testing" });
    try {
      const baseUrl = "http://localhost:3000";
      const session = useLocalSessionStore.getState().session;
      const headers: Record<string, string> = {};
      if (session?.userId) headers["Authorization"] = `Bearer ${session.userId}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/sync/status`, {
        method: "GET", headers, signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok || response.status === 401) {
        setConnectionStatus({ type: "reachable" });
      } else {
        setConnectionStatus({ type: "unreachable", message: `Server returned ${response.status}` });
      }
    } catch (err) {
      setConnectionStatus({
        type: "unreachable",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
    setTimeout(() => setConnectionStatus(null), BADGE_DURATION_MS);
  }, []);

  const handleRetry = useCallback(async (entryId: string) => {
    const session = useLocalSessionStore.getState().session;
    if (!session || !session.role) { showToast("error", "No active session"); return; }
    if ((session.role as RoleType) !== RoleType.ADMIN) {
      showToast("error", "Only administrators can retry sync entries");
      return;
    }

    setActionLoading(entryId);
    try {
      const rs = servicesRef.current.recoveryService;
      if (!rs) throw new Error("Services not ready");
      const result = await rs.retryEntry(entryId, session.userId);
      showToast(
        "success",
        result.payloadResnapshotted
          ? "Entry queued for retry (payload re-snapshotted from current state)"
          : "Entry queued for retry (original payload preserved)",
      );
      await loadData();
    } catch (err) {
      if (err instanceof EntryStateChangedException) {
        showToast("error", "This entry was just actioned by someone else. The list has been refreshed.");
        await loadData();
      } else if (err instanceof EntryNotInPermanentFailureException) {
        showToast("error", (err as DomainError).message);
        await loadData();
      } else if (err instanceof EntryNotReplayableException) {
        showToast("error", `${(err as DomainError).message} Use Discard instead.`);
      } else {
        showToast("error", err instanceof Error ? err.message : "Retry failed");
      }
    } finally {
      setActionLoading(null);
    }
  }, [loadData, showToast]);

  const openDiscard = useCallback((entryId: string) => {
    setDiscardModal({ id: entryId });
    setDiscardReason("");
  }, []);

  const submitDiscard = useCallback(async () => {
    if (!discardModal) return;
    const session = useLocalSessionStore.getState().session;
    if (!session) return;
    if ((session.role as RoleType) !== RoleType.ADMIN) {
      showToast("error", "Only ADMIN can discard sync entries");
      return;
    }
    if (!discardReason.trim()) { showToast("error", "A discard reason is required"); return; }

    setDiscardSubmitting(true);
    try {
      const rs = servicesRef.current.recoveryService;
      if (!rs) throw new Error("Services not ready");
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
  }, [discardModal, discardReason, loadData, showToast]);

  const handleExportCsv = useCallback(async () => {
    const ms = servicesRef.current.metricsService;
    if (!ms) return;
    try {
      const filter: EntryFilter = {};
      if (selectedFilterCategory) filter.failureCategory = selectedFilterCategory;
      if (!showDiscarded) filter.status = "PERMANENT_FAILURE";

      const csvContent = await ms.exportEntriesAsCsv(filter);
      const wsId = useLocalSessionStore.getState().session?.workstationId ?? "unknown";
      const filename = `sync-entries-${wsId}-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(csvContent, filename, "text/csv;charset=utf-8;");
      showToast("success", `Exported ${csvContent.split("\n").length - 1} rows as CSV`);
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Export failed");
    }
  }, [selectedFilterCategory, showDiscarded, showToast]);

  const handleExportJson = useCallback(async () => {
    const ms = servicesRef.current.metricsService;
    if (!ms) return;
    try {
      const filter: EntryFilter = {};
      if (selectedFilterCategory) filter.failureCategory = selectedFilterCategory;
      if (!showDiscarded) filter.status = "PERMANENT_FAILURE";

      const jsonContent = await ms.exportEntriesAsJson(filter);
      const wsId = useLocalSessionStore.getState().session?.workstationId ?? "unknown";
      const filename = `sync-entries-${wsId}-${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(jsonContent, filename, "application/json;charset=utf-8;");
      showToast("success", "Exported as JSON");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Export failed");
    }
  }, [selectedFilterCategory, showDiscarded, showToast]);

  const handleRunSyncNow = useCallback(async () => {
    try {
      const { createSyncScheduler } = await import("./sync-scheduler.service");
      const { prisma } = await getLocalDatabase();
      const baseUrl = "http://localhost:3000";
      const scheduler = createSyncScheduler({
        prisma, baseUrl,
        config: { prisma, baseUrl },
        catalog: { prisma, baseUrl },
        lots: { prisma, baseUrl },
        clients: { prisma, baseUrl },
      });
      await scheduler.syncNow();
      showToast("success", "Sync cycle completed");
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Sync cycle failed");
    }
  }, [loadData, showToast]);

  // Safety: show "—" when denominator is zero to avoid crashing
  const successRateDisplay = useMemo(() => {
    if (!counts) return "—";
    const d = counts.completed24h + counts.failed + counts.permanentFailure;
    return d === 0 ? "—" : `${((counts.completed24h / d) * 100).toFixed(1)}%`;
  }, [counts]);

  const successRateColor = useMemo(() => {
    if (successRateDisplay === "—") return "#9ca3af";
    const v = parseFloat(successRateDisplay);
    return v >= 95 ? "#22c55e" : v >= 80 ? "#f59e0b" : "#ef4444";
  }, [successRateDisplay]);

  // ── Loading / error states ─────────────────────────────────────────

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-green-500 border-r-green-500 border-transparent" />
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

  // ── Main render ────────────────────────────────────────────────────

  return (
    <section className="flex h-full overflow-hidden bg-slate-50">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">Sync Health</h1>

        {toast && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium border ${
              toast.type === "success"
                ? "bg-green-100 text-green-800 border-green-300"
                : toast.type === "info"
                  ? "bg-blue-100 text-blue-800 border-blue-300"
                  : "bg-red-100 text-red-800 border-red-300"
            }`}
            role="alert"
          >
            {toast.message}
          </div>
        )}

        {/* KPI tiles */}
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiTile
            label="Pending"
            value={counts?.pending ?? 0}
            accentColor={(counts?.stalePending ?? 0) > 0 ? "#f59e0b" : "#22c55e"}
            subLabel={(counts?.stalePending ?? 0) > 0 ? `stale: ${counts?.stalePending ?? 0}` : undefined}
          />
          <KpiTile
            label="Failed (24h)"
            value={counts?.failed ?? 0}
            accentColor={(counts?.failed ?? 0) > 0 ? "#ef4444" : "#22c55e"}
          />
          <KpiTile
            label="Permanent Failures"
            value={counts?.permanentFailure ?? 0}
            accentColor={(counts?.permanentFailure ?? 0) > 0 ? "#dc2626" : "#22c55e"}
          />
          <KpiTile
            label="Success Rate (24h)"
            value={successRateDisplay}
            accentColor={successRateColor}
          />
        </div>

        {/* Action row */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <TestConnectionButton
            status={connectionStatus}
            onClick={handleTestConnection}
          />

          <button
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleRunSyncNow}
          >
            Run sync now
          </button>

          <button
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            onClick={handleExportCsv}
          >
            Export CSV
          </button>

          <button
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            onClick={handleExportJson}
          >
            Export JSON
          </button>

          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={retryWithoutCheck}
              onChange={(e) => setRetryWithoutCheck(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Retry without server check
          </label>

          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={showDiscarded}
              onChange={(e) => setShowDiscarded(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Show discarded
          </label>
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

        {/* No-data placeholder */}
        {timeline.length === 0 && counts?.completedTotal === 0 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-lg text-gray-400">No sync data yet</p>
            <p className="mt-1 text-sm text-gray-300">
              This terminal has not processed any sync operations. Start a sync cycle to collect data.
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
                    setSelectedFilterCategory(selectedFilterCategory === b.category ? null : b.category)
                  }
                >
                  {b.category}: {b.count}
                  {b.mostRecent && (
                    <span className="ml-1 opacity-60">
                      (latest: {formatRelativeTime(b.mostRecent)})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* All-clear state */}
        {breakdown.length === 0 && counts && counts.completedTotal > 0 && (
          <div className="mb-6 rounded-lg border border-green-100 bg-green-50 p-4 text-center">
            <p className="text-sm font-medium text-green-700">
              ✓ All operations completed successfully. No failures detected.
            </p>
          </div>
        )}

        {/* Entries table */}
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Error Entries
              {selectedFilterCategory && <span className="ml-2 text-blue-500">(filtered: {selectedFilterCategory})</span>}
              {showDiscarded && <span className="ml-2 text-gray-400">(including discarded)</span>}
            </h2>
          </div>

          {sortedEntries.length > 0 && (
            <div className="overflow-x-auto">
              <EntriesTable
                entries={sortedEntries}
                actionLoading={actionLoading}
                sortField={sortField}
                sortDir={sortDir}
                onSort={(field) => {
                  if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortField(field); setSortDir("desc"); }
                }}
                onRetry={connectionStatus?.type === "reachable" || retryWithoutCheck ? handleRetry : undefined}
                onDiscard={openDiscard}
                onSelect={setDrawerEntry}
                sessionRole={useLocalSessionStore.getState().session?.role as RoleType}
                retryDisabledMessage={
                  connectionStatus?.type !== "reachable" && !retryWithoutCheck
                    ? "Test connection or enable 'Retry without server check'"
                    : undefined
                }
              />
            </div>
          )}

          {sortedEntries.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400">
              No error entries found.
            </div>
          )}

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

        <div className="mt-3 text-center">
          <button
            className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-600 hover:bg-gray-200"
            onClick={loadData}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Detail drawer */}
      {drawerEntry && (
        <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
          <EntryDetailDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} />
        </div>
      )}

      {/* Discard modal */}
      {discardModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !discardSubmitting && setDiscardModal(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-gray-800">Discard Sync Entry</h2>
            <p className="mb-4 text-sm text-gray-600">
              This action cannot be undone. The operation will be permanently excluded from sync.
            </p>
            <label className="mb-4 block">
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

// ── Sub-components ─────────────────────────────────────────────────────

const KpiTile: FC<{ label: string; value: string | number; accentColor: string; subLabel?: string }> = ({
  label, value, accentColor, subLabel,
}) => (
  <div className="rounded-lg border border-gray-200 bg-white p-4" style={{ borderLeft: `4px solid ${accentColor}` }}>
    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color: accentColor }}>
      {typeof value === "number" ? value.toLocaleString() : value}
    </p>
    {subLabel && <p className="mt-0.5 text-xs text-gray-400">{subLabel}</p>}
  </div>
);

const TestConnectionButton: FC<{ status: ConnectionStatus | null; onClick: () => void }> = ({ status, onClick }) => (
  <button
    className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${
      status?.type === "testing"
        ? "bg-gray-200 text-gray-500 cursor-wait"
        : status?.type === "reachable"
          ? "bg-green-100 text-green-800 border border-green-300"
          : status?.type === "unreachable"
            ? "bg-red-100 text-red-800 border border-red-300"
            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
    }`}
    onClick={onClick}
    disabled={status?.type === "testing"}
  >
    {status?.type === "testing" ? (
      <>
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        Testing…
      </>
    ) : status?.type === "reachable" ? (
      <><span className="h-2 w-2 rounded-full bg-green-500" /> Server reachable</>
    ) : status?.type === "unreachable" ? (
      <><span className="h-2 w-2 rounded-full bg-red-500" /> Unreachable {status.message && <span className="text-gray-400 text-xs">({status.message})</span>}</>
    ) : (
      "Test connection"
    )}
  </button>
);

const SparklineChart: FC<{ data: HealthTimelineBucket[] }> = ({ data }) => {
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.completed, d.nonCompleted)));
  const width = 1000, height = 80, padding = 2;
  const barWidth = Math.max(2, (width - padding * 2) / data.length);
  const chartHeight = height - padding * 2;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-h-20">
      {data.map((d, i) => {
        const h = chartHeight * (Math.max(d.completed, d.nonCompleted) / maxVal);
        const x = padding + i * barWidth;
        return (
          <g key={d.id}>
            <rect x={x} y={height - padding - h} width={barWidth - 1} height={h} fill="#22c55e" opacity={0.8} />
            {d.nonCompleted > 0 && (
              <rect x={x} y={height - padding - h} width={barWidth - 1} height={chartHeight * (d.nonCompleted / maxVal)} fill="#ef4444" opacity={0.8} />
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ── Entries table ──────────────────────────────────────────────────────

interface EntriesTableProps {
  entries: PermanentFailureEntry[];
  actionLoading: string | null;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  onRetry?: (entryId: string) => void;
  onDiscard: (entryId: string) => void;
  onSelect: (entry: PermanentFailureEntry) => void;
  sessionRole: string | undefined;
  retryDisabledMessage?: string;
}

const EntriesTable: FC<EntriesTableProps> = ({
  entries, actionLoading, sortField, sortDir, onSort, onRetry, onDiscard, onSelect, sessionRole, retryDisabledMessage,
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
          <Th onClick={() => onSort("operationType")}>Type{sortIndicator("operationType")}</Th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preview</th>
          <Th onClick={() => onSort("lastAttemptAt")}>Last Attempt{sortIndicator("lastAttemptAt")}</Th>
          <Th onClick={() => onSort("retryCount")}>Retries{sortIndicator("retryCount")}</Th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error</th>
          {isManager && <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white">
        {entries.map((entry) => {
          // Visual states: stale PENDING → yellow left border,
          // PERMANENT_FAILURE → red left border, DISCARDED → muted
          const isStalePending = entry.retryCount === 0 && entry.failureCategory === null && entry.lastAttemptAt === null;
          const isPermanentFailure = entry.failureCategory !== null || entry.retryCount >= 10;
          const borderClass = isStalePending
            ? "border-l-4 border-l-yellow-500"
            : isPermanentFailure
              ? "border-l-4 border-l-red-500"
              : "";

          return (
            <tr key={entry.id} className={`cursor-pointer hover:bg-gray-50 ${borderClass}`} onClick={() => onSelect(entry)}>
              <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{entry.operationType.replace(/_/g, " ")}</td>
              <td className="max-w-xs truncate px-4 py-3 text-gray-500">{entry.payloadPreview}</td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-500">{entry.lastAttemptAt ? formatRelativeTime(entry.lastAttemptAt) : "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-500">{entry.retryCount}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <FailureBadge category={entry.failureCategory} />
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-gray-500">{entry.lastErrorMessage ?? "—"}</td>
              {isManager && (
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {onRetry ? (
                    <button
                      className="mr-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      onClick={(e) => { e.stopPropagation(); onRetry(entry.id); }}
                      disabled={actionLoading === entry.id || !!retryDisabledMessage}
                      title={retryDisabledMessage}
                    >
                      {actionLoading === entry.id ? "…" : "Retry"}
                    </button>
                  ) : (
                    <button
                      className="mr-2 rounded bg-gray-300 px-3 py-1 text-xs font-medium text-gray-500 cursor-not-allowed"
                      onClick={(e) => e.stopPropagation()}
                      disabled
                      title={retryDisabledMessage}
                    >
                      Retry
                    </button>
                  )}
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
          );
        })}
        {entries.length === 0 && (
          <tr><td colSpan={isManager ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No entries found.</td></tr>
        )}
      </tbody>
    </table>
  );
};

const FailureBadge: FC<{ category: string | null }> = ({ category }) => {
  const colorMap: Record<string, string> = {
    NETWORK: "bg-yellow-100 text-yellow-800",
    VALIDATION: "bg-purple-100 text-purple-800",
    CONFLICT: "bg-orange-100 text-orange-800",
    AUTH: "bg-red-100 text-red-800",
    BUSINESS_RULE: "bg-blue-100 text-blue-800",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[category ?? ""] ?? "bg-gray-100 text-gray-800"}`}>
      {category ?? "PENDING"}
    </span>
  );
};

// ── Detail drawer ──────────────────────────────────────────────────────

const EntryDetailDrawer: FC<{ entry: PermanentFailureEntry; onClose: () => void }> = ({ entry, onClose }) => {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [recoveryLog, setRecoveryLog] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { prisma } = await getLocalDatabase();
        const [att, log] = await Promise.all([
          prisma.syncAttempt.findMany({ where: { syncQueueEntryId: entry.id }, orderBy: { attemptedAt: "desc" as const } }),
          prisma.syncRecoveryLog.findMany({ where: { syncQueueEntryId: entry.id }, orderBy: { at: "desc" as const } }),
        ]);
        setAttempts(att as any[]);
        setRecoveryLog(log as any[]);
      } catch { /* drawer is advisory */ }
    })();
  }, [entry.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Entry Detail</h2>
        <button className="text-gray-400 hover:text-gray-600" onClick={onClose} aria-label="Close drawer">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <dl className="space-y-3 text-sm">
          <SummaryRow label="Operation" value={entry.operationType.replace(/_/g, " ")} />
          <SummaryRow label="UUID" value={entry.operationUuid} mono />
          <SummaryRow label="Status" value="PERMANENT_FAILURE" badge />
          <SummaryRow label="Category" value={entry.failureCategory ?? "UNKNOWN"} />
          <SummaryRow label="Error" value={entry.lastErrorMessage ?? "—"} />
          <SummaryRow label="Retries" value={String(entry.retryCount)} />
          <SummaryRow label="Created" value={formatRelativeTime(entry.sourceCreatedAt)} />
          <SummaryRow label="Last Attempt" value={entry.lastAttemptAt ? formatRelativeTime(entry.lastAttemptAt) : "—"} />
          <SummaryRow label="Payload Preview" value={entry.payloadPreview} small />
        </dl>

        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-gray-500 uppercase">
            Retry History ({attempts.length})
          </h3>
          {attempts.length === 0 ? (
            <p className="text-xs italic text-gray-400">No retry history recorded</p>
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
                    }`}>{a.outcome}</span>
                    <span className="text-gray-400">{a.attemptedAt ? formatRelativeTime(a.attemptedAt) : "—"}</span>
                  </div>
                  {a.errorMessage && <p className="mt-1 truncate text-gray-500">{a.errorMessage}</p>}
                  {a.failureCategory && <p className="mt-0.5 text-gray-400">Category: {a.failureCategory}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-gray-700 uppercase">Recovery Actions ({recoveryLog.length})</h3>
          {recoveryLog.length === 0 ? (
            <p className="text-xs italic text-gray-400">No recovery actions taken</p>
          ) : (
            <ul className="space-y-2">
              {recoveryLog.map((log: any) => (
                <li key={log.id} className="rounded bg-gray-50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className={`font-medium ${log.action === "RETRY" ? "text-blue-700" : "text-red-700"}`}>{log.action}</span>
                    <span className="text-gray-400">{log.at ? formatRelativeTime(log.at) : "—"}</span>
                  </div>
                  {log.reason && <p className="mt-1 text-gray-500">{log.reason}</p>}
                  {log.actorUserId && <p className="mt-0.5 text-gray-400">by {log.actorUserId}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryRow: FC<{ label: string; value: string; mono?: boolean; badge?: boolean; small?: boolean }> = ({
  label, value, mono, badge, small,
}) => (
  <div>
    <dt className="text-xs font-medium text-gray-500 uppercase">{label}</dt>
    <dd className={`mt-0.5 ${mono ? "font-mono text-xs" : ""} ${small ? "text-xs" : "text-gray-900"}`}>
      {badge ? (
        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{value}</span>
      ) : value}
    </dd>
  </div>
);

const Th: FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <th className="cursor-pointer px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hover:text-gray-700" onClick={onClick}>
    {children}
  </th>
);

// ── Helpers ────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
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

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
