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
  useContext,
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
import { useTranslation } from "react-i18next";
import { useSyncIntegrityStore } from "../../../domain/sync/sync-integrity.store";
import { useLocalSyncStore } from "../../store/local-sync/local-sync.store";
import { ServiceContext } from "../common/service-context";
import { getLocalSyncEngine } from "../../../domain/local-sync/local-sync-engine-holder";

// ── Presentational components (provided by frontend-pos) ────────────────
import type { ConnectionStatus, SortField, SortDir } from "./sync-health.types";
import { SyncHealthLoading } from "./sync-health-loading";
import { SyncHealthError } from "./sync-health-error";
import { SyncHealthToast } from "./sync-health-toast";
import { KpiGrid } from "./kpi-grid";
import { LanHubCard } from "./lan-hub-card";
import { ActionBar } from "./action-bar";
import { TimelineChart } from "./timeline-chart";
import { NoSyncDataPlaceholder } from "./no-sync-data-placeholder";
import { FailureBreakdownPanel } from "./failure-breakdown-panel";
import { AllClearBanner } from "./all-clear-banner";
import { EntriesSection } from "./entries-section";
import { EntryDetailDrawer } from "./entry-detail-drawer";

// ── Constants ───────────────────────────────────────────────────────────

const AUTO_REFRESH_MS = 30_000;
const TIMELINE_HOURS = 24;

// ── Page component ──────────────────────────────────────────────────────

export const SyncHealthPage: FC = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ type: null });
  const [retryWithoutCheck, setRetryWithoutCheck] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);

  // Advisory count from the last post-reconnect integrity verification.
  // Read-only: verdicts never mutate local queue data.
  const integrityReviewCount = useSyncIntegrityStore((s) => s.reviewRequiredCount);

  // LAN hub state — reactive store populated by the Rust-side mDNS/hub modules.
  const currentHub = useLocalSyncStore((s) => s.currentHub);
  const lanStatus = useLocalSyncStore((s) => s.status);
  const lanPeers = useLocalSyncStore((s) => s.peers);
  const lanLastSyncAt = useLocalSyncStore((s) => s.lastSyncAt);
  const lanLastSyncError = useLocalSyncStore((s) => s.lastSyncError);
  const lanLastCycleOutcome = useLocalSyncStore((s) => s.lastCycleOutcome);

  // Startup-wired services (null outside <ServiceProvider>, e.g. isolated
  // tests). Manual actions prefer these over ad-hoc replacements so the LAN
  // cycle and the cloud push run with the real configuration.
  const startupServices = useContext(ServiceContext);

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
      const accessToken = session?.accessToken?.trim();
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
      const offlineToken = session?.offlineToken?.trim();
      if (offlineToken) headers["X-Offline-Token"] = offlineToken;

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

  /**
   * Manual sync trigger — drives BOTH channels with the startup-wired
   * instances and reports each one separately:
   *
   * 1. **LAN relay** (`LocalSyncEngine.runCycle`): push un-relayed entries
   *    to the elected hub + adopt peers' operations. This is the channel
   *    that works without internet.
   * 2. **Cloud push** (`SyncScheduler.syncNow`): full internet cycle.
   *
   * Only when no startup services exist (isolated tests) does it fall back
   * to an ad-hoc scheduler for the cloud half. Either half failing never
   * blocks the other — the automatic cycles keep retrying on their own.
   */
  const runPushCycleNow = useCallback(async (): Promise<{
    lanOutcome: string;
    pushedToHub: number;
    adoptedFromHub: number;
    cloudRan: boolean;
  }> => {
    const engine =
      getLocalSyncEngine() ?? startupServices?.localSyncEngine ?? null;
    let lanOutcome = 'skipped-no-engine';
    let pushedToHub = 0;
    let adoptedFromHub = 0;
    if (engine) {
      const lan = await engine.runCycle();
      lanOutcome = lan.outcome;
      pushedToHub = lan.pushedToHub;
      adoptedFromHub = lan.adoptedFromHub;
      if (lan.outcome === 'error') {
        throw new Error(
          `LAN relay failed: ${lan.errorMessage ?? 'unknown error'}`,
        );
      }
    }

    let cloudRan = false;
    const scheduler = startupServices?.syncScheduler ?? null;
    if (scheduler) {
      await scheduler.syncNow();
      cloudRan = true;
    } else {
      // Fallback for contexts without a provider (tests, early boot):
      // cloud half only, with whatever credentials the session holds.
      const { createSyncScheduler } = await import("../../../domain/sync/sync-scheduler.service");
      const { prisma: rawPrisma } = await getLocalDatabase();
      const prisma = rawPrisma as PrismaClient;
      const session = useLocalSessionStore.getState().session;
      const accessToken = session?.accessToken;
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
      const fallback = createSyncScheduler({
        prisma,
        baseUrl,
        accessToken,
        config: { baseUrl, accessToken },
        catalog: { baseUrl, accessToken },
        lots: { baseUrl, accessToken },
        clients: { baseUrl, accessToken },
      });
      await fallback.syncNow();
      cloudRan = true;
    }

    return { lanOutcome, pushedToHub, adoptedFromHub, cloudRan };
  }, [startupServices]);

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
        // Retry now: force an immediate attempt on both channels. A
        // transport failure here is not fatal — the entry stays PENDING
        // for the next cycle — but surface it so the operator knows.
        try {
          const summary = await runPushCycleNow();
          showToast(
            "success",
            `Retry pushed (LAN: ${summary.pushedToHub} relayed, ` +
              `${summary.adoptedFromHub} adopted · Nube: ciclo ejecutado)`,
          );
        } catch (pushErr) {
          showToast(
            "info",
            pushErr instanceof Error ? pushErr.message : "Immediate push failed",
          );
        }
        await loadData();
      } catch (err) {
        if (err instanceof EntryStateChangedException) {
          showToast("error", "This entry was just actioned by someone else. The list has been refreshed.");
          await loadData();
        } else if (err instanceof EntryNotInPermanentFailureException) {
          showToast("error", (err as DomainError).message);
          await loadData();
        } else if (err instanceof EntryNotReplayableException) {
          // Not retryable — show the last error; the entry is never deleted.
          showToast("error", (err as DomainError).message);
        } else {
          showToast("error", err instanceof Error ? err.message : "Retry failed");
        }
      } finally {
        setActionLoading(null);
      }
    },
    [loadData, runPushCycleNow],
  );

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
      const summary = await runPushCycleNow();
      const lanPart =
        summary.lanOutcome === 'ok'
          ? `LAN: ${summary.pushedToHub} al hub, ${summary.adoptedFromHub} adoptadas`
          : summary.lanOutcome === 'skipped-no-hub'
            ? 'LAN: sin hub (terminal única o eligiendo hub)'
            : summary.lanOutcome === 'skipped-backoff'
              ? 'LAN: hub en pausa tras fallos, reintenta solo'
              : summary.lanOutcome === 'skipped-no-engine'
                ? 'LAN: motor no disponible'
                : `LAN: ${summary.lanOutcome}`;
      showToast("success", `Sincronización ejecutada — ${lanPart} · Nube: ciclo ejecutado`);
      await loadData();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Sync cycle failed");
    }
  }, [loadData, runPushCycleNow]);

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

        {integrityReviewCount !== null && integrityReviewCount > 0 && (
          <SyncHealthToast
            type="info"
            message={t("sync.integrity_review_banner", { count: integrityReviewCount })}
          />
        )}

        {toast && <SyncHealthToast type={toast.type} message={toast.message} />}

        <KpiGrid
          counts={counts}
          successRateDisplay={successRateDisplay}
          backupSummary={backupSummary}
          onBackupClick={() => dispatch(navigateToRecovery())}
        />

        {/* LAN Hub status + replicated-in-last-5m — separates "asegurado en tienda" from "pendiente nube" */}
        <LanHubCard
          currentHub={currentHub}
          status={lanStatus}
          lanCounts={
            counts
              ? {
                  pendingLanRelayed: counts.pendingLanRelayed,
                  pendingNotRelayed: counts.pendingNotRelayed,
                  lanRelayedLast5Min: counts.lanRelayedLast5Min,
                }
              : null
          }
          lastSyncAt={lanLastSyncAt}
          lastSyncError={lanLastSyncError}
          peersCount={lanPeers.length}
          isBackoff={lanLastCycleOutcome === "skipped-backoff"}
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
          onSelect={setDrawerEntry}
          onLoadMore={loadMore}
          onRefresh={loadData}
        />
      </div>

      {drawerEntry && (
        <EntryDetailDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} />
      )}
    </section>
  );
};
