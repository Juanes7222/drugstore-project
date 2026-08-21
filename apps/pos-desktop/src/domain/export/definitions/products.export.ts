/**
 * Products export definition — full product dataset honoring the screen's
 * client-side filters (search, category, inactive toggle), one row per
 * product.
 *
 * The screen filters in memory over a full `listProducts` load; the export
 * reproduces the same semantics so the exported file matches the grid.
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectOffset } from './collect';

export interface ProductsExportArgs {
  query?: string;
  categoryId?: string;
  showInactive?: boolean;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'internalCode', titleKey: 'export.cols.internalCode', type: 'text', align: 'left' },
  { id: 'commercialName', titleKey: 'export.cols.commercialName', type: 'text', align: 'left' },
  { id: 'concentration', titleKey: 'export.cols.concentration', type: 'text', align: 'left' },
  { id: 'laboratory', titleKey: 'export.cols.laboratory', type: 'text', align: 'left' },
  { id: 'primaryBarcode', titleKey: 'export.cols.barcode', type: 'text', align: 'left' },
  { id: 'currentPrice', titleKey: 'export.cols.salePrice', type: 'currency', align: 'right' },
  { id: 'currentCost', titleKey: 'export.cols.cpp', type: 'currency', align: 'right' },
  { id: 'minimumStock', titleKey: 'export.cols.minimumStock', type: 'integer', align: 'right' },
  { id: 'isActive', titleKey: 'export.cols.isActive', type: 'text', align: 'left' },
];

const matchesQuery = (
  row: {
    commercialName: string;
    internalCode: string;
    laboratory: string;
    barcodes?: Array<{ barcode: string }>;
  },
  query: string,
): boolean => {
  const q = query.toLowerCase();
  const barcodeMatch = (row.barcodes ?? []).some((bc) =>
    bc.barcode.toLowerCase().includes(q),
  );
  return (
    String(row.commercialName ?? '').toLowerCase().includes(q) ||
    String(row.internalCode ?? '').toLowerCase().includes(q) ||
    String(row.laboratory ?? '').toLowerCase().includes(q) ||
    barcodeMatch
  );
};

export const PRODUCTS_EXPORT: ExportDefinition<ProductsExportArgs> = {
  key: 'products',
  titleKey: 'export.screens.products.title',
  titleFallback: 'Productos',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    // Always load active + inactive: the screen decides visibility.
    const rows = await collectOffset(
      (offset, limit) =>
        services.productService.listProducts({
          includeInactive: true,
          limit,
          offset,
        }),
    );

    const query = args.query?.trim();
    const showInactive = args.showInactive ?? false;

    return rows
      .filter((row) => {
        if (args.categoryId && row.categoryId !== args.categoryId) {
          return false;
        }
        if (!showInactive && row.isActive === false) {
          return false;
        }
        if (query && !matchesQuery(row, query)) {
          return false;
        }
        return true;
      })
      .map((row) => {
        const barcodes = (row.barcodes as
          | Array<{ barcode: string; isPrimary: boolean }>
          | undefined) ?? [];
        const primary =
          barcodes.find((bc) => bc.isPrimary) ?? barcodes[0];

        return {
          internalCode: row.internalCode,
          commercialName: row.commercialName,
          concentration: row.concentration ?? '',
          laboratory: row.laboratory,
          primaryBarcode: primary?.barcode ?? '',
          currentPrice: row.currentPrice ?? 0,
          currentCost: row.currentCost ?? 0,
          minimumStock: row.minimumStock,
          isActive: row.isActive,
        };
      });
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.query?.trim()) {
      meta.push(['export.meta.search', 'Búsqueda', args.query.trim()]);
    }
    return meta;
  },
};