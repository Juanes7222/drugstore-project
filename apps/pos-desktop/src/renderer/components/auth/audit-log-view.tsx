/**
 * Audit log view (manager/owner only).
 *
 * Paginated list of audit events with filter by event type, user, date range.
 * Each event shows: timestamp, actor, action, target, details.
 * Sensitive events are highlighted.
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../../domain/auth/auth.service';
import { API_BASE_URL } from '@infra/config';
import { RoleType } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogEntry {
  id: string;
  action: string;
  createdAt: string;
  userId?: string;
  userRole?: string | null;
  entityType?: string;
  entityId?: string;
  details?: string | null;
}

interface AuditLogResponse {
  rows?: AuditLogEntry[];
  total?: number;
}

const SENSITIVE_EVENTS: ReadonlySet<string> = new Set([
  'STEP_UP_AUTHORIZED',
  'USER_ROLE_CHANGED',
  'AUTH_PIN_RESET',
  'SESSION_REVOKED',
]);

const AUDIT_EVENT_KEYS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: '', labelKey: 'audit_log.all_events' },
  { value: 'AUTH_LOGIN_SUCCESS', labelKey: 'audit_events.AUTH_LOGIN_SUCCESS' },
  { value: 'AUTH_LOGIN_FAILURE', labelKey: 'audit_events.AUTH_LOGIN_FAILURE' },
  { value: 'AUTH_LOGOUT', labelKey: 'audit_events.AUTH_LOGOUT' },
  { value: 'USER_CREATED', labelKey: 'audit_events.USER_CREATED' },
  { value: 'USER_DISABLED', labelKey: 'audit_events.USER_DISABLED' },
  { value: 'USER_ROLE_CHANGED', labelKey: 'audit_events.USER_ROLE_CHANGED' },
  { value: 'SESSION_REVOKED', labelKey: 'audit_events.SESSION_REVOKED' },
  { value: 'STEP_UP_AUTHORIZED', labelKey: 'audit_events.STEP_UP_AUTHORIZED' },
  { value: 'AUTH_PASSWORD_CHANGED', labelKey: 'audit_events.AUTH_PASSWORD_CHANGED' },
  { value: 'AUTH_PIN_RESET', labelKey: 'audit_events.AUTH_PIN_RESET' },
  { value: 'ACCOUNT_LOCKED', labelKey: 'audit_events.ACCOUNT_LOCKED' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function parseDetails(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
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
      const result: AuditLogResponse = await authService.getAuditLogs({
        event: eventFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setLogs(result.rows ?? []);
      setTotal(result.total ?? 0);
    } catch {
      // Silently handle
    } finally {
      setIsLoading(false);
    }
  }, [authService, eventFilter, fromDate, toDate, page]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // ------------------------------------------------------------------
  // Derived
  // ------------------------------------------------------------------

  const totalPages = Math.ceil(total / pageSize);

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
      className="flex h-full flex-col p-pos-md"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('audit_log.title')}
        </h1>
        <button
          type="button"
          onClick={fetchLogs}
          className="pos-button pos-button--ghost"
        >
          {t('common.refresh')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select
          value={eventFilter}
          onChange={(e) => {
            setEventFilter(e.target.value);
            setPage(0);
          }}
          className="pos-input"
          style={{ maxWidth: 200 }}
          aria-label={t('audit_log.event')}
        >
          {AUDIT_EVENT_KEYS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(0);
          }}
          className="pos-input"
          style={{ maxWidth: 160 }}
          aria-label={t('audit_log.from_date')}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(0);
          }}
          className="pos-input"
          style={{ maxWidth: 160 }}
          aria-label={t('audit_log.to_date')}
        />
      </div>

      {/* Logs table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-ink-muted)' }}>
            {t('common.loading')}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table
            className="w-full"
            style={{
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-ink-muted)',
                  textAlign: 'left',
                }}
              >
                <th className="p-2">{t('audit_log.timestamp')}</th>
                <th className="p-2">{t('audit_log.event')}</th>
                <th className="p-2">{t('audit_log.actor')}</th>
                <th className="p-2">{t('audit_log.target')}</th>
                <th className="p-2">{t('audit_log.details')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const details = parseDetails(log.details);
                const isSensitive = SENSITIVE_EVENTS.has(log.action);

                return (
                  <tr
                    key={log.id}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      backgroundColor: isSensitive
                        ? 'rgba(255, 193, 7, 0.05)'
                        : 'transparent',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface-variant)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = isSensitive
                        ? 'rgba(255, 193, 7, 0.05)'
                        : 'transparent')
                    }
                  >
                    <td
                      className="p-2 whitespace-nowrap"
                      style={{ color: 'var(--color-ink-muted)' }}
                    >
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="p-2">
                      <span
                        className="text-sm"
                        style={{
                          color: isSensitive
                            ? 'var(--color-warning)'
                            : 'var(--color-ink)',
                          fontWeight: isSensitive ? 600 : 400,
                        }}
                      >
                        {t(`audit_events.${log.action}`, log.action)}
                      </span>
                    </td>
                    <td
                      className="p-2"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {log.userRole ?? log.userId?.slice(0, 8) ?? '—'}
                    </td>
                    <td
                      className="p-2"
                      style={{ color: 'var(--color-ink-muted)' }}
                    >
                      {log.entityType}:{log.entityId?.slice(0, 8) ?? '—'}
                    </td>
                    <td
                      className="p-2 text-xs"
                      style={{
                        color: 'var(--color-ink-muted)',
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={details}
                    >
                      {details || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {logs.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <p style={{ color: 'var(--color-ink-muted)' }}>
                {t('audit_log.no_events')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      <div
        className="mt-2 flex items-center justify-between"
        style={{ color: 'var(--color-ink-muted)', fontSize: 13 }}
      >
        <span>
          {total === 1
            ? t('audit_log.event_count', { count: total })
            : t('audit_log.event_count_plural', { count: total })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="pos-button pos-button--ghost text-xs px-2 py-1"
          >
            {t('common.previous')}
          </button>
          <span className="px-2 py-1">
            {page + 1} / {totalPages || 1}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="pos-button pos-button--ghost text-xs px-2 py-1"
          >
            {t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
};
