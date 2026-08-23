/**
 * Products export definition — full product dataset honoring the screen's
 * client-side filters (search, category, inactive toggle).
 *
 * Column headers are the canonical `PRODUCT_IMPORT_COLUMNS` labels and the
 * loader emits the import row keys, so an exported file round-trips through
 * the data-import pipeline unchanged (including the required
 * `taxSchemeName` and a `saleType` in the Spanish aliases the importer
 * accepts).
 */

import { PRODUCT_IMPORT_COLUMNS } from '@pharmacy/shared-validation';
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

/** Column type per canonical import key.  Numeric import columns stay raw
 *  text — the importer's schemas expect plain digits, not formatted
 *  currency or thousands separators. */
const COLUMN_TYPE: Record<string, ExportColumn['type']> = {
  internalCode: 'text',
  commercialName: 'text',
  laboratory: 'text',
  concentration: 'text',
  concentrationUnit: 'text',
  saleType: 'text',
  minimumStock: 'text',
  invimaRegistry: 'text',
  atcCode: 'text',
  categoryName: 'text',
  pharmaceuticalFormName: 'text',
  initialPrice: 'text',
  initialCost: 'text',
  taxSchemeName: 'text',
};

/** Derived from the import contract so export and import never diverge. */
const COLUMNS: readonly ExportColumn[] = PRODUCT_IMPORT_COLUMNS.map(
  (column) => ({
    id: column.key,
    titleKey: `export.cols.${column.key}`,
    header: column.label,
    type: COLUMN_TYPE[column.key] ?? 'text',
  }),
);

/** SaleType → the Spanish alias the product import schema accepts. */
const SALE_TYPE_IMPORT_ALIAS: Record<string, string> = {
  FREE_SALE: 'libre',
  PRESCRIPTION: 'prescripcion',
  CONTROLLED_SUBSTANCE: 'controlado',
};

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
      .map((row) => ({
        internalCode: row.internalCode,
        commercialName: row.commercialName,
        laboratory: row.laboratory,
        concentration: row.concentration ?? '',
        concentrationUnit: row.concentrationUnit ?? '',
        saleType:
          SALE_TYPE_IMPORT_ALIAS[row.saleType] ?? row.saleType,
        minimumStock: String(row.minimumStock),
        invimaRegistry: row.invimaRegistry ?? '',
        atcCode: row.atcCode ?? '',
        categoryName: row.categoryName ?? '',
        pharmaceuticalFormName: row.pharmaceuticalFormName ?? '',
        initialPrice: row.currentPrice ?? '',
        initialCost: row.currentCost ?? '',
        taxSchemeName: row.currentTaxSchemeName ?? '',
      }));
  },

  metadata(args) {
    const meta: Array<readonly [string, string, string]> = [];
    if (args.query?.trim()) {
      meta.push(['export.meta.search', 'Búsqueda', args.query.trim()]);
    }
    return meta;
  },
};