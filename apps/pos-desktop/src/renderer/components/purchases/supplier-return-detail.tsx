/**
 * SupplierReturnDetail — detail view with items, lot info, reason, state badge.
 *
 * Action buttons owned by the page wiring container.
 *
 * @category Component
 */

import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, PackageIcon } from "@/components/ui/icons";
import type { SupplierReturnResult } from '../../../domain/purchases';
import {
  formatCOP,
  formatDate,
  SUPPLIER_RETURN_STATES,
  resolveStateConfig,
  DetailSkeleton,
} from './purchases-helpers';

export interface SupplierReturnDetailProps {
  returnData: SupplierReturnResult | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
}

export const SupplierReturnDetail: FC<SupplierReturnDetailProps> = ({
  returnData,
  isLoading,
  error,
  onBack,
}) => {
  const { t } = useTranslation();

  const stateCfg = useMemo(
    () => returnData
      ? resolveStateConfig(returnData.state, SUPPLIER_RETURN_STATES)
      : { label: '', className: '' },
    [returnData],
  );

  if (isLoading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="p-4 bg-error-container text-error rounded border border-error/20 text-sm" role="alert">
        {error}
      </div>
    );
  }

  if (!returnData) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-ink-muted">
        <PackageIcon size={32} aria-hidden="true" />
        <p className="mt-2 text-sm">{t('purchases.supplierReturns.returnNotFound')}</p>
        <button onClick={onBack} className="mt-3 inline-flex items-center gap-1 text-pharma text-sm hover:underline">
          <ArrowLeftIcon size={14} aria-hidden="true" />
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
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label={t('common.back')}
          >
            <ArrowLeftIcon size={20} aria-hidden="true" />
          </button>
          <div>
            <h2 className="pos-page-title">
              {t('purchases.supplierReturns.returnTitle')} #{returnData.sequentialNumber}
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              {t('purchases.supplierReturns.createdAt')}: {formatDate(returnData.createdAt)}
            </p>
          </div>
        </div>
        <span className={`pos-badge ${stateCfg.className}`}>
          {stateCfg.label}
        </span>
      </div>

      {/* Info card */}
      <div className="pos-panel p-4 mb-6">
        <h3 className="text-sm font-semibold text-ink mb-3">
          {t('purchases.supplierReturns.returnInfo')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.supplier')}</span>
            <span className="font-medium">{returnData.supplier.businessName}</span>
          </div>
          {returnData.purchaseReceptionId && (
            <div>
              <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.receptionRef')}</span>
              <span className="font-data tabular-nums text-xs">{returnData.purchaseReceptionId}</span>
            </div>
          )}
          <div>
            <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.items')}</span>
            <span className="font-data tabular-nums">{returnData.items.length}</span>
          </div>
          <div>
            <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.subtotal')}</span>
            <span className="font-data tabular-nums">{formatCOP(returnData.subtotal)}</span>
          </div>
          <div>
            <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.totalTax')}</span>
            <span className="font-data tabular-nums">{formatCOP(returnData.totalTax)}</span>
          </div>
          <div>
            <span className="block text-xs text-ink-muted">{t('purchases.supplierReturns.totalAmount')}</span>
            <span className="font-data tabular-nums font-bold">{formatCOP(returnData.totalAmount)}</span>
          </div>
        </div>
        {returnData.reason && (
          <div className="mt-3 pt-3 border-t border-border">
            <span className="block text-xs text-ink-muted mb-1">{t('purchases.supplierReturns.reason')}</span>
            <p className="text-sm text-ink">{returnData.reason}</p>
          </div>
        )}
        {returnData.notes && (
          <div className="mt-2">
            <span className="block text-xs text-ink-muted mb-1">{t('purchases.supplierReturns.notes')}</span>
            <p className="text-sm text-ink">{returnData.notes}</p>
          </div>
        )}
      </div>

      {/* Items table */}
      <h3 className="text-sm font-semibold text-ink mb-2">
        {t('purchases.supplierReturns.items')}
      </h3>
      <div className="pos-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 bg-white z-10 border-b border-border text-left text-ink-muted text-xs uppercase tracking-wider ">
              <th className="py-2 px-3 font-semibold">{t('purchases.supplierReturns.product')}</th>
              <th className="py-2 px-3 font-semibold">{t('purchases.supplierReturns.lot')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.supplierReturns.qty')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.supplierReturns.unitCost')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.supplierReturns.total')}</th>
            </tr>
          </thead>
          <tbody>
            {returnData.items.map((item) => (
              <tr key={item.id} className="border-b border-border/40 hover:bg-surface/30">
                <td className="py-3 px-3 font-medium">{item.productId}</td>
                <td className="py-3 px-3 font-data tabular-nums text-xs">{item.lotId}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{item.quantity}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{formatCOP(item.unitCost)}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums font-semibold">{formatCOP(item.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-4 pos-panel p-4">
        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">{t('purchases.supplierReturns.subtotal')}</span>
              <span className="font-data tabular-nums">{formatCOP(returnData.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">{t('purchases.supplierReturns.totalTax')}</span>
              <span className="font-data tabular-nums">{formatCOP(returnData.totalTax)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border font-bold">
              <span>{t('purchases.supplierReturns.totalAmount')}</span>
              <span className="font-data tabular-nums">{formatCOP(returnData.totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
