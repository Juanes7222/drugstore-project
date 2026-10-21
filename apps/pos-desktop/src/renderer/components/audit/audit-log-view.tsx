/**
 * Audit log view — timeline of audit events grouped by day.
 *
 * Manager/owner only. Shows filtered, paginated audit events as timeline
 * cards with colored category indicators, human-readable detail summaries,
 * and expandable details. Replaces the old flat-table audit view.
 */
import {
  type FC,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangleIcon,
  CalendarIcon,
  ClockIcon,
  FilterIcon,
  InfoIcon,
  RefreshCwIcon,
  SearchXIcon,
  XIcon,
} from "@/components/ui/icons";
import {
  useLocalSessionStore,
  hasMinRole,
} from "../../../domain/auth/local-session.store";
import {
  createAuthService,
  type AuthService,
} from "../../../domain/auth/auth.service";
import { getLocalAuditEntries } from "../../../domain/audit/audit.service";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import { API_BASE_URL } from "@infra/config";
import { RoleType } from "@pharmacy/shared-types";
import { AuditEventCard, type AuditLogEntry } from "./audit-event-card";
import {
  EVENT_FILTER_OPTIONS,
  CATEGORY_META,
  getEventConfig,
  type EventCategory,
  type AuditEventConfig,
} from "./audit-event-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "AUTH_USERS", labelKey: "audit_log.module_auth" },
  { value: "INVENTORY", labelKey: "audit_log.module_inventory" },
  { value: "CASH_SHIFT", labelKey: "audit_log.module_cash_shift" },
  { value: "SALES", labelKey: "audit_log.module_sales" },
  { value: "CLIENTS", labelKey: "audit_log.module_clients" },
  { value: "PRESCRIPTIONS", labelKey: "audit_log.module_prescriptions" },
  { value: "PURCHASES", labelKey: "audit_log.module_purchases" },
  { value: "FISCAL", labelKey: "audit_log.module_fiscal" },
  { value: "SYNC", labelKey: "audit_log.module_sync" },
  { value: "REPORTS", labelKey: "audit_log.module_reports" },
];

const CATEGORY_KEYS: Record<string, string> = {
  auth: "audit_log.category_auth",
  failure: "audit_log.category_failure",
  security: "audit_log.category_security",
  users: "audit_log.category_users",
  inventory: "audit_log.category_inventory",
  network: "audit_log.category_network",
  cashShift: "audit_log.category_cashShift",
  sale: "audit_log.category_sale",
  client: "audit_log.category_client",
  prescription: "audit_log.category_prescription",
  purchase: "audit_log.category_purchase",
  fiscal: "audit_log.category_fiscal",
  default: "audit_log.category_default",
};

// ---------------------------------------------------------------------------
// Day grouping
// ---------------------------------------------------------------------------

interface DayGroup {
  label: string;
  dateKey: string;
  logs: AuditLogEntry[];
}

function groupByDay(
  logs: AuditLogEntry[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): DayGroup[] {
  const groups = new Map<string, AuditLogEntry[]>();

  for (const log of logs) {
    const d = new Date(log.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const groupsArray: DayGroup[] = [];
  for (const [key, entries] of groups) {
    let label: string;
    if (key === todayKey) {
      label = t("audit_log.events_today");
    } else if (key === yesterdayKey) {
      label = t("audit_log.events_yesterday");
    } else {
      const d = new Date(key + "T00:00:00");
      label = d.toLocaleDateString("es-CO", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
    groupsArray.push({ label, dateKey: key, logs: entries });
  }

  groupsArray.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return groupsArray;
}

// ---------------------------------------------------------------------------
// Skeleton card for loading state
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      className="rounded-sm mb-1 animate-pulse"
      style={{
        backgroundColor: "var(--color-panel)",
        boxShadow: "var(--shadow-pos-panel)",
        borderLeft:
          "3px solid color-mix(in srgb, var(--color-ink) 10%, transparent)",
      }}
    >
      <div className="px-3 pt-2 pb-3 space-y-2">
        <div className="flex justify-between">
          <div
            className="h-4 w-48 rounded"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          />
          <div
            className="h-3 w-16 rounded"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 8%, transparent)",
            }}
          />
        </div>
        <div
          className="h-3 w-32 rounded"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 6%, transparent)",
          }}
        />
        <div
          className="h-3 w-64 rounded"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-ink) 6%, transparent)",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AuditLogView: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  // Ref keeps the role gate out of fetch dependencies — the session object
  // identity must never re-trigger the fetch effect.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  /**
   * Category chips double as legend AND filter: empty set shows every
   * category, a non-empty set restricts the timeline to those categories.
   * Applied client-side over the loaded page(s).
   */
  const [categoryFilter, setCategoryFilter] = useState<EventCategory[]>([]);
  /** 'pending' shows only local rows not yet enqueued to the SyncQueue. */
  const [syncFilter, setSyncFilter] = useState<"" | "pending">("");
  /** True when one of the two sources (local/server) failed during the last fetch. */
  const [serverError, setServerError] = useState(false);
  /**
   * Whether the next fetch driven by the page change should APPEND its rows
   * to the timeline ("Cargar más") instead of replacing the page.
   */
  const loadMoreRef = useRef(false);
  const pageSize = 50;

  // Whether any filter is active (for showing the clear button)
  const hasActiveFilters =
    eventFilter ||
    moduleFilter ||
    fromDate ||
    toDate ||
    syncFilter ||
    categoryFilter.length > 0;

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchLogs = useCallback(async () => {
    // Role gate: managers/owners only — never query when the view is blocked.
    const currentSession = sessionRef.current;
    if (!currentSession || !hasMinRole(currentSession, RoleType.MANAGER))
      return;

    setIsLoading(true);
    const targetPage = page;
    const append = loadMoreRef.current;
    /** Merge rows honoring load-more append semantics, deduping by id. */
    const finalize = (
      rows: AuditLogEntry[],
      newTotal: number,
      serverFailed: boolean,
    ) => {
      setServerError(serverFailed);
      setLogs((prev) => {
        const combined = append ? [...prev, ...rows] : rows;
        const seen = new Set<string>();
        return combined
          .filter((row) =>
            seen.has(row.id) ? false : (seen.add(row.id), true),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, (targetPage + 1) * pageSize);
      });
      setTotal(newTotal);
      loadMoreRef.current = false;
    };

    try {
      const localModules = [
        "INVENTORY",
        "CASH_SHIFT",
        "SALES",
        "CLIENTS",
        "PRESCRIPTIONS",
        "PURCHASES",
        "FISCAL",
        "SYNC",
        "REPORTS",
      ];

      const pendingOnly = syncFilter === "pending";
      const isAllModules = !moduleFilter;
      const isLocalModule = moduleFilter && localModules.includes(moduleFilter);
      const isServerModule = moduleFilter === "AUTH_USERS";

      const localQuery = {
        action: eventFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        syncStatus: pendingOnly ? ("pending" as const) : undefined,
        limit: pageSize,
        offset: page * pageSize,
      };

      const localPromise =
        isAllModules || isLocalModule || pendingOnly
          ? (async () => {
              const { prisma, client } = await getLocalDatabase();
              return getLocalAuditEntries(
                prisma as any,
                {
                  ...localQuery,
                  module: isLocalModule ? (moduleFilter as any) : undefined,
                },
                isLocalModule ? client : undefined,
              );
            })()
          : null;

      const serverQuery = {
        event: eventFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: pageSize,
        offset: page * pageSize,
      };

      const serverPromise =
        !pendingOnly && (isAllModules || isServerModule)
          ? authService.getAuditLogs(serverQuery)
          : null;

      if (isAllModules && !pendingOnly) {
        // Offline-first: merge both sources, tolerating one side failing.
        // Server unreachable must NOT hide local events.
        const [localRes, serverRes] = await Promise.allSettled([
          localPromise!,
          serverPromise!,
        ]);
        const localData =
          localRes.status === "fulfilled" ? localRes.value : null;
        const serverData =
          serverRes.status === "fulfilled" ? serverRes.value : null;
        if (!localData && !serverData) {
          throw new Error(
            "[AuditLogView] both local and server fetches failed",
          );
        }
        finalize(
          [...(localData?.rows ?? []), ...(serverData?.rows ?? [])],
          (localData?.total ?? 0) + (serverData?.total ?? 0),
          !localData || !serverData,
        );
      } else if (isLocalModule || pendingOnly) {
        const result = await localPromise!;
        finalize(result.rows, result.total, false);
      } else {
        const result = await serverPromise!;
        finalize(result.rows ?? [], result.total ?? 0, false);
      }
    } catch (err) {
      console.error("[AuditLogView] fetchLogs error:", err);
      setLogs([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [
    authService,
    moduleFilter,
    eventFilter,
    fromDate,
    toDate,
    page,
    syncFilter,
  ]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // ------------------------------------------------------------------
  // Derived
  // ------------------------------------------------------------------

  const dayGroups = useMemo(() => groupByDay(logs, t), [logs, t]);

  // Category bars + chips always describe the FULL loaded timeline; the
  // category filter dims/removes cards without rewriting the summary.
  const categoryCounts = useMemo(() => {
    const counts = new Map<EventCategory, number>();
    for (const log of logs) {
      const category = getEventConfig(log.action).category;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const visibleCategorySet = useMemo(
    () => new Set(categoryFilter),
    [categoryFilter],
  );
  const isVisibleCategory = useCallback(
    (log: AuditLogEntry) =>
      visibleCategorySet.size === 0 ||
      visibleCategorySet.has(getEventConfig(log.action).category),
    [visibleCategorySet],
  );
  const visibleCount = useMemo(
    () => logs.filter(isVisibleCategory).length,
    [logs, isVisibleCategory],
  );

  const filteredEventOptions = useMemo(
    () =>
      !moduleFilter
        ? EVENT_FILTER_OPTIONS
        : EVENT_FILTER_OPTIONS.filter((opt) => opt.module === moduleFilter),
    [moduleFilter],
  );

  const toggleCategory = useCallback((category: EventCategory) => {
    setCategoryFilter((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setEventFilter("");
    setModuleFilter("");
    setFromDate("");
    setToDate("");
    setSyncFilter("");
    setCategoryFilter([]);
    setPage(0);
  }, []);

  const loadMore = useCallback(() => {
    loadMoreRef.current = true;
    setPage((p) => p + 1);
  }, []);

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center max-w-sm">
          <InfoIcon
            size={40}
            strokeWidth={1.5}
            aria-hidden="true"
            className="mx-auto mb-3"
            style={{ color: "var(--color-ink-muted)" }}
          />
          <p
            className="text-body font-medium"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("audit_log.no_permission")}
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-pos-xl pt-pos-lg pb-pos-md shrink-0">
        <div className="flex items-center gap-pos-md">
          <div>
            <h1
              className="pos-page-title"
              style={{ color: "var(--color-ink)" }}
            >
              {t("audit_log.title")}
            </h1>
            <p
              className="text-caption mt-0.5"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("audit_log.subtitle")}
            </p>
          </div>
          {!isLoading &&
            (categoryFilter.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 text-caption font-medium font-data px-2 py-0.5 rounded-sm"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
                  color: "var(--color-pharma)",
                }}
              >
                {t("audit_log.filtered_count", {
                  visible: visibleCount,
                  total,
                })}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-caption font-medium font-data px-2 py-0.5 rounded-sm"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
                  color: "var(--color-pharma)",
                }}
              >
                {total === 1
                  ? t("audit_log.event_count", { count: total })
                  : t("audit_log.event_count_plural", { count: total })}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-pos-sm">
          <button
            type="button"
            onClick={fetchLogs}
            className="pos-button pos-button-secondary text-caption flex items-center gap-1"
            aria-label={t("common.refresh")}
          >
            <RefreshCwIcon size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t("common.refresh")}</span>
          </button>
        </div>
      </div>

      {/* ── Server error banner (local data still shown) ── */}
      {serverError && !isLoading && (
        <div
          className="mx-pos-xl mb-pos-sm p-2 rounded-sm flex items-center gap-2 shrink-0"
          style={{
            backgroundColor: "color-mix(in srgb, #D32F2F 8%, transparent)",
            border: "1px solid color-mix(in srgb, #D32F2F 25%, transparent)",
          }}
          role="status"
        >
          <AlertTriangleIcon
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: "#D32F2F" }}
          />
          <span className="text-caption" style={{ color: "var(--color-ink)" }}>
            {t("audit_log.server_error")}
          </span>
        </div>
      )}

      {/* ── Filters ── */}
      <div
        className="flex items-center gap-pos-sm px-pos-xl pb-pos-md shrink-0 flex-wrap"
        role="search"
        aria-label={t("audit_log.title")}
      >
        <FilterIcon
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: "var(--color-ink-muted)" }}
        />
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setPage(0);
          }}
          className="pos-input text-caption"
          style={{ maxWidth: 200, width: "auto" }}
          aria-label={t("audit_log.event")}
        >
          <option value="">{t("audit_log.all_events")}</option>
          {/* Group the flat registry by module so the list is scannable
              without forcing a module selection first. */}
          {(() => {
            const moduleLabel = (module: string) =>
              t(
                MODULE_OPTIONS.find((m) => m.value === module)?.labelKey ??
                  "audit_log.module_fiscal",
              );
            const grouped = new Map<string, AuditEventConfig[]>();
            for (const opt of filteredEventOptions) {
              const key = opt.module ?? "";
              const group = grouped.get(key) ?? [];
              group.push(opt);
              grouped.set(key, group);
            }
            return Array.from(grouped.entries()).map(([module, opts]) => (
              <optgroup key={module || "default"} label={moduleLabel(module)}>
                {opts.map((opt) => (
                  <option key={opt.action} value={opt.action}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </optgroup>
            ));
          })()}
        </select>

        <select
          value={moduleFilter}
          onChange={(e) => {
            setModuleFilter(e.target.value);
            setEventFilter("");
            setPage(0);
          }}
          className="pos-input text-caption"
          style={{ maxWidth: 160, width: "auto" }}
          aria-label={t("audit_log.module")}
        >
          <option value="">{t("audit_log.all_events")}</option>
          {MODULE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <CalendarIcon
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: "var(--color-ink-muted)" }}
          />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(0);
            }}
            className="pos-input text-caption"
            style={{ maxWidth: 140, width: "auto" }}
            aria-label={t("audit_log.from_date")}
          />
          <span
            className="text-caption"
            style={{ color: "var(--color-ink-muted)" }}
          >
            —
          </span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(0);
            }}
            className="pos-input text-caption"
            style={{ maxWidth: 140, width: "auto" }}
            aria-label={t("audit_log.to_date")}
          />
        </div>

        {/* ── Pending-sync quick filter (local-only watermark) ── */}
        <label
          className="inline-flex items-center gap-1.5 text-caption cursor-pointer select-none"
          style={{
            color:
              syncFilter === "pending"
                ? "var(--color-pharma)"
                : "var(--color-ink-muted)",
          }}
        >
          <input
            type="checkbox"
            checked={syncFilter === "pending"}
            onChange={(e) => {
              setSyncFilter(e.target.checked ? "pending" : "");
              setPage(0);
            }}
            className="accent-[var(--color-pharma)]"
          />
          <ClockIcon size={12} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("audit_log.filter_pending_sync")}</span>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="pos-button pos-button-secondary text-caption flex items-center gap-1 px-2 py-1"
            aria-label={t("audit_log.clear_filters")}
          >
            <XIcon size={12} strokeWidth={1.5} aria-hidden="true" />
            <span>{t("audit_log.clear_filters")}</span>
          </button>
        )}
      </div>

      {/* ── Category chips — self-documenting legend that filters ── */}
      {categoryCounts.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-pos-xs px-pos-xl pb-pos-md shrink-0"
          role="group"
          aria-label={t("audit_log.category_legend")}
        >
          {categoryCounts.map(([category, count]) => {
            const active = visibleCategorySet.has(category);
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                className="inline-flex items-center gap-pos-xs rounded-full py-pos-xs px-pos-sm text-caption transition-opacity"
                aria-pressed={active}
                style={{
                  border:
                    "1px solid color-mix(in srgb, var(--color-ink) 12%, transparent)",
                  backgroundColor: active
                    ? "var(--color-panel)"
                    : "transparent",
                  color: active ? "var(--color-ink)" : "var(--color-ink-muted)",
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: CATEGORY_META[category]?.color,
                    opacity: visibleCategorySet.size === 0 || active ? 1 : 0.3,
                  }}
                  aria-hidden="true"
                />
                {t(
                  CATEGORY_KEYS[category] ?? `audit_log.category_${category}`,
                  category,
                )}
                <span
                  className="font-data"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Divider ── */}
      <hr className="pos-divider mx-pos-xl shrink-0" />

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex-1 overflow-y-auto px-pos-xl py-pos-md space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-pos-md px-pos-xl">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-full"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-ink) 6%, transparent)",
            }}
          >
            <SearchXIcon
              size={28}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: "var(--color-ink-muted)" }}
            />
          </div>
          <div className="text-center">
            <p
              className="text-body font-medium"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {hasActiveFilters
                ? t("audit_log.no_events_filtered")
                : t("audit_log.no_events")}
            </p>
            <p
              className="text-caption mt-1"
              style={{
                color: "color-mix(in srgb, var(--color-ink) 40%, transparent)",
              }}
            >
              {t("audit_log.no_events_hint")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-pos-xl py-pos-md">
          {dayGroups.map((group) => {
            const visibleLogs = group.logs.filter(isVisibleCategory);

            // Per-day stacked bar over ALL of the day's loaded events;
            // filtered-out categories stay visible but receded.
            const dayStats = new Map<EventCategory, number>();
            for (const log of group.logs) {
              const category = getEventConfig(log.action).category;
              dayStats.set(category, (dayStats.get(category) ?? 0) + 1);
            }
            const barSegments = Array.from(dayStats.entries()).sort(
              (a, b) => b[1] - a[1],
            );

            return (
              <section key={group.dateKey} className="mb-pos-lg">
                <div
                  className="sticky top-0 z-10 flex items-center gap-pos-sm mb-pos-sm py-pos-xs"
                  style={{ backgroundColor: "var(--color-surface)" }}
                >
                  <h2
                    className="text-caption font-semibold uppercase tracking-wider shrink-0"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    {group.label}
                  </h2>
                  {barSegments.length > 0 && (
                    <div
                      className="flex-1 flex h-1.5 overflow-hidden rounded-full"
                      style={{ gap: 1 }}
                      aria-hidden="true"
                    >
                      {barSegments.map(([category, count]) => {
                        const receded =
                          visibleCategorySet.size > 0 &&
                          !visibleCategorySet.has(category);
                        return (
                          <span
                            key={category}
                            style={{
                              flexGrow: count,
                              backgroundColor: CATEGORY_META[category]?.color,
                              opacity: receded ? 0.25 : 0.85,
                              transition: "opacity 0.15s",
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                  <span
                    className="text-caption font-data shrink-0"
                    style={{
                      color:
                        "color-mix(in srgb, var(--color-ink) 35%, transparent)",
                    }}
                  >
                    {group.logs.length === 1
                      ? t("audit_log.event_count", {
                          count: group.logs.length,
                        })
                      : t("audit_log.event_count_plural", {
                          count: group.logs.length,
                        })}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {visibleLogs.map((log) => (
                    <AuditEventCard key={log.id} log={log} />
                  ))}
                </div>
                {visibleLogs.length === 0 && group.logs.length > 0 && (
                  <p
                    className="text-caption"
                    style={{ color: "var(--color-ink-muted)" }}
                  >
                    {t("audit_log.day_all_filtered")}
                  </p>
                )}
              </section>
            );
          })}

          {/* ── Load more — replaces the pager that broke the timeline ── */}
          {!isLoading && logs.length < total && (
            <div className="flex flex-col items-center gap-1 pb-pos-lg pt-pos-sm">
              <button
                type="button"
                onClick={loadMore}
                className="pos-button pos-button-secondary text-caption px-pos-md"
              >
                {t("audit_log.load_more")}
              </button>
              <span
                className="text-caption font-data"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {t("audit_log.showing", { count: logs.length, total })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
