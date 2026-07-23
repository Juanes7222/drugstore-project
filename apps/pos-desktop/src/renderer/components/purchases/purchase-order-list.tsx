/**
 * PurchaseOrderList — paginated table of purchase orders.
 *
 * State filter dropdown, color-coded state badges, sequential number,
 * supplier, total, created date, and view action.
 *
 * @category Component
 */

import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PurchaseOrderResult } from '../../../domain/purchases';
import {
  formatCOP,
  formatShortDate,
  PURCHASE_ORDER_STATES,
  resolveStateConfig,
  TableSkeletonRows,
  TablePagination,
} from './purchases-helpers';
import { Eye } from 'lucide-react';

export interface PurchaseOrderListProps {
  orders: PurchaseOrderResult[];
  isLoading: boolean;
  error: string | null;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onView: (id: string) => void;
  filterState?: string;
  onFilterStateChange?: (state: string | undefined) => void;
}

export const PurchaseOrderList: FC<PurchaseOrderListProps> = ({
  orders,
  isLoading,
  error,
  total,
  page,
  pageSize,
  onPageChange,
  onView,
  filterState,
  onFilterStateChange,
}) => {
  const { t } = useTranslation();

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm" role="alert">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* State filter */}
      {onFilterStateChange && (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="po-state-filter" className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
            {t('purchases.orders.filterState')}
          </label>
          <select
            id="po-state-filter"
            value={filterState ?? ''}
            onChange={(e) => onFilterStateChange(e.target.value || undefined)}
            className="pos-input w-48 text-sm"
            aria-label={t('purchases.orders.filterState')}
          >
            <option value="">{t('common.all_status')}</option>
            {Object.entries(PURCHASE_ORDER_STATES).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-white z-10 border-b text-left text-gray-500 text-xs uppercase tracking-wider">
              <th className="py-2 px-3 font-semibold">#</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.orders.supplier')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.orders.state')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.orders.total')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.orders.createdAt')}</th>
              <th className="py-2 px-3 font-semibold">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeletonRows cols={6} />
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                  {t('purchases.orders.emptyState')}
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const stateCfg = resolveStateConfig(o.state, PURCHASE_ORDER_STATES);
                return (
                  <tr
                    key={o.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => onView(o.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onView(o.id); }}
                    role="button"
                    aria-label={`${t('purchases.orders.viewOrder')} #${o.sequentialNumber}`}
                  >
                    <td className="py-3 px-3 font-data tabular-nums text-xs text-gray-500">
                      #{o.sequentialNumber}
                    </td>
                    <td className="py-3 px-3 font-medium">{o.supplier.businessName}</td>
                    <td className="py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${stateCfg.className}`}>
                        {stateCfg.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-data tabular-nums">
                      {formatCOP(o.subtotal)}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-500">
                      {formatShortDate(o.createdAt)}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); onView(o.id); }}
                        className="inline-flex items-center gap-1 text-pharma hover:text-pharma/80 text-xs font-semibold transition-colors"
                        aria-label={`${t('purchases.orders.viewOrder')} #${o.sequentialNumber}`}
                      >
                        <Eye size={14} aria-hidden="true" />
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  );
};
