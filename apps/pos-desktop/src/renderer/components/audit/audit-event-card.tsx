/**
 * Single audit event rendered as a timeline card.
 *
 * Card shows: category-colored left border, event-type icon + translated name,
 * actor with translated role badge, human-readable detail summary, and a
 * relative timestamp. Expanded panel shows all parsed fields — never raw JSON.
 *
 * Event config (icon, category, color) is sourced from audit-event-registry.ts.
 */
import { type FC, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  getEventConfig,
  getCategoryColor,
  getIsSensitive,
  resolveIcon,
} from './audit-event-registry';
import { translateRole } from '@/components/auth/user-management.helpers';

// ---------------------------------------------------------------------------
// Module → i18n key mapping
// ---------------------------------------------------------------------------

const MODULE_I18N_KEY: Record<string, string> = {
  AUTH_USERS: 'audit_log.module_auth',
  INVENTORY: 'audit_log.module_inventory',
  CASH_SHIFT: 'audit_log.module_cash_shift',
  CLIENTS: 'audit_log.module_clients',
  FISCAL: 'audit_log.module_fiscal',
  PRESCRIPTIONS: 'audit_log.module_prescriptions',
  PURCHASES: 'audit_log.module_purchases',
  SALES: 'audit_log.module_sales',
  SYNC: 'audit_log.module_sync',
};

// ---------------------------------------------------------------------------
// Entity type → i18n key mapping
// ---------------------------------------------------------------------------

const ENTITY_TYPE_I18N_KEY: Record<string, string> = {
  CashShift: 'audit_log.entity_cash_shift',
  user: 'audit_log.target_user',
  user_admin: 'audit_log.entity_admin_user',
  Product: 'audit_log.target_product',
  Sale: 'audit_log.entity_sale',
  Client: 'audit_log.entity_client',
  Prescription: 'audit_log.entity_prescription',
  Purchase: 'audit_log.entity_purchase',
  Supplier: 'audit_log.entity_supplier',
  InventoryAdjustment: 'audit_log.entity_inventory_adjustment',
  FiscalDocument: 'audit_log.entity_fiscal_document',
  SyncOperation: 'audit_log.entity_sync_operation',
};

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
// Formatting helpers
// ---------------------------------------------------------------------------

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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

function formatRelativeTime(
  iso: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return formatShortDate(iso);

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return t('audit_log.now');
  if (minutes < 60) return t('audit_log.minutes_ago', { count: minutes });
  if (hours < 24) return t('audit_log.hours_ago', { count: hours });
  if (days < 7) return t('audit_log.days_ago', { count: days });

  return formatShortDate(iso);
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function isTargetMeaningless(log: AuditLogEntry): boolean {
  if (!log.entityType && !log.entityId && !log.productName) return true;
  if (log.entityType === 'unknown' && log.entityId === 'unknown') return true;
  if (log.entityType === 'unknown' && !log.entityId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Detail parsers
// ---------------------------------------------------------------------------

interface DetailFragment {
  key: string;
  value: string;
}

/** Return the 2-3 most important fields for the summary preview. */
function parseSummaryFragments(
  details: string | null | undefined,
  log: AuditLogEntry,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DetailFragment[] {
  const fragments: DetailFragment[] = [];

  if (!details) return fragments;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    fragments.push({ key: 'raw', value: details });
    return fragments;
  }

  if (parsed.sessionLimit !== undefined) {
    fragments.push({
      key: 'session_limit',
      value: t('audit_log.detail_session_limit', {
        count: parsed.sessionLimit as number,
      }),
    });
  }
  if (parsed.offlineTokenIssued === true) {
    const expires = parsed.offlineTokenExpiresAt
      ? ` · ${t('audit_log.detail_token_expires', { date: formatDateTime(parsed.offlineTokenExpiresAt as string) })}`
      : '';
    fragments.push({
      key: 'offline_token',
      value: t('audit_log.detail_offline_token') + expires,
    });
  }
  if (parsed.evictedSessionId) {
    fragments.push({ key: 'evicted_session', value: t('audit_log.detail_evicted_session') });
  }
  if (parsed.cvkVersion !== undefined) {
    fragments.push({
      key: 'cvk_version',
      value: t('audit_log.detail_cvk_version', { version: String(parsed.cvkVersion) }),
    });
  }
  if (parsed.expiresAt) {
    fragments.push({
      key: 'expires_at',
      value: t('audit_log.detail_expires_at', { date: formatDateTime(parsed.expiresAt as string) }),
    });
  }
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
      value: t('audit_log.detail_amount', { amount: formatCurrency(parsed.amountCents as number) }),
    });
  }

  return fragments;
}

/** Parse ALL fields from JSON into human-readable pairs. */
function parseAllDetailFragments(
  details: string | null | undefined,
  log: AuditLogEntry,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DetailFragment[] {
  const fragments: DetailFragment[] = [];

  if (!details) return fragments;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    fragments.push({ key: 'raw', value: details });
    return fragments;
  }

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
      fragments.push({ key: 'offline_token', value: t('audit_log.detail_offline_token') });
    }
  }
  if (parsed.offlineTokenExpiresAt) {
    knownKeys.add('offlineTokenExpiresAt');
    fragments.push({
      key: 'offline_token_expires',
      value: t('audit_log.detail_token_expires', { date: formatDateTime(parsed.offlineTokenExpiresAt as string) }),
    });
  }
  if (parsed.evictedSessionId) {
    knownKeys.add('evictedSessionId');
    fragments.push({ key: 'evicted_session', value: t('audit_log.detail_evicted_session') });
  }
  if (parsed.cvkVersion !== undefined) {
    knownKeys.add('cvkVersion');
    fragments.push({
      key: 'cvk_version',
      value: t('audit_log.detail_cvk_version', { version: String(parsed.cvkVersion) }),
    });
  }
  if (parsed.expiresAt) {
    knownKeys.add('expiresAt');
    fragments.push({
      key: 'expires_at',
      value: t('audit_log.detail_expires_at', { date: formatDateTime(parsed.expiresAt as string) }),
    });
  }
  if (parsed.quantity !== undefined) {
    knownKeys.add('quantity');
    fragments.push({
      key: 'quantity_from',
      value: parsed.previousQuantity !== undefined
        ? t('audit_log.detail_quantity_from', { from: String(parsed.previousQuantity), to: String(parsed.quantity) })
        : `${String(parsed.quantity)}`,
    });
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
      value: t('audit_log.detail_amount', { amount: formatCurrency(parsed.amountCents as number) }),
    });
  }

  // Remaining unknown fields — show with translated label
  for (const [key, value] of Object.entries(parsed)) {
    if (!knownKeys.has(key)) {
      const displayValue =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? formatDateTime(value)
          : value === null
            ? '—'
            : value === undefined
              ? '—'
              : String(value);
      // Translate common camelCase keys to Spanish labels
      const label = translateUnknownKey(key);
      fragments.push({ key: `_${key}`, value: `${label}: ${displayValue}` });
    }
  }

  return fragments;
}

/** Translate common technical keys to Spanish labels. */
function translateUnknownKey(key: string): string {
  const map: Record<string, string> = {
    ipAddress: 'Dirección IP',
    userAgent: 'Navegador',
    deviceId: 'Dispositivo',
    sessionId: 'ID de sesión',
    targetUserId: 'Usuario destino',
    targetRole: 'Rol destino',
    oldRole: 'Rol anterior',
    newRole: 'Rol nuevo',
    createdBy: 'Creado por',
    approvedBy: 'Aprobado por',
    appliedBy: 'Aplicado por',
    rejectedBy: 'Rechazado por',
    invoiceNumber: 'Factura No.',
    cufe: 'CUFE',
    documentId: 'Documento',
    reference: 'Referencia',
    notes: 'Notas',
    description: 'Descripción',
    previousValue: 'Valor anterior',
    newValue: 'Valor nuevo',
    priceBefore: 'Precio anterior',
    priceAfter: 'Precio nuevo',
    supplierName: 'Proveedor',
    purchaseOrder: 'Orden de compra',
    receiptNumber: 'Recibo No.',
    paymentMethod: 'Método de pago',
    changeAmount: 'Cambio',
    receivedAmount: 'Recibido',
    // Cash shift / turno fields
    openingBalance: 'Saldo inicial',
    openingNotes: 'Notas de apertura',
    closingBalance: 'Saldo final',
    closingNotes: 'Notas de cierre',
    closedAt: 'Cerrado el',
    expectedCash: 'Efectivo esperado',
    countedCash: 'Efectivo contado',
    discrepancy: 'Diferencia',
    openedAt: 'Abierto el',
    openedBy: 'Abierto por',
    closedBy: 'Cerrado por',
    shiftNumber: 'Turno No.',
    // Client fields
    clientName: 'Nombre del cliente',
    clientId: 'ID del cliente',
    clientEmail: 'Correo del cliente',
    clientPhone: 'Teléfono del cliente',
    clientAddress: 'Dirección del cliente',
    documentType: 'Tipo de documento',
    documentNumber: 'Número de documento',
    // Purchase fields
    supplierId: 'ID del proveedor',
    poNumber: 'Orden de compra No.',
    receivedDate: 'Fecha de recepción',
    totalAmount: 'Monto total',
    taxAmount: 'Valor IVA',
    discountAmount: 'Valor descuento',
    // Sale fields
    saleNumber: 'Venta No.',
    itemCount: 'Cantidad de artículos',
    paymentType: 'Tipo de pago',
    cashAmount: 'Monto en efectivo',
    cardAmount: 'Monto en tarjeta',
    transferAmount: 'Monto en transferencia',
    // Fiscal fields
    contingencyCode: 'Código de contingencia',
    errorMessage: 'Mensaje de error',
    retryCount: 'Intentos',
    transmissionDate: 'Fecha de transmisión',
  };
  return map[key] ?? key;
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
  const fragments = parseSummaryFragments(log.details, log, t);
  const showTarget = !isTargetMeaningless(log);
  const isSensitive = getIsSensitive(log.action);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <article
      className="rounded-sm border-l-[3px]"
      style={{
        borderLeftColor: borderColor,
        backgroundColor: isSensitive ? 'color-mix(in srgb, #5B3E96 4%, white)' : 'var(--color-panel)',
        boxShadow: 'var(--shadow-pos-panel)',
      }}
      aria-label={`${t(`audit_events.${log.action}`, log.action)} — ${formatAbsoluteTime(log.createdAt)}`}
    >
      {/* ── Row 1: Icon + Event name + Timestamp ── */}
      <div className="flex items-start justify-between px-3 pt-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0"
            style={{ color: borderColor }}
          />
          <span
            className="text-body font-semibold truncate"
            style={{ color: 'var(--color-ink)' }}
          >
            {t(`audit_events.${log.action}`, log.action)}
          </span>
          {config.module && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-caption font-medium rounded-sm shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
                color: 'var(--color-ink-muted)',
              }}
            >
              {t(MODULE_I18N_KEY[config.module] ?? config.module)}
            </span>
          )}
        </div>
        <time
          className="text-caption whitespace-nowrap ml-2 shrink-0"
          style={{ color: 'var(--color-ink-muted)' }}
          dateTime={log.createdAt}
          title={formatDateTime(log.createdAt)}
        >
          {formatRelativeTime(log.createdAt, t)}
        </time>
      </div>

      {/* ── Row 2: Actor — username + translated role badge ── */}
      {(log.userId || log.userRole) && (
        <div className="flex items-center gap-2 px-3 pt-1">
          {log.userId && (
            <span
              className="text-body-sm truncate max-w-[200px] font-data"
              style={{ color: 'var(--color-ink)' }}
              title={log.userId}
            >
              {log.userId}
            </span>
          )}
          {log.userRole && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wider rounded-sm shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
                color: 'var(--color-ink-muted)',
              }}
            >
              {translateRole(log.userRole, t)}
            </span>
          )}
        </div>
      )}

      {/* ── Row 3: Detail summary ── */}
      {fragments.length > 0 && (
        <div className="px-3 pt-1 pb-0.5">
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {fragments.map((f, i) => (
              <span key={f.key} className="inline-flex items-center gap-1">
                {i > 0 && (
                  <span className="w-0.5 h-0.5 rounded-full shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 25%, transparent)' }} />
                )}
                {f.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Row 4: Target ── */}
      {showTarget && (
        <div className="px-3 pb-0.5">
          <p className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
            {log.productName
              ? `${t('audit_log.target_product')}: ${log.productName}${log.lotBatch ? ` · ${t('audit_log.detail_lot_batch', { batch: log.lotBatch })}` : ''}`
              : `${t(ENTITY_TYPE_I18N_KEY[log.entityType ?? ''] ?? 'audit_log.target_entity', { type: log.entityType ?? '' })}: ${log.entityId?.slice(0, 12) ?? '—'}`}
          </p>
        </div>
      )}

      {/* ── Row 5: Expand toggle ── */}
      {log.details && (
        <div className="px-3 pb-2 pt-0.5">
          <button
            type="button"
            onClick={toggleExpand}
            className="inline-flex items-center gap-1 text-caption font-medium border-0 bg-transparent cursor-pointer p-0 hover:opacity-80"
            style={{ color: 'var(--color-pharma)' }}
            aria-expanded={expanded}
            aria-label={expanded ? t('audit_log.collapse_details') : t('audit_log.expand_details')}
          >
            {expanded ? (
              <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{expanded ? t('audit_log.collapse_details') : t('audit_log.expand_details')}</span>
          </button>

          {expanded && (
            <div
              className="mt-1.5 p-2 rounded-sm grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1"
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
