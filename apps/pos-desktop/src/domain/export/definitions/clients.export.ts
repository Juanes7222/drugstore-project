/**
 * Clients export definition — full client dataset, optionally filtered by
 * the screen's search query, one row per client.
 */

import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectOffset } from './collect';

export interface ClientsExportArgs {
  query?: string;
}

const COLUMNS: readonly ExportColumn[] = [
  { id: 'fullName', titleKey: 'export.cols.fullName', type: 'text', align: 'left' },
  { id: 'identificationType', titleKey: 'export.cols.idType', type: 'text', align: 'left' },
  { id: 'identificationNumber', titleKey: 'export.cols.idNumber', type: 'text', align: 'left' },
  { id: 'email', titleKey: 'export.cols.email', type: 'text', align: 'left' },
  { id: 'phone', titleKey: 'export.cols.phone', type: 'text', align: 'left' },
  { id: 'address', titleKey: 'export.cols.address', type: 'text', align: 'left' },
  { id: 'municipality', titleKey: 'export.cols.municipality', type: 'text', align: 'left' },
  { id: 'department', titleKey: 'export.cols.department', type: 'text', align: 'left' },
  { id: 'creditLimit', titleKey: 'export.cols.creditLimit', type: 'currency', align: 'right' },
  { id: 'isActive', titleKey: 'export.cols.isActive', type: 'text', align: 'left' },
  { id: 'createdAt', titleKey: 'export.cols.createdAt', type: 'date', align: 'left' },
];

export const CLIENTS_EXPORT: ExportDefinition<ClientsExportArgs> = {
  key: 'clients',
  titleKey: 'export.screens.clients.title',
  titleFallback: 'Clientes',
  columns: COLUMNS,

  async load(services: ExportServiceContext, args) {
    const rows = await collectOffset(
      (offset, limit) =>
        services.clientsService.listClients({
          query: args.query?.trim() || undefined,
          limit,
          offset,
        }),
    );

    return rows.map((row) => ({
      fullName: row.fullName,
      identificationType: row.identificationType,
      identificationNumber: row.identificationNumber,
      email: row.email ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
      municipality: row.municipality ?? '',
      department: row.department ?? '',
      creditLimit: row.creditLimit ?? 0,
      isActive: row.isActive,
      createdAt: row.createdAt,
    }));
  },

  metadata(args) {
    if (!args.query?.trim()) {
      return [];
    }
    return [
      ['export.meta.search', 'Búsqueda', args.query.trim()] as const,
    ];
  },
};