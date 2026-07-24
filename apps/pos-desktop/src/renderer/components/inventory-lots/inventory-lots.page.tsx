/**
 * Inventory-lots page — manage product lots grouped by product.
 *
 * Thin wiring container that:
 * - Groups all lots by product, sorted by priority (expired first,
 *   then soon-to-expire, then low-stock, then alphabetical)
 * - Shows per-product aggregates (total stock, lot count, alerts)
 * - Expand/collapse per product to see individual lots
 * - Color-codes: red if product has expired lots, yellow if near-expiry
 * - Search by product name/code or batch number
 * - Filter by lot state
 *
 * @category Page
 */
import {
  type FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LotState } from '@pharmacy/database/local';
import { useInventoryLotsService } from '../common/service-context';
import { useTenantConfig } from '../../../domain/config/use-tenant-config';
import type { ProductLotGroup } from '../../../domain/inventory-lots/inventory-lots.service';
import { LotMovementHistory } from './lot-movement-history';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPIRY_SOON_DAYS = 90;
const COLUMNS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNearExpiry = (date: Date): boolean => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + EXPIRY_SOON_DAYS);
  return date <= cutoff && date > new Date();
};

const isExpired = (date: Date): boolean => date <= new Date();

const stateLabelKey = (state: LotState): string => {
  const map: Record<string, string> = {
    ACTIVE: 'inventory_lots.state_active',
    EXHAUSTED: 'inventory_lots.state_exhausted',
    EXPIRED: 'inventory_lots.state_expired',
    BLOCKED: 'inventory_lots.state_blocked',
  };
  return map[state] ?? 'inventory_lots.state_active';
};

const stateColor = (state: LotState): string => {
  const map: Record<string, string> = {
    ACTIVE: 'var(--color-verified)',
    EXHAUSTED: 'color-mix(in srgb, var(--color-ink) 40%, transparent)',
    EXPIRED: 'var(--color-urgency)',
    BLOCKED: 'var(--color-sync)',
  };
  return map[state] ?? 'var(--color-ink-muted)';
};

/** Priority indicator for a product group row. */
function groupPriority(
  group: ProductLotGroup,
): 'expired' | 'soon' | 'low-stock' | 'normal' {
  if (group.expiredCount > 0) return 'expired';
  if (group.soonToExpireCount > 0) return 'soon';
  if (group.lowStockCount > 0) return 'low-stock';
  return 'normal';
}

function groupRowBg(priority: ReturnType<typeof groupPriority>): string {
  switch (priority) {
    case 'expired':
      return 'color-mix(in srgb, var(--color-urgency) 6%, transparent)';
    case 'soon':
      return 'color-mix(in srgb, var(--color-urgency) 3%, transparent)';
    default:
      return 'transparent';
  }
}

/** Alert label text for the product-group row. */
function groupAlertLabel(
  group: ProductLotGroup,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const parts: string[] = [];
  if (group.expiredCount > 0) {
    parts.push(t('inventory_lots.expired_count', { count: group.expiredCount }));
  }
  if (group.soonToExpireCount > 0) {
    parts.push(
      t('inventory_lots.expiring_soon', { count: group.soonToExpireCount }),
    );
  }
  if (group.lowStockCount > 0) {
    parts.push(
      t('inventory_lots.low_stock_count', { count: group.lowStockCount }),
    );
  }
  return parts.join(' · ') || t('inventory_lots.no_alerts');
}

function groupAlertColor(priority: ReturnType<typeof groupPriority>): string {
  switch (priority) {
    case 'expired':
      return 'var(--color-urgency)';
    case 'soon':
      return 'var(--color-sync)';
    case 'low-stock':
      return 'var(--color-sync)';
    default:
      return 'var(--color-ink-muted)';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InventoryLotsPage: FC = () => {
  const { t } = useTranslation();
  const lotsService = useInventoryLotsService();
  const { effectiveConfig } = useTenantConfig();

  // Feature gate: lot management disabled in tenant config
  if (effectiveConfig && effectiveConfig.strictness.lots === 'OFF') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-pos-md p-pos-xl">
        <p
          className="text-body-sm font-medium"
          style={{ color: 'var(--color-ink-muted)' }}
        >
          {t('inventory_lots.feature_disabled')}
        </p>
      </div>
    );
  }

  // ---- State ----
  const [productGroups, setProductGroups] = useState<ProductLotGroup[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [auditTarget, setAuditTarget] = useState<{
    productId: string;
    lotId: string;
    batchNumber: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<LotState | 'ALL'>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<{
    expiringSoon: number;
    expired: number;
    active: number;
    totalStock: number;
  } | null>(null);

  // ---- Data fetching ----
  const loadGroups = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = stateFilter === 'ALL' ? undefined : stateFilter;
      const search = searchQuery.trim() || undefined;

      const [groups, expirySummary] = await Promise.all([
        lotsService.getLotsGroupedByProduct({
          state,
          search,
          expiringSoonDays: EXPIRY_SOON_DAYS,
        }),
        lotsService.getExpirySummary(EXPIRY_SOON_DAYS),
      ]);

      setProductGroups(groups);
      setSummary(expirySummary);
      // Close audit when data reloads
      setAuditTarget(null);
    } catch {
      // Error handling — keep existing data
    } finally {
      setIsLoading(false);
    }
  }, [lotsService, searchQuery, stateFilter]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  // ---- Expand / collapse ----
  const toggleExpand = useCallback((productId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
    // Close audit when collapse
    setAuditTarget((prev) =>
      prev?.productId === productId ? null : prev,
    );
  }, []);

  // ---- Derived data ----
  const summaryText = useMemo(() => {
    if (!summary) return null;
    const parts: string[] = [];
    parts.push(t('inventory_lots.active_lots', { count: summary.active }));
    parts.push(
      t('inventory_lots.expiring_soon', { count: summary.expiringSoon }),
    );
    if (summary.expired > 0) {
      parts.push(
        t('inventory_lots.expired_count', { count: summary.expired }),
      );
    }
    parts.push(
      t('inventory_lots.total_stock', { count: summary.totalStock }),
    );
    return parts.join(' · ');
  }, [summary, t]);

  const hasAlerts = summary
    ? summary.expiringSoon > 0 || summary.expired > 0
    : false;

  // ---- Render ----
  return (
    <div className="flex h-full flex-col gap-pos-lg overflow-y-auto p-pos-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="pos-page-title m-0">{t('inventory_lots.title')}</h1>
      </div>

      {/* Expiry summary banner */}
      {summaryText && (
        <div
          className="flex flex-wrap items-center gap-pos-md rounded-pos p-pos-md"
          style={{
            backgroundColor: hasAlerts
              ? 'color-mix(in srgb, var(--color-urgency) 6%, transparent)'
              : 'color-mix(in srgb, var(--color-verified) 6%, transparent)',
            border:
              '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
        >
          <span className="text-body-sm font-medium">{summaryText}</span>
        </div>
      )}

      {/* Search + filter row */}
      <div className="flex items-center gap-pos-md">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('inventory_lots.search_placeholder')}
            className="w-full rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
            style={{
              borderColor:
                'color-mix(in srgb, var(--color-ink) 15%, transparent)',
              backgroundColor: 'var(--color-surface)',
            }}
            autoFocus
          />
        </div>

        <select
          value={stateFilter}
          onChange={(e) =>
            setStateFilter(e.target.value as LotState | 'ALL')
          }
          className="rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
          style={{
            borderColor:
              'color-mix(in srgb, var(--color-ink) 15%, transparent)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <option value="ALL">{t('inventory_lots.filter_all')}</option>
          <option value={LotState.ACTIVE}>
            {t('inventory_lots.state_active')}
          </option>
          <option value={LotState.EXHAUSTED}>
            {t('inventory_lots.state_exhausted')}
          </option>
          <option value={LotState.EXPIRED}>
            {t('inventory_lots.state_expired')}
          </option>
          <option value={LotState.BLOCKED}>
            {t('inventory_lots.state_blocked')}
          </option>
        </select>
      </div>

      {/* Grouped table */}
      <div
        className="flex-1 overflow-auto rounded-pos"
        style={{
          border:
            '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
        }}
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <p
              className="text-body-sm"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('common.loading')}
            </p>
          </div>
        ) : productGroups.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p
              className="text-body-sm"
              style={{ color: 'var(--color-ink-muted)' }}
            >
              {t('inventory_lots.no_lots')}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--color-ink) 4%, transparent)',
                  borderBottom:
                    '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
                }}
              >
                <th className="px-pos-sm py-pos-xs text-left font-medium">
                  {t('inventory_lots.product')}
                </th>
                <th className="px-pos-sm py-pos-xs text-right font-medium">
                  {t('inventory_lots.stock')}
                </th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">
                  {t('inventory_lots.alerts')}
                </th>
                <th className="px-pos-sm py-pos-xs text-center font-medium">
                  {t('inventory_lots.lots_column')}
                </th>
                <th className="px-pos-sm py-pos-xs text-center font-medium">
                  {/* expand/collapse indicator — no text needed */}
                </th>
              </tr>
            </thead>
            <tbody>
              {productGroups.map((group) => {
                const priority = groupPriority(group);
                const expanded = expandedIds.has(group.productId);

                return (
                  <Fragment key={group.productId}>
                    {/* ── Product group header row ── */}
                    <tr
                      style={{
                        backgroundColor: groupRowBg(priority),
                        borderBottom:
                          '1px solid color-mix(in srgb, var(--color-ink) 4%, transparent)',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggleExpand(group.productId)}
                    >
                      {/* Product info */}
                      <td className="px-pos-sm py-pos-xs">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {group.commercialName}
                          </span>
                          <span
                            className="text-caption"
                            style={{ color: 'var(--color-ink-muted)' }}
                          >
                            {group.genericName}
                            <span className="ml-pos-xs font-data">
                              {group.internalCode}
                            </span>
                          </span>
                        </div>
                      </td>

                      {/* Total stock */}
                      <td className="px-pos-sm py-pos-xs text-right font-data tabular-nums">
                        {group.totalStock}
                      </td>

                      {/* Alerts */}
                      <td
                        className="px-pos-sm py-pos-xs text-caption"
                        style={{ color: groupAlertColor(priority) }}
                      >
                        {groupAlertLabel(group, t)}
                      </td>

                      {/* Lot count */}
                      <td className="px-pos-sm py-pos-xs text-center font-data tabular-nums">
                        {group.lotCount}
                      </td>

                      {/* Expand toggle */}
                      <td className="px-pos-sm py-pos-xs text-center">
                        <span
                          className="inline-flex items-center justify-center text-caption transition-transform duration-100"
                          style={{
                            transform: expanded
                              ? 'rotate(0deg)'
                              : 'rotate(-90deg)',
                            color: 'var(--color-ink-muted)',
                          }}
                        >
                          ▼
                        </span>
                      </td>
                    </tr>

                    {/* ── Expanded: per-lot rows ── */}
                    {expanded &&
                      group.lots.map((lot) => {
                        const nearExpiry = isNearExpiry(lot.expirationDate);
                        const expired = isExpired(lot.expirationDate);

                        return (
                          <Fragment key={lot.id}>
                            <tr
                              style={{
                                backgroundColor:
                                  'color-mix(in srgb, var(--color-ink) 2%, transparent)',
                                borderBottom:
                                  '1px solid color-mix(in srgb, var(--color-ink) 3%, transparent)',
                              }}
                            >
                              {/* Batch info (indented) */}
                              <td className="px-pos-sm py-pos-xs pl-pos-lg">
                                <span className="font-data tabular-nums">
                                  {lot.batchNumber}
                                </span>
                                {lot.locationCode && (
                                  <span
                                    className="ml-pos-xs text-caption"
                                    style={{
                                      color: 'var(--color-ink-muted)',
                                    }}
                                  >
                                    · {lot.locationCode}
                                  </span>
                                )}
                              </td>

                              {/* Stock */}
                              <td
                                className="px-pos-sm py-pos-xs text-right font-data tabular-nums"
                                style={{
                                  color:
                                    lot.currentStock <= 10
                                      ? 'var(--color-urgency)'
                                      : undefined,
                                  fontWeight:
                                    lot.currentStock <= 10 ? 600 : undefined,
                                }}
                              >
                                {lot.currentStock}
                              </td>

                              {/* Expiry */}
                              <td
                                className="px-pos-sm py-pos-xs text-left font-data tabular-nums"
                                style={{
                                  color: expired
                                    ? 'var(--color-urgency)'
                                    : nearExpiry
                                      ? 'var(--color-sync)'
                                      : 'var(--color-ink)',
                                  fontWeight:
                                    expired || nearExpiry ? 600 : undefined,
                                }}
                              >
                                {new Date(
                                  lot.expirationDate,
                                ).toLocaleDateString('es-CO')}
                              </td>

                              {/* State */}
                              <td className="px-pos-sm py-pos-xs text-center">
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 text-caption font-medium"
                                  style={{
                                    backgroundColor:
                                      'color-mix(in srgb, ' +
                                      stateColor(lot.state) +
                                      ' 15%, transparent)',
                                    color: stateColor(lot.state),
                                  }}
                                >
                                  {t(stateLabelKey(lot.state))}
                                </span>
                              </td>

                              {/* Audit */}
                              <td className="px-pos-sm py-pos-xs text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAuditTarget(
                                      auditTarget?.lotId === lot.id
                                        ? null
                                        : {
                                            productId: group.productId,
                                            lotId: lot.id,
                                            batchNumber: lot.batchNumber,
                                          },
                                    );
                                  }}
                                  className="rounded-pos px-pos-xs py-0.5 text-caption font-medium outline-none transition-colors duration-75"
                                  style={{
                                    color:
                                      auditTarget?.lotId === lot.id
                                        ? 'var(--color-pharma)'
                                        : 'var(--color-ink-muted)',
                                    backgroundColor:
                                      auditTarget?.lotId === lot.id
                                        ? 'color-mix(in srgb, var(--color-pharma) 10%, transparent)'
                                        : 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
                                  }}
                                  aria-label={t(
                                    'inventory_lots.view_movements',
                                  )}
                                >
                                  {auditTarget?.lotId === lot.id
                                    ? t('common.close')
                                    : t('inventory_lots.audit')}
                                </button>
                              </td>
                            </tr>

                            {/* Movement history for this lot */}
                            {auditTarget?.lotId === lot.id && (
                              <LotMovementHistory
                                lotId={lot.id}
                                lotCode={lot.batchNumber}
                                isOpen={true}
                                onClose={() => setAuditTarget(null)}
                                colSpan={COLUMNS}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
