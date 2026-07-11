/**
 * Sync Health page — thin wiring container.
 *
 * Owns all state, side-effects, and action handlers for the sync-monitoring
 * screen.  Presentational sub-components are imported from sibling files so
 * this file stays focused on orchestration, not markup.
 *
 * Role-gated to ADMIN. Re-checks role on every action.
 *
 * @category Page
 */

import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createSyncMetricsService } from "../../../domain/sync/sync-metrics.service";
import {
  createSyncRecoveryService,
  EntryNotInPermanentFailureException,
  EntryStateChangedException,
  EntryNotReplayableException,
} from "../../../domain/sync/sync-recovery.service";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { RoleType } from "@pharmacy/shared-types";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import type {
  QueueCounts,
  FailureBreakdownEntry,
  PermanentFailureEntry,
  HealthTimelineBucket,
  PaginatedEntries,
  EntryFilter,
} from "../../../domain/sync/sync-metrics.service";
import { DomainError } from "../../../common/domain-error";
import { API_BASE_URL } from "../../../infrastructure/config";
import { useAppDispatch } from "@/store/hooks";
import { navigateToRecovery } from "@/store/slices/ui-slice";
import type { PrismaClient } from "@pharmacy/database/local";
import { downloadBlob } from "../../../common/download";

// ── Presentational components (provided by frontend-pos) ────────────────
import type { ConnectionStatus, SortField, SortDir } from "./sync-health.types";
import { SyncHealthLoading } from "./sync-health-loading";
import { SyncHealthError } from "./sync-health-error";
import { SyncHealthToast } from "./sync-health-toast";
import { KpiGrid } from "./kpi-grid";
import { ActionBar } from "./action-bar";
import { TimelineChart } from "./timeline-chart";
import { NoSyncDataPlaceholder } from "./no-sync-data-placeholder";
import { FailureBreakdownPanel } from "./failure-breakdown-panel";
import { AllClearBanner } from "./all-clear-banner";
import { EntriesSection } from "./entries-section";
import { EntryDetailDrawer } from "./entry-detail-drawer";
import { DiscardEntryModal } from "./discard-entry-modal";

// ── Constants ───────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 30_000;
const TIMELINE_HOURS = 24;

// ── Page component ──────────────────────────────────────────────────────

export const SyncHealthPage: FC = () => {
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [breakdown, setBreakdown] = useState<FailureBreakdownEntry[]>([]);
  const [timeline, setTimeline] = useState<HealthTimelineBucket[]>([]);
  const [entries, setEntries] = useState<PaginatedEntries<PermanentFailureEntry> | null>(null);
  const [backupSummary, setBackupSummary] = useState<{
    lastBackupAt: string | null;
    backupHealth: import("../../../domain/sync/sync-metrics.service").BackupHealthLevel;
  } | null>(null);

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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ type: null });
  const [retryWithoutCheck, setRetryWithoutCheck] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);

  const servicesRef = useRef<{
    metricsService: ReturnType<typeof createSyncMetricsService> | null;
    recoveryService: ReturnType<typeof createSyncRecoveryService> | null;
  }>({ metricsService: null, recoveryService: null });

  // ── Data loading ────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    try {
      const { prisma: rawPrisma } = await getLocalDatabase();
      const prisma = rawPrisma as PrismaClient;
      const metricsService = createSyncMetricsService(prisma);
      const recoveryService = createSyncRecoveryService({ prisma });
      servicesRef.current = { metricsService, recoveryService };

      const [c, b, tml, permanentFailures, stalePending, backupSummaryResult, backupHealth] = await Promise.all([
        metricsService.getQueueCounts(),
        metricsService.getFailureBreakdown(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        metricsService.getSyncHealthTimeline(TIMELINE_HOURS),
        metricsService.getPermanentFailureEntries({ limit: 20 }),
        metricsService.getStalePendingEntries({ limit: 5 }),
        metricsService.getBackupSummary(),
        metricsService.getBackupHealth(),
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
      setBackupSummary({
        lastBackupAt: backupSummaryResult.lastBackupAt,
        backupHealth,
      });
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sync health data");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-refresh KPI tiles & breakdown every 30s, pause on tab hide.
  useEffect(() => {
    const refreshTiles = async () => {
      if (document.visibilityState !== "visible") return;
      const ms = servicesRef.current.metricsService;
      if (!ms) return;
      try {
        const [c, b, summary, health] = await Promise.all([
          ms.getQueueCounts(),
          ms.getFailureBreakdown(new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ms.getBackupSummary(),
          ms.getBackupHealth(),
        ]);
        setCounts(c);
        setBreakdown(b);
        setBackupSummary({ lastBackupAt: summary.lastBackupAt, backupHealth: health });
      } catch {
        /* advisory — stale data remains visible */
      }
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

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Pagination / sorting / filtering ─────────────────────────────────

  const loadMore = useCallback(async () => {
    if (!cursor || !servicesRef.current.metricsService) return;
    const next = await servicesRef.current.metricsService.getPermanentFailureEntries({
      limit: 20,
      cursor,
      category: selectedFilterCategory ?? undefined,
    });
    setEntries(next);
    setCursor(next.cursor);
  }, [cursor, selectedFilterCategory]);

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

  // ── Connection test ──────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    setConnectionStatus({ type: "testing" });
    try {
      const session = useLocalSessionStore.getState().session;
      const headers: Record<string, string> = {};
      if (session?.userId) headers["Authorization"] = `Bearer ${session.userId}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        `${API_BASE_URL.replace(/\/+$/, "")}/sync/status`,
        { method: "GET", headers, signal: controller.signal },
      );
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
    setTimeout(() => setConnectionStatus({ type: null }), 5000);
  }, []);

  // ── Entry actions ────────────────────────────────────────────────────

  const handleRetry = useCallback(
    async (entryId: string) => {
      const session = useLocalSessionStore.getState().session;
      if (!session?.role) {
        showToast("error", "No active session");
        return;
      }
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
    },
    [loadData],
  );

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
    if (!discardReason.trim()) {
      showToast("error", "A discard reason is required");
      return;
    }

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
  }, [discardModal, discardReason, loadData]);

  // ── Export actions ───────────────────────────────────────────────────

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
  }, [selectedFilterCategory, showDiscarded]);

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
  }, [selectedFilterCategory, showDiscarded]);

  // ── Sync trigger ─────────────────────────────────────────────────────

  const handleRunSyncNow = useCallback(async () => {
    try {
      const { createSyncScheduler } = await import("../../../domain/sync/sync-scheduler.service");
      const { prisma: rawPrisma } = await getLocalDatabase();
      const prisma = rawPrisma as PrismaClient;
      const scheduler = createSyncScheduler({
        prisma,
        baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
        config: { baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" },
        catalog: { baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" },
        lots: { baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" },
        clients: { baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" },
      });
      await scheduler.syncNow();
      showToast("success", "Sync cycle completed");
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Sync cycle failed");
    }
  }, [loadData]);

  // ── Toast helper ─────────────────────────────────────────────────────

  const showToast = useCallback(
    (type: "success" | "error" | "info", message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 5000);
    },
    [],
  );

  // ── Derived display values ───────────────────────────────────────────

  const successRateDisplay = useMemo(() => {
    if (!counts) return "—";
    const denominator = counts.completed24h + counts.failed + counts.permanentFailure;
    return denominator === 0
      ? "—"
      : `${((counts.completed24h / denominator) * 100).toFixed(1)}%`;
  }, [counts]);

  const successRateColor = useMemo(() => {
    if (successRateDisplay === "—") return "#9ca3af";
    const value = parseFloat(successRateDisplay);
    return value >= 95 ? "#22c55e" : value >= 80 ? "#f59e0b" : "#ef4444";
  }, [successRateDisplay]);

  const sessionRole = useLocalSessionStore.getState().session?.role as RoleType | undefined;

  const retryDisabledMessage =
    connectionStatus.type !== "reachable" && !retryWithoutCheck
      ? "Test connection or enable 'Retry without server check'"
      : undefined;

  // ── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return <SyncHealthLoading />;
  }

  if (error) {
    return <SyncHealthError error={error} onRetry={loadData} />;
  }

  return (
    <section className="flex h-full overflow-hidden bg-slate-50">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="mb-6 text-2xl font-bold text-gray-800">Sync Health</h1>

        {toast && <SyncHealthToast type={toast.type} message={toast.message} />}

        <KpiGrid
          counts={counts}
          successRateDisplay={successRateDisplay}
          successRateColor={successRateColor}
          backupSummary={backupSummary}
          onBackupClick={() => dispatch(navigateToRecovery())}
        />

        <ActionBar
          connectionStatus={connectionStatus}
          onTestConnection={handleTestConnection}
          onRunSyncNow={handleRunSyncNow}
          onExportCsv={handleExportCsv}
          onExportJson={handleExportJson}
          retryWithoutCheck={retryWithoutCheck}
          onRetryWithoutCheckChange={setRetryWithoutCheck}
          showDiscarded={showDiscarded}
          onShowDiscardedChange={setShowDiscarded}
        />

        {timeline.length > 0 && <TimelineChart data={timeline} />}

        {timeline.length === 0 && counts?.completedTotal === 0 && <NoSyncDataPlaceholder />}

        {breakdown.length > 0 && (
          <FailureBreakdownPanel
            data={breakdown}
            selectedCategory={selectedFilterCategory}
            onSelectCategory={setSelectedFilterCategory}
          />
        )}

        {breakdown.length === 0 && counts && counts.completedTotal > 0 && <AllClearBanner />}

        <EntriesSection
          entries={sortedEntries}
          actionLoading={actionLoading}
          sortField={sortField}
          sortDir={sortDir}
          hasMore={entries?.hasMore ?? false}
          selectedCategory={selectedFilterCategory}
          showDiscarded={showDiscarded}
          retryDisabledMessage={retryDisabledMessage}
          sessionRole={sessionRole}
          onSort={(field) => {
            if (sortField === field) {
              setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
            } else {
              setSortField(field);
              setSortDir("desc");
            }
          }}
          onRetry={handleRetry}
          onDiscard={openDiscard}
          onSelect={setDrawerEntry}
          onLoadMore={loadMore}
          onRefresh={loadData}
        />
      </div>

      {drawerEntry && (
        <EntryDetailDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} />
      )}

      {discardModal && (
        <DiscardEntryModal
          entryId={discardModal.id}
          discardReason={discardReason}
          onDiscardReasonChange={setDiscardReason}
          isSubmitting={discardSubmitting}
          onSubmit={submitDiscard}
          onCancel={() => setDiscardModal(null)}
        />
      )}
    </section>
  );
};
