/**
 * Audit log view — timeline of audit events grouped by day.
 *
 * Manager/owner only. Shows filtered, paginated audit events as timeline
 * cards with colored category indicators, human-readable detail summaries,
 * and expandable details. Replaces the old flat-table audit view.
 */
import { type FC, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Calendar,
  SearchX,
  X,
  Info,
  Filter,
} from 'lucide-react';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../../domain/auth/auth.service';
import { getLocalAuditEntries } from '../../../domain/audit/audit.service';
import { getLocalDatabase } from '../../../infrastructure/local-database';
import { API_BASE_URL } from '@infra/config';
import { RoleType } from '@pharmacy/shared-types';
import { AuditEventCard, type AuditLogEntry } from './audit-event-card';
import { EVENT_FILTER_OPTIONS, CATEGORY_META } from './audit-event-registry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'AUTH_USERS', labelKey: 'audit_log.module_auth' },
  { value: 'INVENTORY', labelKey: 'audit_log.module_inventory' },
  { value: 'CASH_SHIFT', labelKey: 'audit_log.module_cash_shift' },
  { value: 'SALES', labelKey: 'audit_log.module_sales' },
  { value: 'CLIENTS', labelKey: 'audit_log.module_clients' },
  { value: 'PRESCRIPTIONS', labelKey: 'audit_log.module_prescriptions' },
  { value: 'PURCHASES', labelKey: 'audit_log.module_purchases' },
  { value: 'FISCAL', labelKey: 'audit_log.module_fiscal' },
  { value: 'SYNC', labelKey: 'audit_log.module_sync' },
];

const CATEGORY_KEYS: Record<string, string> = {
  auth: 'audit_log.category_auth',
  failure: 'audit_log.category_failure',
  security: 'audit_log.category_security',
  users: 'audit_log.category_users',
  inventory: 'audit_log.category_inventory',
  network: 'audit_log.category_network',
  cashShift: 'audit_log.category_cashShift',
  sale: 'audit_log.category_sale',
  client: 'audit_log.category_client',
  prescription: 'audit_log.category_prescription',
  purchase: 'audit_log.category_purchase',
  fiscal: 'audit_log.category_fiscal',
  default: 'audit_log.category_default',
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
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

  const groupsArray: DayGroup[] = [];
  for (const [key, entries] of groups) {
    let label: string;
    if (key === todayKey) {
      label = t('audit_log.events_today');
    } else if (key === yesterdayKey) {
      label = t('audit_log.events_yesterday');
    } else {
      const d = new Date(key + 'T00:00:00');
      label = d.toLocaleDateString('es-CO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
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
        backgroundColor: 'var(--color-panel)',
        boxShadow: 'var(--shadow-pos-panel)',
        borderLeft: '3px solid color-mix(in srgb, var(--color-ink) 10%, transparent)',
      }}
    >
      <div className="px-3 pt-2 pb-3 space-y-2">
        <div className="flex justify-between">
          <div className="h-4 w-48 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }} />
          <div className="h-3 w-16 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }} />
        </div>
        <div className="h-3 w-32 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }} />
        <div className="h-3 w-64 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)' }} />
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

  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const pageSize = 50;

  // Whether any filter is active (for showing the clear button)
  const hasActiveFilters = eventFilter || moduleFilter || fromDate || toDate;

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const localModules = [
        'INVENTORY', 'CASH_SHIFT', 'SALES', 'CLIENTS',
        'PRESCRIPTIONS', 'PURCHASES', 'FISCAL', 'SYNC',
      ];

      const isAllModules = !moduleFilter;
      const isLocalModule = moduleFilter && localModules.includes(moduleFilter);
      const isServerModule = moduleFilter === 'AUTH_USERS';

      const localQuery = {
        action: eventFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: pageSize,
        offset: page * pageSize,
      };

      const localPromise =
        isAllModules || isLocalModule
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
        isAllModules || isServerModule
          ? authService.getAuditLogs(serverQuery)
          : null;

      if (isAllModules) {
        const [localRes, serverRes] = await Promise.all([
          localPromise!,
          serverPromise!,
        ]);
        const merged = [
          ...(localRes?.rows ?? []),
          ...(serverRes?.rows ?? []),
        ].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setLogs(merged.slice(0, pageSize));
        setTotal((localRes?.total ?? 0) + (serverRes?.total ?? 0));
      } else if (isLocalModule) {
        const result = await localPromise!;
        setLogs(result.rows);
        setTotal(result.total);
      } else {
        const result = await serverPromise!;
        setLogs(result.rows ?? []);
        setTotal(result.total ?? 0);
      }
    } catch (err) {
      console.error('[AuditLogView] fetchLogs error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authService, moduleFilter, eventFilter, fromDate, toDate, page]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // ------------------------------------------------------------------
  // Derived
  // ------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const dayGroups = useMemo(() => groupByDay(logs, t), [logs, t]);

  const filteredEventOptions = useMemo(
    () =>
      !moduleFilter
        ? EVENT_FILTER_OPTIONS
        : EVENT_FILTER_OPTIONS.filter((opt) => opt.module === moduleFilter),
    [moduleFilter],
  );

  const clearFilters = useCallback(() => {
    setEventFilter('');
    setModuleFilter('');
    setFromDate('');
    setToDate('');
    setPage(0);
  }, []);

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center max-w-sm">
          <Info size={40} strokeWidth={1.5} aria-hidden="true" className="mx-auto mb-3" style={{ color: 'var(--color-ink-muted)' }} />
          <p className="text-body font-medium" style={{ color: 'var(--color-ink-muted)' }}>
            {t('audit_log.no_permission')}
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
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* ── Header bar ── */}
      <div className="flex items-center justify-between px-pos-xl pt-pos-lg pb-pos-md shrink-0">
        <div className="flex items-center gap-pos-md">
          <div>
            <h1 className="pos-page-title" style={{ color: 'var(--color-ink)' }}>
              {t('audit_log.title')}
            </h1>
            <p className="text-caption mt-0.5" style={{ color: 'var(--color-ink-muted)' }}>
              {t('audit_log.subtitle')}
            </p>
          </div>
          {!isLoading && (
            <span
              className="inline-flex items-center gap-1 text-caption font-medium font-data px-2 py-0.5 rounded-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-pharma) 10%, transparent)',
                color: 'var(--color-pharma)',
              }}
            >
              {total === 1
                ? t('audit_log.event_count', { count: total })
                : t('audit_log.event_count_plural', { count: total })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-pos-sm">
          <button
            type="button"
            onClick={() => setShowLegend(!showLegend)}
            className="pos-button pos-button-secondary text-caption flex items-center gap-1"
            aria-label={t('audit_log.category_legend')}
            title={t('audit_log.category_legend')}
          >
            <Info size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={fetchLogs}
            className="pos-button pos-button-secondary text-caption flex items-center gap-1"
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* ── Category Legend ── */}
      {showLegend && (
        <div
          className="mx-pos-xl mb-pos-sm p-3 rounded-sm flex flex-wrap gap-x-4 gap-y-1.5 shrink-0"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
          role="region"
          aria-label={t('audit_log.category_legend')}
        >
          <span className="text-caption font-semibold w-full mb-1" style={{ color: 'var(--color-ink-muted)' }}>
            {t('audit_log.category_legend')}
          </span>
          {Object.entries(CATEGORY_META).map(([category, meta]) => (
            <span key={category} className="inline-flex items-center gap-1.5 text-caption" style={{ color: 'var(--color-ink-muted)' }}>
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: meta.color }}
                aria-hidden="true"
              />
              {t(CATEGORY_KEYS[category] ?? `audit_log.category_${category}`, category)}
            </span>
          ))}
        </div>
      )}

      {/* ── Filters ── */}
      <div
        className="flex items-center gap-pos-sm px-pos-xl pb-pos-md shrink-0 flex-wrap"
        role="search"
        aria-label={t('audit_log.title')}
      >
        <Filter size={14} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setPage(0);
          }}
          className="pos-input text-caption"
          style={{ maxWidth: 200, width: 'auto' }}
          aria-label={t('audit_log.event')}
        >
          <option value="">{t('audit_log.all_events')}</option>
          {filteredEventOptions.map((opt) => (
            <option key={opt.action} value={opt.action}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        <select
          value={moduleFilter}
          onChange={(e) => {
            setModuleFilter(e.target.value);
            setEventFilter('');
            setPage(0);
          }}
          className="pos-input text-caption"
          style={{ maxWidth: 160, width: 'auto' }}
          aria-label={t('audit_log.module')}
        >
          <option value="">{t('audit_log.all_events')}</option>
          {MODULE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <Calendar size={14} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(0);
            }}
            className="pos-input text-caption"
            style={{ maxWidth: 140, width: 'auto' }}
            aria-label={t('audit_log.from_date')}
          />
          <span className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
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
            style={{ maxWidth: 140, width: 'auto' }}
            aria-label={t('audit_log.to_date')}
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="pos-button pos-button-secondary text-caption flex items-center gap-1 px-2 py-1"
            aria-label={t('audit_log.clear_filters')}
          >
            <X size={12} strokeWidth={1.5} aria-hidden="true" />
            <span>{t('audit_log.clear_filters')}</span>
          </button>
        )}
      </div>

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
              backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
            }}
          >
            <SearchX size={28} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          </div>
          <div className="text-center">
            <p className="text-body font-medium" style={{ color: 'var(--color-ink-muted)' }}>
              {hasActiveFilters
                ? t('audit_log.no_events_filtered')
                : t('audit_log.no_events')}
            </p>
            <p className="text-caption mt-1" style={{ color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}>
              {t('audit_log.no_events_hint')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-pos-xl py-pos-md">
          {dayGroups.map((group) => (
            <section key={group.dateKey} className="mb-pos-lg">
              <div className="flex items-center gap-pos-sm mb-pos-sm">
                <h2
                  className="text-caption font-semibold uppercase tracking-wider shrink-0"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  {group.label}
                </h2>
                <div
                  className="flex-1 h-px"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)' }}
                />
                <span
                  className="text-caption font-data"
                  style={{ color: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }}
                >
                  {group.logs.length === 1
                    ? t('audit_log.event_count', { count: group.logs.length })
                    : t('audit_log.event_count_plural', { count: group.logs.length })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {group.logs.map((log) => (
                  <AuditEventCard key={log.id} log={log} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {total > pageSize && !isLoading && (
        <div
          className="flex items-center justify-between px-pos-xl py-pos-sm shrink-0"
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
        >
          <span className="text-caption font-data" style={{ color: 'var(--color-ink-muted)' }}>
            {t('audit_log.showing', { count: Math.min(pageSize, total), total })}
          </span>

          <nav className="flex items-center gap-pos-sm" aria-label={t('audit_log.page_label')}>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="pos-button pos-button-secondary text-caption px-pos-sm py-pos-xs"
              aria-label={t('audit_log.page_previous')}
            >
              {t('audit_log.page_previous')}
            </button>
            <span
              className="text-caption font-medium font-data px-pos-sm"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('audit_log.page_of', { current: page + 1, total: totalPages })}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="pos-button pos-button-secondary text-caption px-pos-sm py-pos-xs"
              aria-label={t('audit_log.page_next')}
            >
              {t('audit_log.page_next')}
            </button>
          </nav>
        </div>
      )}
    </div>
  );
};
