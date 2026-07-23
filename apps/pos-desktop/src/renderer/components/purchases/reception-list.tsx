/**
 * ReceptionList — paginated table of purchase receptions.
 *
 * Sequential number, supplier, state badge, total, received date, view action.
 *
 * @category Component
 */

import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import type { ReceptionResult } from '../../../domain/purchases';
import {
  formatCOP,
  formatShortDate,
  RECEPTION_STATES,
  resolveStateConfig,
  TableSkeletonRows,
  TablePagination,
} from './purchases-helpers';

export interface ReceptionListProps {
  receptions: ReceptionResult[];
  isLoading: boolean;
  error: string | null;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onView: (id: string) => void;
}

export const ReceptionList: FC<ReceptionListProps> = ({
  receptions,
  isLoading,
  error,
  total,
  page,
  pageSize,
  onPageChange,
  onView,
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
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-white z-10 border-b text-left text-gray-500 text-xs uppercase tracking-wider">
              <th className="py-2 px-3 font-semibold">#</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.supplier')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.state')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.receptions.total')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.receivedAt')}</th>
              <th className="py-2 px-3 font-semibold">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeletonRows cols={6} />
            ) : receptions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                  {t('purchases.receptions.emptyState')}
                </td>
              </tr>
            ) : (
              receptions.map((r) => {
                const stateCfg = resolveStateConfig(r.state, RECEPTION_STATES);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => onView(r.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') onView(r.id); }}
                    role="button"
                    aria-label={`${t('purchases.receptions.viewReception')} #${r.sequentialNumber}`}
                  >
                    <td className="py-3 px-3 font-data tabular-nums text-xs text-gray-500">
                      #{r.sequentialNumber}
                    </td>
                    <td className="py-3 px-3 font-medium">{r.supplier.businessName}</td>
                    <td className="py-3 px-3">
                      <span className={`pos-badge ${stateCfg.className}`}>
                        {stateCfg.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-data tabular-nums">
                      {formatCOP(r.totalAmount)}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-500">
                      {formatShortDate(r.createdAt)}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); onView(r.id); }}
                        className="inline-flex items-center gap-1 text-pharma hover:text-pharma/80 text-xs font-semibold transition-colors"
                        aria-label={`${t('purchases.receptions.viewReception')} #${r.sequentialNumber}`}
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

      <TablePagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  );
};
