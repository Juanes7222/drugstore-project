/**
 * SupplierList — table with NIT, business name, contact, phone, actions.
 *
 * Loading skeleton, empty state. Actions (edit/deactivate) shown only when
 * callbacks are provided. Uses lucide-react icons per design system.
 *
 * @category Component
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Edit3, UserX } from 'lucide-react';
import type { SupplierSearchResult } from '../../../domain/purchases';
import { TableSkeletonRows } from './purchases-helpers';

export interface SupplierListProps {
  suppliers: SupplierSearchResult[];
  isLoading: boolean;
  onEdit?: (id: string) => void;
  onDeactivate?: (id: string) => void;
}

export const SupplierList: FC<SupplierListProps> = ({
  suppliers,
  isLoading,
  onEdit,
  onDeactivate,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wider">
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.nit')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.businessName')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.contactName')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.phone')}</th>
            <th className="py-2 px-3 font-semibold">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          <TableSkeletonRows rows={5} cols={5} />
        </tbody>
      </table>
    );
  }

  if (suppliers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-ink-muted">
        <div className="w-12 h-12 rounded-full bg-pharma/10 flex items-center justify-center mb-3">
          <Building2 size={24} className="text-pharma" aria-hidden="true" />
        </div>
        <p className="text-sm">
          {t('purchases.suppliers.emptyState')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="sticky top-0 bg-white z-10 border-b text-left text-gray-500 text-xs uppercase tracking-wider">
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.nit')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.businessName')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.contactName')}</th>
            <th className="py-2 px-3 font-semibold">{t('purchases.suppliers.phone')}</th>
            <th className="py-2 px-3 font-semibold">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr
              key={s.id}
              className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
            >
              <td className="py-3 px-3 font-data tabular-nums text-xs">
                {s.identificationNumber}
              </td>
              <td className="py-3 px-3 font-medium">{s.businessName}</td>
              <td className="py-3 px-3 text-ink-muted">{s.contactName ?? '—'}</td>
              <td className="py-3 px-3 font-data tabular-nums text-xs text-ink-muted">
                {s.phone ?? '—'}
              </td>
              <td className="py-3 px-3">
                <div className="flex items-center gap-2">
                  {onEdit && (
                    <button
                      onClick={() => onEdit(s.id)}
                      className="inline-flex items-center gap-1 text-pharma hover:text-pharma/80 text-xs font-semibold transition-colors"
                      aria-label={`${t('common.edit')} ${s.businessName}`}
                    >
                      <Edit3 size={12} aria-hidden="true" />
                      {t('common.edit')}
                    </button>
                  )}
                  {onDeactivate && s.isActive && (
                    <button
                      onClick={() => onDeactivate(s.id)}
                      className="inline-flex items-center gap-1 text-error hover:text-error/80 text-xs font-semibold transition-colors"
                      aria-label={`${t('purchases.suppliers.deactivate')} ${s.businessName}`}
                    >
                      <UserX size={12} aria-hidden="true" />
                      {t('purchases.suppliers.deactivate')}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
