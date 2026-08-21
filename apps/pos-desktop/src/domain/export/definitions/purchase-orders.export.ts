/**
 * Purchase-orders export definition — full purchase-order dataset, one row
 * per order (line items are not flattened).
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectPages } from './collect';

export interface PurchaseOrdersExportArgs {
  supplierId?: string;
  state?: string;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'sequentialNumber', titleKey: 'export.cols.sequentialNumber', type: 'integer', align: 'right' },
  { id: 'supplierName', titleKey: 'export.cols.supplier', type: 'text', align: 'left' },
  { id: 'state', titleKey: 'export.cols.state', type: 'text', align: 'left' },
  { id: 'itemCount', titleKey: 'export.cols.itemCount', type: 'integer', align: 'right' },
  { id: 'subtotal', titleKey: 'export.cols.subtotal', type: 'currency', align: 'right' },
  { id: 'totalTax', titleKey: 'export.cols.tax', type: 'currency', align: 'right' },
  { id: 'totalAmount', titleKey: 'export.cols.total', type: 'currency', align: 'right' },
  { id: 'createdAt', titleKey: 'export.cols.createdAt', type: 'datetime', align: 'left' },
  { id: 'expectedDeliveryDate', titleKey: 'export.cols.expectedDelivery', type: 'date', align: 'left' },
];

export const PURCHASE_ORDERS_EXPORT: ExportDefinition<PurchaseOrdersExportArgs> = {
  key: 'purchase-orders',
  titleKey: 'export.screens.purchaseOrders.title',
  titleFallback: 'Órdenes de compra',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const rows = await collectPages(
      (page, pageSize) =>
        services.purchaseOrdersService.listOrders({
          supplierId: args.supplierId || undefined,
          state: args.state || undefined,
          page,
          pageSize,
        }),
    );

    return rows.map((row) => ({
      sequentialNumber: row.sequentialNumber,
      supplierName: row.supplier?.businessName ?? '',
      state: row.state,
      itemCount: Array.isArray(row.items) ? row.items.length : 0,
      subtotal: row.subtotal,
      totalTax: row.totalTax,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      expectedDeliveryDate: row.expectedDeliveryDate ?? '',
    }));
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.state) {
      meta.push(['export.meta.state', 'Estado', args.state]);
    }
    return meta;
  },
};