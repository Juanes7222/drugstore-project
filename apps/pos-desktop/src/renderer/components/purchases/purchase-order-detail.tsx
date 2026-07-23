/**
 * PurchaseOrderDetail — full detail view with state badge, supplier info,
 * items table, notes, confirm/annul action buttons.
 *
 * @category Component
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Package } from 'lucide-react';
import type { PurchaseOrderResult } from '../../../domain/purchases';
import {
  formatCOP,
  formatDate,
  formatShortDate,
  PURCHASE_ORDER_STATES,
  resolveStateConfig,
  DetailSkeleton,
} from './purchases-helpers';

export interface PurchaseOrderDetailProps {
  order: PurchaseOrderResult | null;
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
}

export const PurchaseOrderDetail: FC<PurchaseOrderDetailProps> = ({
  order,
  isLoading,
  error,
  onBack,
}) => {
  const { t } = useTranslation();

  if (isLoading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded border border-red-200 text-sm" role="alert">
        {error}
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Package size={32} aria-hidden="true" />
        <p className="mt-2 text-sm">{t('purchases.orders.orderNotFound')}</p>
        <button onClick={onBack} className="mt-3 inline-flex items-center gap-1 text-pharma text-sm hover:underline">
          <ArrowLeft size={14} aria-hidden="true" />
          {t('common.back')}
        </button>
      </div>
    );
  }

  const stateCfg = resolveStateConfig(order.state, PURCHASE_ORDER_STATES);

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
              {t('purchases.orders.orderTitle')} #{order.sequentialNumber}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('purchases.orders.createdAt')}: {formatDate(order.createdAt)}
            </p>
          </div>
        </div>
        <span className={`pos-badge ${stateCfg.className}`}>
          {stateCfg.label}
        </span>
      </div>

      {/* Supplier info card */}
      <div className="pos-panel p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          {t('purchases.orders.supplierInfo')}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.orders.supplier')}</span>
            <span className="font-medium">{order.supplier.businessName}</span>
          </div>
          {order.expectedDeliveryDate && (
            <div>
              <span className="block text-xs text-gray-500">{t('purchases.orders.expectedDeliveryDate')}</span>
              <span className="font-data tabular-nums">{formatShortDate(order.expectedDeliveryDate)}</span>
            </div>
          )}
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.orders.subtotal')}</span>
            <span className="font-data tabular-nums font-semibold">{formatCOP(order.subtotal)}</span>
          </div>
          <div>
            <span className="block text-xs text-gray-500">{t('purchases.orders.total')}</span>
            <span className="font-data tabular-nums font-bold">{formatCOP(order.totalAmount)}</span>
          </div>
        </div>
        {order.notes && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <span className="block text-xs text-gray-500 mb-1">{t('purchases.orders.notes')}</span>
            <p className="text-sm text-gray-700">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Items table */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        {t('purchases.orders.items')}
      </h3>
      <div className="pos-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b text-left text-gray-500 text-xs uppercase tracking-wider bg-gray-50/50">
              <th className="py-2 px-3 font-semibold">{t('purchases.orders.product')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.orders.requestedQty')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.orders.receivedQty')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.orders.unitCost')}</th>
              <th className="py-2 px-3 font-semibold text-right">{t('purchases.orders.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/30">
                <td className="py-3 px-3 font-medium">
                  {item.productId}
                </td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{item.requestedQuantity}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{item.receivedQuantity}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums">{formatCOP(item.expectedUnitCost)}</td>
                <td className="py-3 px-3 text-right font-data tabular-nums font-semibold">
                  {formatCOP(item.requestedQuantity * item.expectedUnitCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Timeline info */}
      <div className="mt-6 flex gap-4 text-xs text-gray-500">
        {order.confirmedAt && (
          <span>
            {t('purchases.orders.confirmedAt')}: {formatDate(order.confirmedAt)}
          </span>
        )}
        {order.annulledAt && (
          <span className="text-error">
            {t('purchases.orders.annulledAt')}: {formatDate(order.annulledAt)}
          </span>
        )}
      </div>
    </div>
  );
};
