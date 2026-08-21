/**
 * Inventory-lots export definition — every lot matching the screen's
 * search/state filters, one row per lot (the grid groups by product; the
 * export flattens to the lot level so stock units stay unambiguous).
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';

export interface InventoryLotsExportArgs {
  search?: string;
  state?: string;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'commercialName', titleKey: 'export.cols.commercialName', type: 'text', align: 'left' },
  { id: 'internalCode', titleKey: 'export.cols.internalCode', type: 'text', align: 'left' },
  { id: 'batchNumber', titleKey: 'export.cols.batchNumber', type: 'text', align: 'left' },
  { id: 'locationCode', titleKey: 'export.cols.location', type: 'text', align: 'left' },
  { id: 'currentStock', titleKey: 'export.cols.stock', type: 'integer', align: 'right' },
  { id: 'expirationDate', titleKey: 'export.cols.expirationDate', type: 'date', align: 'left' },
  { id: 'state', titleKey: 'export.cols.state', type: 'text', align: 'left' },
];

export const INVENTORY_LOTS_EXPORT: ExportDefinition<InventoryLotsExportArgs> = {
  key: 'inventory-lots',
  titleKey: 'export.screens.inventoryLots.title',
  titleFallback: 'Inventario por lotes',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const lots = await services.inventoryLotsService.getLots({
      search: args.search?.trim() || undefined,
      state: args.state || undefined,
    });

    return lots.map((lot) => ({
      commercialName: lot.product?.commercialName ?? '',
      internalCode: lot.product?.internalCode ?? '',
      batchNumber: lot.batchNumber,
      locationCode: lot.locationCode ?? '',
      currentStock: lot.currentStock,
      expirationDate: lot.expirationDate,
      state: lot.state,
    }));
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.search?.trim()) {
      meta.push(['export.meta.search', 'Búsqueda', args.search.trim()]);
    }
    if (args.state) {
      meta.push(['export.meta.state', 'Estado', args.state]);
    }
    return meta;
  },
};