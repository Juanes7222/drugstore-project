/**
 * Single audit event rendered as a timeline card.
 *
 * Card shows: category-colored left border, event-type icon + translated name,
 * actor role badge, human-readable detail summary parsed from JSON (raw JSON
 * hidden behind an expand toggle), and a relative timestamp.
 *
 * Event config (icon, category, color) is sourced from audit-event-registry.ts —
 * adding a new event type requires only a config entry there, not changes here.
 *
 * Designed per the Audit — Timeline View section of design-system.md.
 */
import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import {
  getEventConfig,
  getCategoryColor,
  getIsSensitive,
  resolveIcon,
  CATEGORY_META,
} from './audit-event-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  action: string;
  createdAt: string;
  userId?: string;
  userRole?: string | null;
  entityType?: string;
  entityId?: string;
  details?: string | null;
  productName?: string;
  lotBatch?: string;
}

interface AuditEventCardProps {
  log: AuditLogEntry;
}

// ---------------------------------------------------------------------------
// Detail parser — turns JSON into human-readable fragment array
// ---------------------------------------------------------------------------

interface DetailFragment {
  key: string;
  value: string;
}

/** Parse known fields into human-readable fragments (summary — 2-3 most important). */
function parseDetailFragments(
  details: string | null | undefined,
  log: AuditLogEntry,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DetailFragment[] {
  const fragments: DetailFragment[] = [];

  if (!details) {
    return fragments;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    fragments.push({ key: 'raw', value: details });
    return fragments;
  }

  // Auth / access common fields
  if (parsed.sessionLimit !== undefined) {
    fragments.push({
      key: 'session_limit',
      value: t('audit_log.detail_session_limit', { count: parsed.sessionLimit as number }),
    });
  }
  if (parsed.offlineTokenIssued === true) {
    const expires = parsed.offlineTokenExpiresAt
      ? ' · ' +
        t('audit_log.detail_token_expires', {
          date: formatDateTime(parsed.offlineTokenExpiresAt as string),
        })
      : '';
    fragments.push({
      key: 'offline_token',
      value: t('audit_log.detail_offline_token') + expires,
    });
  }
  if (parsed.evictedSessionId) {
    fragments.push({
      key: 'evicted_session',
      value: t('audit_log.detail_evicted_session'),
    });
  }
  if (parsed.cvkVersion !== undefined) {
    fragments.push({
      key: 'cvk_version',
      value: t('audit_log.detail_cvk_version', {
        version: String(parsed.cvkVersion),
      }),
    });
  }
  if (parsed.expiresAt) {
    fragments.push({
      key: 'expires_at',
      value: t('audit_log.detail_expires_at', {
        date: formatDateTime(parsed.expiresAt as string),
      }),
    });
  }

  // Inventory fields
  if (parsed.quantity !== undefined && parsed.previousQuantity !== undefined) {
    fragments.push({
      key: 'quantity_from',
      value: t('audit_log.detail_quantity_from', {
        from: String(parsed.previousQuantity),
        to: String(parsed.quantity),
      }),
    });
  } else if (parsed.quantity !== undefined) {
    fragments.push({
      key: 'quantity',
      value: t('audit_log.detail_quantity_from', {
        from: '?',
        to: String(parsed.quantity),
      }),
    });
  }
  if (log.lotBatch) {
    fragments.push({
      key: 'lot_batch',
      value: t('audit_log.detail_lot_batch', { batch: log.lotBatch }),
    });
  }
  if (parsed.reason) {
    fragments.push({
      key: 'reason',
      value: t('audit_log.detail_reason', { reason: String(parsed.reason) }),
    });
  }
  if (parsed.amountCents !== undefined) {
    fragments.push({
      key: 'amount',
      value: t('audit_log.detail_amount', {
        amount: formatCurrency(parsed.amountCents as number),
      }),
    });
  }

  return fragments;
}

/**
 * Parse ALL fields from JSON details into human-readable fragments.
 * Used in the expanded detail panel — no raw JSON shown.
 * Unknown fields are rendered as generic "clave: valor" pairs.
 */
function parseAllDetailFragments(
  details: string | null | undefined,
  log: AuditLogEntry,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DetailFragment[] {
  const fragments: DetailFragment[] = [];

  if (!details) {
    return fragments;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    fragments.push({ key: 'raw', value: details });
    return fragments;
  }

  // Known fields with translations
  const knownKeys = new Set<string>();

  if (parsed.sessionLimit !== undefined) {
    knownKeys.add('sessionLimit');
    fragments.push({
      key: 'session_limit',
      value: t('audit_log.detail_session_limit', { count: parsed.sessionLimit as number }),
    });
  }
  if (parsed.offlineTokenIssued !== undefined) {
    knownKeys.add('offlineTokenIssued');
    if (parsed.offlineTokenIssued === true) {
      fragments.push({
        key: 'offline_token',
        value: t('audit_log.detail_offline_token'),
      });
    }
  }
  if (parsed.offlineTokenExpiresAt) {
    knownKeys.add('offlineTokenExpiresAt');
    fragments.push({
      key: 'offline_token_expires',
      value: t('audit_log.detail_token_expires', {
        date: formatDateTime(parsed.offlineTokenExpiresAt as string),
      }),
    });
  }
  if (parsed.evictedSessionId) {
    knownKeys.add('evictedSessionId');
    fragments.push({
      key: 'evicted_session',
      value: t('audit_log.detail_evicted_session'),
    });
  }
  if (parsed.cvkVersion !== undefined) {
    knownKeys.add('cvkVersion');
    fragments.push({
      key: 'cvk_version',
      value: t('audit_log.detail_cvk_version', {
        version: String(parsed.cvkVersion),
      }),
    });
  }
  if (parsed.expiresAt) {
    knownKeys.add('expiresAt');
    fragments.push({
      key: 'expires_at',
      value: t('audit_log.detail_expires_at', {
        date: formatDateTime(parsed.expiresAt as string),
      }),
    });
  }
  if (parsed.quantity !== undefined) {
    knownKeys.add('quantity');
    if (parsed.previousQuantity !== undefined) {
      knownKeys.add('previousQuantity');
      fragments.push({
        key: 'quantity_from',
        value: t('audit_log.detail_quantity_from', {
          from: String(parsed.previousQuantity),
          to: String(parsed.quantity),
        }),
      });
    } else {
      fragments.push({
        key: 'quantity',
        value: `${String(parsed.quantity)}`,
      });
    }
  }
  if (log.lotBatch) {
    fragments.push({
      key: 'lot_batch',
      value: t('audit_log.detail_lot_batch', { batch: log.lotBatch }),
    });
  }
  if (parsed.reason) {
    knownKeys.add('reason');
    fragments.push({
      key: 'reason',
      value: t('audit_log.detail_reason', { reason: String(parsed.reason) }),
    });
  }
  if (parsed.amountCents !== undefined) {
    knownKeys.add('amountCents');
    fragments.push({
      key: 'amount',
      value: t('audit_log.detail_amount', {
        amount: formatCurrency(parsed.amountCents as number),
      }),
    });
  }

  // Remaining unknown fields — show as generic key:value
  for (const [key, value] of Object.entries(parsed)) {
    if (!knownKeys.has(key)) {
      const displayValue =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? formatDateTime(value)
          : String(value);
      fragments.push({ key: `_${key}`, value: `${key}: ${displayValue}` });
    }
  }

  return fragments;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Format ISO date as "dd/mm/aaaa h:mm a" (human-readable, non-technical). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const amPm = hours >= 12 ? 'p. m.' : 'a. m.';
  const hour12 = hours % 12 || 12;
  return `${day}/${month}/${year} ${hour12}:${minutes} ${amPm}`;
}

function formatRelativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) {
    return formatShortDate(iso);
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return t('audit_log.now');
  }
  if (minutes < 60) {
    return t('audit_log.minutes_ago', { count: minutes });
  }
  if (hours < 24) {
    return t('audit_log.hours_ago', { count: hours });
  }
  if (days < 7) {
    return t('audit_log.days_ago', { count: days });
  }

  // Older than a week — show date + time
  return formatShortDate(iso);
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** True if the target column would show only noise (unknown/empty). */
function isTargetMeaningless(log: AuditLogEntry): boolean {
  if (!log.entityType && !log.entityId && !log.productName) {
    return true;
  }
  if (log.entityType === 'unknown' && log.entityId === 'unknown') {
    return true;
  }
  if (log.entityType === 'unknown' && !log.entityId) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AuditEventCard: FC<AuditEventCardProps> = ({ log }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const config = getEventConfig(log.action);
  const borderColor = getCategoryColor(log.action);
  const Icon = resolveIcon(config.icon);
  const fragments = parseDetailFragments(log.details, log, t);
  const showTarget = !isTargetMeaningless(log);
  const isSensitive = getIsSensitive(log.action);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const sensitiveBg = CATEGORY_META[config.category].sensitive
    ? 'color-mix(in srgb, #5B3E96 4%, white)'
    : undefined;

  const cardStyle: React.CSSProperties = {
    borderLeft: `3px solid ${borderColor}`,
    backgroundColor: isSensitive ? sensitiveBg : 'var(--color-panel)',
  };

  return (
    <article
      className="pos-panel rounded-sm mb-pos-sm"
      style={cardStyle}
      aria-label={`${t(`audit_events.${log.action}`, log.action)} — ${formatAbsoluteTime(log.createdAt)}`}
    >
      {/* ── Row 1: Icon + Event name + Timestamp ── */}
      <div className="flex items-start justify-between px-pos-md pt-pos-sm">
        <div className="flex items-center gap-pos-sm min-w-0">
          <Icon
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{ color: borderColor, flexShrink: 0 }}
          />
          <span
            className="text-body font-semibold truncate"
            style={{ color: 'var(--color-ink)' }}
          >
            {t(`audit_events.${log.action}`, log.action)}
          </span>
        </div>
        <time
          className="text-caption whitespace-nowrap ml-pos-sm shrink-0"
          style={{ color: 'var(--color-ink-muted)' }}
          dateTime={log.createdAt}
          title={new Date(log.createdAt).toLocaleString('es-CO')}
        >
          {formatRelativeTime(log.createdAt, t)}
        </time>
      </div>

      {/* ── Row 2: Actor — username first, role badge second ── */}
      <div className="flex items-center gap-pos-xs px-pos-md pt-pos-xs">
        <span
          className="text-body-sm truncate max-w-[180px]"
          style={{ color: 'var(--color-ink)' }}
          title={log.userId ?? undefined}
        >
          {log.userId ?? '—'}
        </span>
        {log.userRole && (
          <span
            className="inline-flex items-center px-1 py-0.5 text-caption font-semibold uppercase tracking-wider rounded-sm shrink-0"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
              color: 'var(--color-ink-muted)',
            }}
          >
            {log.userRole}
          </span>
        )}
      </div>

      {/* ── Row 3: Detail summary ── */}
      {fragments.length > 0 && (
        <div className="px-pos-md pt-pos-xs pb-pos-xs">
          <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {fragments.map((f, i) => (
              <span key={f.key}>
                {i > 0 && (
                  <span className="mx-1" style={{ color: 'color-mix(in srgb, var(--color-ink) 20%, transparent)' }}>
                    ·
                  </span>
                )}
                {f.value}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* ── Row 4: Target (only if meaningful) ── */}
      {showTarget && (
        <div className="px-pos-md pb-pos-xs">
          <p className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
            {log.productName
              ? `${t('audit_log.target_product')}: ${log.productName}${log.lotBatch ? ` · ${t('audit_log.detail_lot_batch', { batch: log.lotBatch })}` : ''}`
              : `${t('audit_log.target_entity', { type: log.entityType })}: ${log.entityId?.slice(0, 12) ?? '—'}`}
          </p>
        </div>
      )}

      {/* ── Row 5: Expand toggle + human-readable details (no raw JSON) ── */}
      {log.details && (
        <div className="px-pos-md pb-pos-sm">
          <button
            type="button"
            onClick={toggleExpand}
            className="flex items-center gap-1 text-caption font-medium"
            style={{
              color: 'var(--color-pharma)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
            aria-expanded={expanded}
            aria-label={expanded ? t('audit_log.collapse_details') : t('audit_log.expand_details')}
          >
            {expanded ? (
              <EyeOff size={12} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Eye size={12} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{expanded ? t('audit_log.collapse_details') : t('audit_log.expand_details')}</span>
          </button>

          {expanded && (
            <div
              className="mt-pos-xs p-pos-sm rounded-sm flex flex-col gap-1"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-ink) 3%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
              }}
            >
              {parseAllDetailFragments(log.details, log, t).map((f) => (
                <span
                  key={f.key}
                  className="text-body-sm"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  {f.value}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
};


