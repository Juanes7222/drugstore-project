/**
 * Clients export definition — full client dataset, optionally filtered by
 * the screen's search query.
 *
 * Column headers are the canonical `CLIENT_IMPORT_COLUMNS` labels, so an
 * exported file round-trips through the data-import pipeline unchanged.
 */

import { CLIENT_IMPORT_COLUMNS } from '@pharmacy/shared-validation';
import type { ExportColumn } from '../../../common/export';
import type {
  ExportDefinition,
  ExportServiceContext,
} from '../export.types';
import { collectOffset } from './collect';

export interface ClientsExportArgs {
  query?: string;
}

/** Column type per canonical import key.  Numeric import columns stay raw
 *  text — the importer's schemas expect plain digits, not formatted
 *  currency. */
const COLUMN_TYPE: Record<string, ExportColumn['type']> = {
  fullName: 'text',
  identificationType: 'text',
  identificationNumber: 'text',
  email: 'text',
  phone: 'text',
  address: 'text',
  municipality: 'text',
  department: 'text',
  creditLimit: 'text',
};

/** Derived from the import contract so export and import never diverge. */
const COLUMNS: readonly ExportColumn[] = CLIENT_IMPORT_COLUMNS.map(
  (column) => ({
    id: column.key,
    titleKey: `export.cols.${column.key}`,
    header: column.label,
    type: COLUMN_TYPE[column.key] ?? 'text',
  }),
);

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
      creditLimit: row.creditLimit != null ? String(row.creditLimit) : '',
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