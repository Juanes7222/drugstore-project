/**
 * Purchase-receptions export definition — full reception dataset, one row
 * per reception (line items are not flattened).
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectPages } from './collect';

export interface PurchaseReceptionsExportArgs {
  // No screen filters today — kept for future filter support.
  [key: string]: unknown;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'sequentialNumber', titleKey: 'export.cols.sequentialNumber', type: 'integer', align: 'right' },
  { id: 'supplierName', titleKey: 'export.cols.supplier', type: 'text', align: 'left' },
  { id: 'purchaseOrderNumber', titleKey: 'export.cols.purchaseOrder', type: 'integer', align: 'right' },
  { id: 'state', titleKey: 'export.cols.state', type: 'text', align: 'left' },
  { id: 'itemCount', titleKey: 'export.cols.itemCount', type: 'integer', align: 'right' },
  { id: 'subtotal', titleKey: 'export.cols.subtotal', type: 'currency', align: 'right' },
  { id: 'totalTax', titleKey: 'export.cols.tax', type: 'currency', align: 'right' },
  { id: 'totalAmount', titleKey: 'export.cols.total', type: 'currency', align: 'right' },
  { id: 'receivedAt', titleKey: 'export.cols.receivedAt', type: 'datetime', align: 'left' },
];

export const PURCHASE_RECEPTIONS_EXPORT: ExportDefinition<PurchaseReceptionsExportArgs> = {
  key: 'purchase-receptions',
  titleKey: 'export.screens.purchaseReceptions.title',
  titleFallback: 'Recepciones de compra',
  columns: COLUMNS,

  async load(services: ExportServiceContext) {
    const rows = await collectPages(
      (page, pageSize) =>
        services.purchaseReceptionsService.listReceptions({
          page,
          pageSize,
        }),
    );

    return rows.map((row) => ({
      sequentialNumber: row.sequentialNumber,
      supplierName: row.supplier?.businessName ?? '',
      purchaseOrderNumber: row.purchaseOrder?.sequentialNumber ?? null,
      state: row.state,
      itemCount: Array.isArray(row.items) ? row.items.length : 0,
      subtotal: row.subtotal,
      totalTax: row.totalTax,
      totalAmount: row.totalAmount,
      receivedAt: row.receivedAt ?? row.createdAt,
    }));
  },

  metadata() {
    return [];
  },
};