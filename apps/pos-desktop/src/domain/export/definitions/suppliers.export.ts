/**
 * Suppliers export definition — full supplier dataset, optionally filtered
 * by the screen's search/active state, one row per supplier.
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectPages } from './collect';

export interface SuppliersExportArgs {
  search?: string;
  isActive?: boolean;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'businessName', titleKey: 'export.cols.businessName', type: 'text', align: 'left' },
  { id: 'identificationType', titleKey: 'export.cols.idType', type: 'text', align: 'left' },
  { id: 'identificationNumber', titleKey: 'export.cols.idNumber', type: 'text', align: 'left' },
  { id: 'contactName', titleKey: 'export.cols.contactName', type: 'text', align: 'left' },
  { id: 'phone', titleKey: 'export.cols.phone', type: 'text', align: 'left' },
  { id: 'email', titleKey: 'export.cols.email', type: 'text', align: 'left' },
  { id: 'city', titleKey: 'export.cols.city', type: 'text', align: 'left' },
  { id: 'country', titleKey: 'export.cols.country', type: 'text', align: 'left' },
  { id: 'address', titleKey: 'export.cols.address', type: 'text', align: 'left' },
  { id: 'paymentTermsDays', titleKey: 'export.cols.paymentTermsDays', type: 'integer', align: 'right' },
  { id: 'creditLimit', titleKey: 'export.cols.creditLimit', type: 'currency', align: 'right' },
  { id: 'isActive', titleKey: 'export.cols.isActive', type: 'text', align: 'left' },
];

export const SUPPLIERS_EXPORT: ExportDefinition<SuppliersExportArgs> = {
  key: 'suppliers',
  titleKey: 'export.screens.suppliers.title',
  titleFallback: 'Proveedores',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const rows = await collectPages(
      (page, pageSize) =>
        services.suppliersService.listSuppliers({
          search: args.search?.trim() || undefined,
          isActive: args.isActive,
          page,
          pageSize,
        }),
    );

    return rows.map((row) => ({
      businessName: row.businessName,
      identificationType: row.identificationType,
      identificationNumber: row.identificationNumber,
      contactName: row.contactName ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      city: row.city ?? '',
      country: row.country ?? '',
      address: row.address ?? '',
      paymentTermsDays: row.paymentTermsDays,
      creditLimit: row.creditLimit,
      isActive: row.isActive,
    }));
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.search?.trim()) {
      meta.push(['export.meta.search', 'Búsqueda', args.search.trim()]);
    }
    return meta;
  },
};