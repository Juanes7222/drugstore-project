/**
 * ReceptionDetail — detail view with items table showing lot info,
 * tax breakdown, total, and state badge.
 *
 * @category Component
 */

import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Package } from 'lucide-react';
import type { ReceptionResult } from '../../../domain/purchases';
import {
  formatCOP,
  formatDate,
  formatShortDate,
  RECEPTION_STATES,
  resolveStateConfig,
  DetailSkeleton,
} from './purchases-helpers';

export interface ReceptionDetailProps {
  reception: ReceptionResult | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
}

export const ReceptionDetail: FC<ReceptionDetailProps> = ({
  reception,
  isLoading,
  error,
  onBack,
}) => {
  const { t } = useTranslation();

  const stateCfg = useMemo(
    () => reception
      ? resolveStateConfig(reception.state, RECEPTION_STATES)
      : { label: '', className: '' },
    [reception],
  );

  const { subtotal, totalTax, grandTotal } = useMemo(() => {
    if (!reception) return { subtotal: 0, totalTax: 0, grandTotal: 0 };
    return {
      subtotal: reception.subtotal,
      totalTax: reception.totalTax,
      grandTotal: reception.totalAmount,
    };
  }, [reception]);

  if (isLoading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm" role="alert">
        {error}
      </div>
    );
  }

  if (!reception) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Package size={32} aria-hidden="true" />
        <p className="mt-2 text-sm">{t('purchases.receptions.receptionNotFound')}</p>
        <button onClick={onBack} className="mt-3 inline-flex items-center gap-1 text-pharma text-sm hover:underline">
          <ArrowLeft size={14} aria-hidden="true" />
          {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-gray-700 transition-colors"
            aria-label={t('common.back')}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <div>
            <h2 className="pos-page-title">
              {t('purchases.receptions.receptionTitle')} #{reception.sequentialNumber}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('purchases.receptions.createdAt')}: {formatDate(reception.createdAt)}
              {reception.receivedAt && ` · ${t('purchases.receptions.receivedAt')}: ${formatDate(reception.receivedAt)}`}
            </p>
          </div>
        </div>
        <span className={`pos-badge ${stateCfg.className}`}>
          {stateCfg.label}
        </span>
      </div>

      {/* Info card */}
      <div className="pos-panel p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          {t('purchases.receptions.receptionInfo')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.receptions.supplier')}</span>
            <span className="font-medium">{reception.supplier.businessName}</span>
          </div>
          {reception.purchaseOrder && (
            <div>
              <span className="block text-xs text-gray-500">{t('purchases.receptions.purchaseOrder')}</span>
              <span className="font-data tabular-nums">#{reception.purchaseOrder.sequentialNumber}</span>
            </div>
          )}
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.receptions.items')}</span>
            <span className="font-data tabular-nums">{reception.items.length}</span>
          </div>
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.receptions.totalAmount')}</span>
            <span className="font-data tabular-nums font-bold">{formatCOP(grandTotal)}</span>
          </div>
        </div>
        {reception.notes && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <span className="block text-xs text-gray-500 mb-1">{t('purchases.receptions.notes')}</span>
            <p className="text-sm text-gray-700">{reception.notes}</p>
          </div>
        )}
      </div>

      {/* Items table */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {t('purchases.receptions.items')}
      </h3>
      <div className="pos-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-white z-10 border-b text-left text-gray-500 text-xs uppercase tracking-wider bg-gray-50/50">
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.product')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.lot')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.receptions.expiry')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.receptions.qty')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.receptions.cost')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.receptions.iva')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.receptions.subtotal')}</th>
            </tr>
          </thead>
          <tbody>
            {reception.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/30">
                <td className="py-3 px-3 font-medium">{item.productId}</td>
                <td className="py-3 px-3 font-data tabular-nums text-xs">
                  {item.lotNumber ?? '—'}
                </td>
                <td className="py-3 px-3 font-data tabular-nums text-xs">
                  {formatShortDate(item.expirationDate)}
                </td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{item.receivedQuantity}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{formatCOP(item.realUnitCost)}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{item.taxRate}%</td>
                <td className="py-3 px-3 text-right font-data tabular-nums font-semibold">
                  {formatCOP(item.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tax summary */}
      <div className="mt-4 pos-panel p-4">
        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('purchases.receptions.subtotal')}</span>
              <span className="font-data tabular-nums">{formatCOP(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('purchases.receptions.totalTax')}</span>
              <span className="font-data tabular-nums">{formatCOP(totalTax)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-gray-200 font-bold">
              <span>{t('purchases.receptions.totalAmount')}</span>
              <span className="font-data tabular-nums">{formatCOP(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
