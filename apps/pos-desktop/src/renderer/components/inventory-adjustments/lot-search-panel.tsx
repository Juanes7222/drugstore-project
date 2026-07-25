/**
 * LotSearchPanel — grouped-by-product lot search/selection for adjustments.
 *
 * Groups lots by product with expand/collapse. Color-codes expired (red
 * background) and near-expiry (yellow) groups/lots inline.  Click a lot
 * row to select it for the adjustment form.
 *
 * @component
 */

import { type FC, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LotState } from '@pharmacy/database/local';
import { SearchIcon } from '@/components/ui/icons';
import type { DisplayLot } from './inventory-adjustments.types';
import type { ProductLotGroup } from '../../../domain/inventory-lots/inventory-lots.service';

// ── Constants ────────────────────────────────────────────────────────────

const EXPIRY_SOON_DAYS = 90;
const LOW_STOCK_THRESHOLD = 10;

// ── Helpers ──────────────────────────────────────────────────────────────

const isNearExpiry = (date: Date): boolean => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + EXPIRY_SOON_DAYS);
  return date <= cutoff && date > new Date();
};

const isExpired = (date: Date): boolean => date <= new Date();

type GroupPriority = 'expired' | 'soon' | 'low-stock' | 'normal';

function groupPriority(group: {
  expiredCount: number;
  soonToExpireCount: number;
  lowStockCount: number;
}): GroupPriority {
  if (group.expiredCount > 0) return 'expired';
  if (group.soonToExpireCount > 0) return 'soon';
  if (group.lowStockCount > 0) return 'low-stock';
  return 'normal';
}

function groupRowBg(priority: GroupPriority): string {
  switch (priority) {
    case 'expired':
      return 'color-mix(in srgb, var(--color-urgency) 6%, transparent)';
    case 'soon':
      return 'color-mix(in srgb, var(--color-urgency) 3%, transparent)';
    default:
      return 'transparent';
  }
}

function groupAlertLabel(
  group: { expiredCount: number; soonToExpireCount: number; lowStockCount: number },
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const parts: string[] = [];
  if (group.expiredCount > 0) {
    parts.push(t('inventory_lots.expired_count', { count: group.expiredCount }));
  }
  if (group.soonToExpireCount > 0) {
    parts.push(t('inventory_lots.expiring_soon', { count: group.soonToExpireCount }));
  }
  if (group.lowStockCount > 0) {
    parts.push(t('inventory_lots.low_stock_count', { count: group.lowStockCount }));
  }
  return parts.join(' · ') || t('inventory_lots.no_alerts');
}

function groupAlertColor(priority: GroupPriority): string {
  switch (priority) {
    case 'expired':
      return 'var(--color-urgency)';
    case 'soon':
    case 'low-stock':
      return 'var(--color-sync)';
    default:
      return 'var(--color-ink-muted)';
  }
}

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

/** Map a domain lot row to the DisplayLot shape the adjustment form expects. */
function toDisplayLot(lot: {
  id: string;
  productId: string;
  product: { commercialName: string };
  batchNumber: string;
  currentStock: number;
  expirationDate: Date;
  locationCode: string | null;
}): DisplayLot {
  return {
    id: lot.id,
    productId: lot.productId,
    productName: lot.product.commercialName,
    lotCode: lot.batchNumber,
    currentStock: lot.currentStock,
    expirationDate: lot.expirationDate.toISOString().split('T')[0],
    location: lot.locationCode ?? '',
  };
}

// ── Props ────────────────────────────────────────────────────────────────

interface LotSearchPanelProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isProcessing: boolean;
  productGroups: ProductLotGroup[];
  selectedLot: DisplayLot | null;
  onSelectLot: (lot: DisplayLot) => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const LotSearchPanel: FC<LotSearchPanelProps> = ({
  searchQuery,
  onSearchQueryChange,
  isProcessing,
  productGroups,
  selectedLot,
  onSelectLot,
}) => {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ── Filter groups by search query ────────────────────────────────────

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return productGroups;

    return productGroups
      .map((group) => {
        const matchingLots = group.lots.filter(
          (lot) =>
            lot.product.commercialName.toLowerCase().includes(q) ||
            lot.product.genericName.toLowerCase().includes(q) ||
            lot.product.internalCode.toLowerCase().includes(q) ||
            lot.batchNumber.toLowerCase().includes(q),
        );
        if (matchingLots.length === 0) return null;

        return {
          ...group,
          lots: matchingLots,
          lotCount: matchingLots.length,
          totalStock: matchingLots.reduce((sum, l) => sum + l.currentStock, 0),
          soonToExpireCount: matchingLots.filter(
            (l) => !isExpired(l.expirationDate) && isNearExpiry(l.expirationDate),
          ).length,
          expiredCount: matchingLots.filter((l) => isExpired(l.expirationDate)).length,
          lowStockCount: matchingLots.filter((l) => l.currentStock <= LOW_STOCK_THRESHOLD).length,
        };
      })
      .filter((g): g is ProductLotGroup => g !== null);
  }, [searchQuery, productGroups]);

  // ── Expand / collapse ────────────────────────────────────────────────

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
  }, []);

  const isFiltering = searchQuery.trim().length > 0;
  const hasResults = filteredGroups.length > 0;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <section
      className="flex flex-col overflow-hidden"
      role="search"
      aria-label={t('inventory_adjustments.inventory_list')}
    >
      {/* ── Search bar ──────────────────────────────────────────────── */}
      <div className="mb-pos-sm flex items-center gap-pos-sm">
        <div className="relative flex-1">
          <input
            id="lot-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t('inventory_adjustments.search_placeholder')}
            disabled={isProcessing}
            className="pos-input w-full pl-pos-lg"
            aria-describedby="lot-search-hint"
          />
          <span
            className="absolute left-pos-sm top-1/2 -translate-y-1/2"
            style={{
              color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)',
            }}
          >
            <SearchIcon />
          </span>
        </div>
        {/* Group count chip */}
        <span
          className="shrink-0 rounded-full px-pos-sm py-pos-xs font-data text-caption tabular-nums"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-ink) 8%, transparent)',
            color: 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
          }}
        >
          {filteredGroups.length}
        </span>
      </div>

      {/* ── Scrollable grouped list ─────────────────────────────────── */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="listbox"
        aria-label={t('inventory_adjustments.inventory_list')}
        tabIndex={0}
      >
        {!hasResults && isFiltering && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 50%, transparent)',
              }}
            >
              {t('inventory_adjustments.no_results')}
            </p>
          </div>
        )}

        {!hasResults && !isFiltering && (
          <div className="flex items-center justify-center py-pos-xl">
            <p
              className="text-body-sm"
              style={{
                color: 'color-mix(in srgb, var(--color-ink) 40%, transparent)',
              }}
            >
              {t('inventory_adjustments.no_inventory')}
            </p>
          </div>
        )}

        {filteredGroups.map((group) => {
          const priority = groupPriority(group);
          const expanded = expandedIds.has(group.productId);

          return (
            <div key={group.productId} className="mb-pos-xs">
              {/* ── Group header row ────────────────────────────────── */}
              <div
                role="button"
                aria-expanded={expanded}
                tabIndex={0}
                onClick={() => toggleExpand(group.productId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(group.productId);
                  }
                }}
                className="flex cursor-pointer items-center gap-pos-md rounded-pos px-pos-md py-pos-sm transition-colors duration-100"
                style={{
                  backgroundColor: groupRowBg(priority),
                  borderLeft: `3px solid ${groupAlertColor(priority)}`,
                }}
              >
                {/* Product identity */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body font-medium">
                    {group.commercialName}
                  </span>
                  <span
                    className="truncate text-caption"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {group.genericName}
                    <span className="ml-pos-xs font-data">{group.internalCode}</span>
                  </span>
                </div>

                {/* Total stock */}
                <span className="shrink-0 text-right font-data text-caption tabular-nums">
                  {t('inventory_lots.stock')}: {group.totalStock}
                </span>

                {/* Lot count */}
                <span
                  className="shrink-0 text-center font-data text-caption tabular-nums"
                  style={{ color: 'var(--color-ink-muted)', minWidth: '2.5rem' }}
                >
                  {group.lotCount}{' '}
                  <span className="font-ui">{t('inventory_lots.lots_column').toLowerCase()}</span>
                </span>

                {/* Alert badge */}
                {(group.expiredCount > 0 ||
                  group.soonToExpireCount > 0 ||
                  group.lowStockCount > 0) && (
                  <span
                    className="shrink-0 rounded px-pos-xs py-0.5 font-data text-caption font-semibold tabular-nums"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${groupAlertColor(priority)} 12%, transparent)`,
                      color: groupAlertColor(priority),
                    }}
                  >
                    {groupAlertLabel(group, t)}
                  </span>
                )}

                {/* Expand indicator */}
                <span
                  className="shrink-0 text-caption transition-transform duration-100"
                  style={{
                    transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    color: 'var(--color-ink-muted)',
                  }}
                >
                  ▼
                </span>
              </div>

              {/* ── Expanded: per-lot rows ──────────────────────────── */}
              {expanded &&
                group.lots.map((lot) => {
                  const nearExpiry = isNearExpiry(lot.expirationDate);
                  const expired = isExpired(lot.expirationDate);
                  const isSelected = selectedLot?.id === lot.id;

                  return (
                    <div
                      key={lot.id}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={0}
                      onClick={() => onSelectLot(toDisplayLot(lot))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectLot(toDisplayLot(lot));
                        }
                      }}
                      className={`ml-pos-md flex cursor-pointer items-center gap-pos-md rounded-pos px-pos-md py-pos-xs text-caption transition-colors duration-100 ${
                        isSelected ? '' : 'hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: isSelected
                          ? 'color-mix(in srgb, var(--color-pharma) 8%, transparent)'
                          : 'color-mix(in srgb, var(--color-ink) 2%, transparent)',
                        borderLeft: isSelected
                          ? '2px solid var(--color-pharma)'
                          : '2px solid transparent',
                      }}
                    >
                      {/* Batch number + location */}
                      <div className="flex min-w-0 flex-1 items-center gap-pos-xs">
                        <span className="font-data tabular-nums">
                          {lot.batchNumber}
                        </span>
                        {lot.locationCode && (
                          <span style={{ color: 'var(--color-ink-muted)' }}>
                            · {lot.locationCode}
                          </span>
                        )}
                      </div>

                      {/* Stock (red if low) */}
                      <span
                        className="shrink-0 font-data tabular-nums"
                        style={{
                          minWidth: '3rem',
                          textAlign: 'right',
                          color:
                            lot.currentStock <= LOW_STOCK_THRESHOLD
                              ? 'var(--color-urgency)'
                              : 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
                          fontWeight:
                            lot.currentStock <= LOW_STOCK_THRESHOLD ? 600 : undefined,
                        }}
                      >
                        {t('inventory_adjustments.stock')}: {lot.currentStock}
                      </span>

                      {/* Expiry date (red if expired, yellow if near) */}
                      <span
                        className="shrink-0 font-data tabular-nums"
                        style={{
                          minWidth: '5.5rem',
                          color: expired
                            ? 'var(--color-urgency)'
                            : nearExpiry
                              ? 'var(--color-sync)'
                              : 'color-mix(in srgb, var(--color-ink) 55%, transparent)',
                          fontWeight: expired || nearExpiry ? 600 : undefined,
                        }}
                      >
                        {lot.expirationDate.toLocaleDateString('es-CO')}
                      </span>

                      {/* State badge */}
                      <span
                        className="shrink-0 inline-flex items-center gap-1 rounded-full px-pos-xs py-0.5 font-data text-caption font-medium"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${stateColor(lot.state)} 15%, transparent)`,
                          color: stateColor(lot.state),
                        }}
                      >
                        {t(stateLabelKey(lot.state))}
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </section>
  );
};
