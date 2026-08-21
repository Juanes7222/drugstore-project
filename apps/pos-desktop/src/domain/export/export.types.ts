/**
 * Data-export pipeline types — generic export documents and per-screen
 * export definitions.
 *
 * The pipeline renders any flat dataset (columns + rows) to CSV, Excel,
 * PDF, or a print window.  Per-screen definitions (one per listado screen)
 * pair a column set with a loader that pulls the full dataset from the
 * domain services.
 */

import type {
  ExportColumn,
  ExportRow,
  ExportTranslator,
} from '../../common/export';
import type { ClientSearchResult } from '../clients/clients.service';
import type { ProductListItem } from '../catalog/product.service';
import type { LotWithProduct } from '../inventory-lots/inventory-lots.service';
import type { PurchaseOrderResult } from '../purchases/purchase-orders.service';
import type { ReceptionResult } from '../purchases/purchase-receptions.service';
import type { SupplierReturnResult } from '../purchases/supplier-returns.service';
import type { SupplierSearchResult } from '../purchases/suppliers.service';
import type { SaleHistoryListItem } from '../sales-pos/sales-history.service';

/**
 * Minimal service surface the export loaders need.  A structural subset of
 * the full `Services` object — the `useDataExport` hook passes the whole
 * `Services` instance and this interface is what the loaders see.
 */
export interface ExportServiceContext {
  salesHistoryService: {
    listConfirmedSales(filters?: {
      since?: Date;
      until?: Date;
      clientId?: string;
      query?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ items: SaleHistoryListItem[]; total: number }>;
  };
  clientsService: {
    listClients(params?: {
      query?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ items: ClientSearchResult[]; total: number }>;
  };
  productService: {
    listProducts(params?: {
      query?: string;
      includeInactive?: boolean;
      categoryId?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ items: ProductListItem[]; total: number }>;
  };
  inventoryLotsService: {
    getLots(params?: {
      productId?: string;
      search?: string;
      state?: string;
    }): Promise<LotWithProduct[]>;
  };
  suppliersService: {
    listSuppliers(params?: {
      search?: string;
      isActive?: boolean;
      page?: number;
      pageSize?: number;
    }): Promise<{ data: SupplierSearchResult[]; total: number }>;
  };
  purchaseOrdersService: {
    listOrders(params?: {
      supplierId?: string;
      state?: string;
      page?: number;
      pageSize?: number;
    }): Promise<{ data: PurchaseOrderResult[]; total: number }>;
  };
  purchaseReceptionsService: {
    listReceptions(params?: {
      page?: number;
      pageSize?: number;
    }): Promise<{ data: ReceptionResult[]; total: number }>;
  };
  supplierReturnsService: {
    listReturns(params?: {
      supplierId?: string;
      state?: string;
      page?: number;
      pageSize?: number;
    }): Promise<{ data: SupplierReturnResult[]; total: number }>;
  };
}

/** A rendered export document — everything the renderers need. */
export interface ExportDocument {
  /** i18n key for the document title (screen name). */
  titleKey: string;
  /** Fallback title when the key is missing or no translator is given. */
  titleFallback: string;
  /** i18n key for an optional subtitle (e.g. the applied filters). */
  subtitleKey?: string;
  subtitleFallback?: string;
  columns: readonly ExportColumn[];
  rows: readonly ExportRow[];
  locale?: string;
  /** ISO timestamp of the export; defaults to `new Date().toISOString()`. */
  generatedAt?: string;
  userDisplayName?: string;
  t?: ExportTranslator;
  /** Label/value pairs rendered as metadata (period, filters, counts). */
  metadata?: ReadonlyArray<
    readonly [labelKey: string, labelFallback: string, value: string]
  >;
}

/** Static per-screen export definition (columns + full-dataset loader). */
export interface ExportDefinition<TArgs = void> {
  /** Stable identifier, also used as the filename prefix. */
  key: string;
  titleKey: string;
  titleFallback: string;
  columns: readonly ExportColumn[];
  /** Pull the full dataset, honoring the screen's current filters. */
  load: (
    services: ExportServiceContext,
    args: TArgs,
  ) => Promise<readonly ExportRow[]>;
  /** Optional metadata rows describing the applied filters. */
  metadata?: (
    args: TArgs,
    t?: ExportTranslator,
  ) => ReadonlyArray<readonly [string, string, string]>;
}