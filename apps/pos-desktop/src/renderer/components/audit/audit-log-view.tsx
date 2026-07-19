/**
 * Audit log view — timeline of audit events grouped by day.
 *
 * Manager/owner only. Shows filtered, paginated audit events as timeline
 * cards with colored category indicators, human-readable detail summaries,
 * and expandable JSON. Replaces the old flat-table audit view.
 *
 * Design per design-system.md: Audit — Timeline View section.
 */
import { type FC, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Calendar, SearchX } from 'lucide-react';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../../domain/auth/auth.service';
import { getLocalAuditEntries } from '../../../domain/audit/audit.service';
import { getLocalDatabase } from '../../../infrastructure/local-database';
import { API_BASE_URL } from '@infra/config';
import { RoleType } from '@pharmacy/shared-types';
import { AuditEventCard, type AuditLogEntry } from './audit-event-card';
import { EVENT_FILTER_OPTIONS } from './audit-event-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogResponse {
  rows?: AuditLogEntry[];
  total?: number;
}

// ---------------------------------------------------------------------------
// Day grouping
// ---------------------------------------------------------------------------

interface DayGroup {
  label: string;
  dateKey: string; // YYYY-MM-DD for keying
  logs: AuditLogEntry[];
}

function groupByDay(logs: AuditLogEntry[], t: (key: string, opts?: Record<string, unknown>) => string): DayGroup[] {
  const groups = new Map<string, AuditLogEntry[]>();

  for (const log of logs) {
    const d = new Date(log.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
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

  // Sort by date descending
  groupsArray.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  return groupsArray;
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
  const pageSize = 50;

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      if (moduleFilter === 'INVENTORY') {
        const { prisma } = await getLocalDatabase();
        const result = await getLocalAuditEntries(prisma as any, {
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          limit: pageSize,
          offset: page * pageSize,
        });
        setLogs(result.rows);
        setTotal(result.total);
      } else {
        const result: AuditLogResponse = await authService.getAuditLogs({
          event: eventFilter || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          limit: pageSize,
          offset: page * pageSize,
        });
        setLogs(result.rows ?? []);
        setTotal(result.total ?? 0);
      }
    } catch {
      // Silently handle
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

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p style={{ color: 'var(--color-ink-muted)' }}>
          {t('audit_log.no_permission')}
        </p>
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
          <h1
            className="pos-page-title"
            style={{ color: 'var(--color-ink)' }}
          >
            {t('audit_log.title')}
          </h1>
          {!isLoading && (
            <span
              className="text-caption font-medium"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {total === 1
                ? t('audit_log.event_count', { count: total })
                : t('audit_log.event_count_plural', { count: total })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchLogs}
          className="pos-button pos-button-secondary text-caption flex items-center gap-pos-xs"
          aria-label={t('common.refresh')}
        >
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      {/* ── Filters ── */}
      <div
        className="flex items-center gap-pos-sm px-pos-xl pb-pos-md shrink-0 flex-wrap"
        role="search"
        aria-label={t('audit_log.title')}
      >
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setPage(0);
          }}
          className="pos-input"
          style={{ maxWidth: 200, width: 'auto' }}
          aria-label={t('audit_log.event')}
        >
          <option value="">{t('audit_log.all_events')}</option>
          {EVENT_FILTER_OPTIONS.map((opt) => (
            <option key={opt.action} value={opt.action}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>

        <select
          value={moduleFilter}
          onChange={(e) => {
            setModuleFilter(e.target.value);
            setPage(0);
          }}
          className="pos-input"
          style={{ maxWidth: 160, width: 'auto' }}
          aria-label={t('audit_log.module')}
        >
          <option value="">{t('audit_log.all_events')}</option>
          <option value="AUTH_USERS">{t('audit_log.module_auth')}</option>
          <option value="INVENTORY">{t('audit_log.module_inventory')}</option>
        </select>

        <div className="flex items-center gap-pos-xs">
          <Calendar size={14} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(0);
            }}
            className="pos-input"
            style={{ maxWidth: 150, width: 'auto' }}
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
            className="pos-input"
            style={{ maxWidth: 150, width: 'auto' }}
            aria-label={t('audit_log.to_date')}
          />
        </div>
      </div>

      {/* ── Divider ── */}
      <hr className="pos-divider mx-pos-xl shrink-0" />

      {/* ── Content ── */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-ink-muted)' }}>
            {t('common.loading')}
          </p>
        </div>
      ) : logs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-pos-md">
          <SearchX size={40} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--color-ink-muted)' }} />
          <p className="text-body font-medium" style={{ color: 'var(--color-ink-muted)' }}>
            {t('audit_log.no_events_filtered')}
          </p>
          <p className="text-caption" style={{ color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)' }}>
            {t('audit_log.no_events_hint')}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-pos-xl py-pos-md">
          {/* ── Day groups ── */}
          {dayGroups.map((group) => (
            <section key={group.dateKey} className="mb-pos-lg">
              {/* Day header */}
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
                  className="text-caption"
                  style={{ color: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }}
                >
                  {group.logs.length === 1
                    ? t('audit_log.event_count', { count: group.logs.length })
                    : t('audit_log.event_count_plural', { count: group.logs.length })}
                </span>
              </div>

              {/* Event cards */}
              <div className="flex flex-col gap-pos-xs">
                {group.logs.map((log) => (
                  <AuditEventCard key={log.id} log={log} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {total > pageSize && (
        <div
          className="flex items-center justify-between px-pos-xl py-pos-sm shrink-0"
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
        >
          <span className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
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
              className="text-caption font-medium px-pos-sm"
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
