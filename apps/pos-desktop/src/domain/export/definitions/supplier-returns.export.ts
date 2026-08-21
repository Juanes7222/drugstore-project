/**
 * Supplier-returns export definition — full supplier-return dataset, one
 * row per return document (line items are not flattened).
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectPages } from './collect';

export interface SupplierReturnsExportArgs {
  supplierId?: string;
  state?: string;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'sequentialNumber', titleKey: 'export.cols.sequentialNumber', type: 'integer', align: 'right' },
  { id: 'supplierName', titleKey: 'export.cols.supplier', type: 'text', align: 'left' },
  { id: 'state', titleKey: 'export.cols.state', type: 'text', align: 'left' },
  { id: 'reason', titleKey: 'export.cols.reason', type: 'text', align: 'left' },
  { id: 'itemCount', titleKey: 'export.cols.itemCount', type: 'integer', align: 'right' },
  { id: 'subtotal', titleKey: 'export.cols.subtotal', type: 'currency', align: 'right' },
  { id: 'totalTax', titleKey: 'export.cols.tax', type: 'currency', align: 'right' },
  { id: 'totalAmount', titleKey: 'export.cols.total', type: 'currency', align: 'right' },
  { id: 'createdAt', titleKey: 'export.cols.createdAt', type: 'datetime', align: 'left' },
];

export const SUPPLIER_RETURNS_EXPORT: ExportDefinition<SupplierReturnsExportArgs> = {
  key: 'supplier-returns',
  titleKey: 'export.screens.supplierReturns.title',
  titleFallback: 'Devoluciones a proveedor',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const rows = await collectPages(
      (page, pageSize) =>
        services.supplierReturnsService.listReturns({
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
      reason: row.reason ?? '',
      itemCount: Array.isArray(row.items) ? row.items.length : 0,
      subtotal: row.subtotal,
      totalTax: row.totalTax,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
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