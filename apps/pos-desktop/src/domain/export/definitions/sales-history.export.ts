/**
 * Sales-history export definition — confirmed sales matching the current
 * screen filters, one row per sale.
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectOffset } from './collect';

export interface SalesHistoryExportArgs {
  since?: Date;
  until?: Date;
  clientId?: string;
  query?: string;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'confirmedAt', titleKey: 'export.cols.confirmedAt', type: 'datetime', align: 'left' },
  { id: 'localNumber', titleKey: 'export.cols.localNumber', type: 'text', align: 'left' },
  { id: 'clientName', titleKey: 'export.cols.client', type: 'text', align: 'left' },
  { id: 'clientIdentificationNumber', titleKey: 'export.cols.clientIdNumber', type: 'text', align: 'left' },
  { id: 'totalAmount', titleKey: 'export.cols.total', type: 'currency', align: 'right' },
  { id: 'invoiceNumber', titleKey: 'export.cols.invoiceNumber', type: 'text', align: 'left' },
  { id: 'invoiceStatus', titleKey: 'export.cols.invoiceStatus', type: 'text', align: 'left' },
  { id: 'deliveryFee', titleKey: 'export.cols.deliveryFee', type: 'currency', align: 'right' },
];

export const SALES_HISTORY_EXPORT: ExportDefinition<SalesHistoryExportArgs> = {
  key: 'sales-history',
  titleKey: 'export.screens.salesHistory.title',
  titleFallback: 'Historial de ventas',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const rows = await collectOffset(
      (offset, limit) =>
        services.salesHistoryService.listConfirmedSales({
          since: args.since,
          until: args.until,
          clientId: args.clientId,
          query: args.query,
          limit,
          offset,
        }),
    );

    return rows.map((row) => ({
      confirmedAt: row.confirmedAt,
      localNumber: row.localNumber,
      clientName: row.clientName,
      clientIdentificationNumber: row.clientIdentificationNumber ?? '',
      totalAmount: row.totalAmount,
      invoiceNumber: row.invoiceNumber ?? '',
      invoiceStatus: row.invoiceStatus ?? '',
      // Delivery fee arrives in COP cents; the currency formatter expects pesos.
      deliveryFee: (Number(row.deliveryFeeCents) || 0) / 100,
    }));
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.since) {
      meta.push([
        'export.meta.from',
        'Desde',
        args.since.toLocaleDateString('es-CO'),
      ]);
    }
    if (args.until) {
      meta.push([
        'export.meta.to',
        'Hasta',
        args.until.toLocaleDateString('es-CO'),
      ]);
    }
    if (args.query) {
      meta.push(['export.meta.search', 'Búsqueda', args.query]);
    }
    return meta;
  },
};