/**
 * Inventory-lots page — manage product lots (batch numbers, expiry, stock).
 *
 * Thin wiring container that:
 * - Lists all active lots ordered by expiration (nearest first)
 * - Allows search by product name/code or batch number
 * - Shows expiry summary banner (soon-to-expire, expired, active)
 * - Color-codes rows: yellow for near-expiry, red for expired
 *
 * @category Page
 */
import {
  type FC,
  Fragment,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { LotState } from '@pharmacy/database/local';
import { useInventoryLotsService } from '../common/service-context';
import type { LotWithProduct } from '../../../domain/inventory-lots/inventory-lots.service';
import { LotMovementHistory } from './lot-movement-history';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPIRY_SOON_DAYS = 90;

/** True if lot expires within the threshold. */
const isNearExpiry = (date: Date): boolean => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + EXPIRY_SOON_DAYS);
  return date <= cutoff && date > new Date();
};

/** True if lot has already expired. */
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InventoryLotsPage: FC = () => {
  const { t } = useTranslation();
  const lotsService = useInventoryLotsService();

  // ---- State ----
  const [lots, setLots] = useState<LotWithProduct[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<LotState | 'ALL'>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [openMovementLotId, setOpenMovementLotId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    expiringSoon: number;
    expired: number;
    active: number;
    totalStock: number;
  } | null>(null);

  // ---- Data fetching ----
  const loadLots = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = stateFilter === 'ALL' ? undefined : stateFilter;
      const search = searchQuery.trim() || undefined;

      const [fetchedLots, expirySummary] = await Promise.all([
        lotsService.getLots({ state, search }),
        lotsService.getExpirySummary(EXPIRY_SOON_DAYS),
      ]);

      setLots(fetchedLots);
      setSummary(expirySummary);
    } catch {
      // Error handling — keep existing data
    } finally {
      setIsLoading(false);
    }
  }, [lotsService, searchQuery, stateFilter]);

  useEffect(() => {
    void loadLots();
  }, [loadLots]);

  // ---- Render ----
  return (
    <div className="flex h-full flex-col gap-pos-lg overflow-y-auto p-pos-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="pos-page-title m-0">{t('inventory_lots.title')}</h1>
      </div>

      {/* Expiry summary banner */}
      {summary && (
        <div
          className="flex flex-wrap items-center gap-pos-md rounded-pos p-pos-md"
          style={{
            backgroundColor: summary.expiringSoon > 0
              ? 'color-mix(in srgb, var(--color-urgency) 6%, transparent)'
              : 'color-mix(in srgb, var(--color-verified) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
          }}
        >
          <div className="flex items-center gap-pos-sm">
            <span
              className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-verified) 15%, transparent)',
                color: 'var(--color-verified)',
              }}
            >
              {t('inventory_lots.active_lots', { count: summary.active })}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-urgency) 15%, transparent)',
                color: 'var(--color-urgency)',
              }}
            >
              {t('inventory_lots.expiring_soon', { count: summary.expiringSoon })}
            </span>
            {summary.expired > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data text-caption font-medium"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-urgency) 25%, transparent)',
                  color: 'var(--color-urgency)',
                }}
              >
                {t('inventory_lots.expired_count', { count: summary.expired })}
              </span>
            )}
          </div>
          <span className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
            {t('inventory_lots.total_stock', { count: summary.totalStock })}
          </span>
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
              borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
              backgroundColor: 'var(--color-surface)',
            }}
            autoFocus
          />
        </div>

        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as LotState | 'ALL')}
          className="rounded-pos border px-pos-sm py-pos-xs text-body outline-none"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-ink) 15%, transparent)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <option value="ALL">{t('inventory_lots.filter_all')}</option>
          <option value={LotState.ACTIVE}>{t('inventory_lots.state_active')}</option>
          <option value={LotState.EXHAUSTED}>{t('inventory_lots.state_exhausted')}</option>
          <option value={LotState.EXPIRED}>{t('inventory_lots.state_expired')}</option>
          <option value={LotState.BLOCKED}>{t('inventory_lots.state_blocked')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-pos" style={{ border: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)' }}>
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('common.loading')}
            </p>
          </div>
        ) : lots.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-body-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('inventory_lots.no_lots')}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-ink) 4%, transparent)',
                  borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)',
                }}
              >
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('inventory_lots.product')}</th>
                <th className="px-pos-sm py-pos-xs text-left font-medium">{t('inventory_lots.batch')}</th>
                <th className="px-pos-sm py-pos-xs text-right font-medium">{t('inventory_lots.stock')}</th>
                <th className="px-pos-sm py-pos-xs text-right font-medium">{t('inventory_lots.expiry')}</th>
                <th className="px-pos-sm py-pos-xs text-center font-medium">{t('inventory_lots.state')}</th>
                <th className="px-pos-sm py-pos-xs text-center font-medium">{t('inventory_lots.audit')}</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot, idx) => {
                const nearExpiry = isNearExpiry(lot.expirationDate);
                const expired = isExpired(lot.expirationDate);
                const rowBg =
                  expired
                    ? 'color-mix(in srgb, var(--color-urgency) 6%, transparent)'
                    : nearExpiry
                      ? 'color-mix(in srgb, var(--color-urgency) 3%, transparent)'
                      : idx % 2 === 0
                        ? 'transparent'
                        : 'color-mix(in srgb, var(--color-ink) 2%, transparent)';

                return (
                  <Fragment key={lot.id}>
                  <tr
                    style={{
                      backgroundColor: rowBg,
                      borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 4%, transparent)',
                    }}
                  >
                    <td className="px-pos-sm py-pos-xs">
                      <div className="flex flex-col">
                        <span className="font-medium">{lot.product.commercialName}</span>
                        <span className="text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                          {lot.product.genericName}
                          <span className="ml-pos-xs font-data">{lot.product.internalCode}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-pos-sm py-pos-xs font-data tabular-nums">
                      {lot.batchNumber}
                      {lot.locationCode && (
                        <span className="ml-pos-xs text-caption" style={{ color: 'var(--color-ink-muted)' }}>
                          · {lot.locationCode}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-pos-sm py-pos-xs text-right font-data tabular-nums"
                      style={{
                        color: lot.currentStock <= 10 ? 'var(--color-urgency)' : undefined,
                        fontWeight: lot.currentStock <= 10 ? 600 : undefined,
                      }}
                    >
                      {lot.currentStock}
                    </td>
                    <td
                      className="px-pos-sm py-pos-xs text-right font-data tabular-nums"
                      style={{
                        color: expired
                          ? 'var(--color-urgency)'
                          : nearExpiry
                            ? 'var(--color-sync)'
                            : undefined,
                        fontWeight: expired || nearExpiry ? 600 : undefined,
                      }}
                    >
                      {new Date(lot.expirationDate).toLocaleDateString('es-CO')}
                    </td>
                    <td className="px-pos-sm py-pos-xs text-center">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 text-caption font-medium"
                        style={{
                          backgroundColor: 'color-mix(in srgb, ' + stateColor(lot.state) + ' 15%, transparent)',
                          color: stateColor(lot.state),
                        }}
                      >
                        {t(stateLabelKey(lot.state))}
                      </span>
                    </td>
                    <td className="px-pos-sm py-pos-xs text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMovementLotId(
                            openMovementLotId === lot.id ? null : lot.id,
                          )
                        }
                        className="rounded-pos px-pos-xs py-0.5 text-caption font-medium outline-none transition-colors duration-75"
                        style={{
                          color:
                            openMovementLotId === lot.id
                              ? "var(--color-pharma)"
                              : "var(--color-ink-muted)",
                          backgroundColor:
                            openMovementLotId === lot.id
                              ? "color-mix(in srgb, var(--color-pharma) 10%, transparent)"
                              : "color-mix(in srgb, var(--color-ink) 6%, transparent)",
                        }}
                        aria-label={t("inventory_lots.view_movements")}
                      >
                        {openMovementLotId === lot.id
                          ? t("common.close")
                          : t("inventory_lots.audit")}
                      </button>
                    </td>
                  </tr>
                  <LotMovementHistory
                    lotId={lot.id}
                    lotCode={lot.batchNumber}
                    isOpen={openMovementLotId === lot.id}
                    onClose={() => setOpenMovementLotId(null)}
                  />
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
