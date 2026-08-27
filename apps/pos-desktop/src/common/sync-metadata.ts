/**
 * Persistent sync-timestamp store.
 *
 * Keeps the last-successful-sync timestamp for every pull-based sync
 * operation (catalog, inventory lots, clients, client-classifications, …)
 * in a single `localStorage` record so a reader can query any field without
 * caring about which module does the writing.
 *
 * Fields
 * ------
 * - `catalogLastSyncedAt` – written by `CatalogSyncService.pullCatalog()`
 * - `lotsLastSyncedAt` – written by `LotSyncService.pullLots()`
 * - `clientsLastSyncedAt` – written by `ClientPullService.pullClients()`
 * - `classificationsLastSyncedAt` – written by `ClientPullService.pullClassifications()`
 *
 * Scoping
 * -------
 * The record is keyed to the LOCAL DATABASE's install id
 * (`getLocalDatabaseInstallId`, persisted in `_SchemaMeta`). A sync cursor
 * describes the state of one specific database — reusing it against a
 * different database makes the server send only "recent" changes while the
 * local mirror is empty, which silently starves the POS of data. This is
 * exactly what happened when the devtools database reset wiped IndexedDB
 * while the old cursor survived in localStorage. Keying by install id makes
 * every fresh database start with null cursors (one full pull) without
 * needing the reset path to know about this store.
 */

import { getLocalDatabaseInstallId } from '../infrastructure/local-database';

const STORAGE_KEY = 'pharmacy_sync_metadata';

/**
 * Storage key scoped to the current database install. Falls back to a fixed
 * suffix before initialization (or after close) — reads then return defaults,
 * which is the safe behavior: no cursor means a full pull.
 */
const scopedStorageKey = (): string => {
  const installId = getLocalDatabaseInstallId();
  return `${STORAGE_KEY}__${installId ?? 'uninitialized'}`;
};

interface SyncMetadataRecord {
  catalogLastSyncedAt: string | null;
  lotsLastSyncedAt: string | null;
  clientsLastSyncedAt: string | null;
  classificationsLastSyncedAt: string | null;
  suppliersLastSyncedAt: string | null;
  purchaseOrdersLastSyncedAt: string | null;
  purchaseReceptionsLastSyncedAt: string | null;
  supplierReturnsLastSyncedAt: string | null;
  salesLastSyncedAt: string | null;
  invoicesLastSyncedAt: string | null;
  invoiceAdjustmentsLastSyncedAt: string | null;
}

const DEFAULTS: SyncMetadataRecord = {
  catalogLastSyncedAt: null,
  lotsLastSyncedAt: null,
  clientsLastSyncedAt: null,
  classificationsLastSyncedAt: null,
  suppliersLastSyncedAt: null,
  purchaseOrdersLastSyncedAt: null,
  purchaseReceptionsLastSyncedAt: null,
  supplierReturnsLastSyncedAt: null,
  salesLastSyncedAt: null,
  invoicesLastSyncedAt: null,
  invoiceAdjustmentsLastSyncedAt: null,
};

/**
 * Read the current sync-metadata record from `localStorage`.
 * Returns the defaults when nothing has been persisted yet.
 *
 * Exported for testing; prefer the field-specific getters in production.
 */
export const readSyncMetadata = (): SyncMetadataRecord => {
  if (typeof localStorage === 'undefined') {
    return { ...DEFAULTS };
  }
  try {
    const raw = localStorage.getItem(scopedStorageKey());
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<SyncMetadataRecord>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
};

/**
 * Persist the full metadata record.
 */
const writeSyncMetadata = (record: SyncMetadataRecord): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(scopedStorageKey(), JSON.stringify(record));
  } catch {
    // localStorage full or disabled — best-effort only.
  }
};

/**
 * Return the ISO-8601 timestamp of the last successful catalog sync,
 * or `null` if it has never been performed.
 */
export const getCatalogLastSyncedAt = (): string | null => {
  return readSyncMetadata().catalogLastSyncedAt;
};

/**
 * Return the ISO-8601 timestamp of the last successful inventory-lot sync,
 * or `null` if it has never been performed.
 */
export const getLotsLastSyncedAt = (): string | null => {
  return readSyncMetadata().lotsLastSyncedAt;
};

/**
 * Persist a new top-of-sync timestamp for the catalog puller.
 */
export const setCatalogLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.catalogLastSyncedAt = iso;
  writeSyncMetadata(record);
};

/**
 * Persist a new top-of-sync timestamp for the lot puller.
 */
export const setLotsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.lotsLastSyncedAt = iso;
  writeSyncMetadata(record);
};

/**
 * Return the ISO-8601 timestamp of the last successful client pull,
 * or `null` if it has never been performed.
 */
export const getClientsLastSyncedAt = (): string | null => {
  return readSyncMetadata().clientsLastSyncedAt;
};

/**
 * Persist a new top-of-sync timestamp for the client puller.
 */
export const setClientsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.clientsLastSyncedAt = iso;
  writeSyncMetadata(record);
};

/**
 * Return the ISO-8601 timestamp of the last successful classification sync,
 * or `null` if it has never been performed.
 */
export const getClassificationsLastSyncedAt = (): string | null => {
  return readSyncMetadata().classificationsLastSyncedAt;
};

/**
 * Persist a new top-of-sync timestamp for the classification puller.
 */
export const setClassificationsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.classificationsLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getSuppliersLastSyncedAt = (): string | null =>
  readSyncMetadata().suppliersLastSyncedAt;

export const setSuppliersLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.suppliersLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getPurchaseOrdersLastSyncedAt = (): string | null =>
  readSyncMetadata().purchaseOrdersLastSyncedAt;

export const setPurchaseOrdersLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.purchaseOrdersLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getPurchaseReceptionsLastSyncedAt = (): string | null =>
  readSyncMetadata().purchaseReceptionsLastSyncedAt;

export const setPurchaseReceptionsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.purchaseReceptionsLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getSupplierReturnsLastSyncedAt = (): string | null =>
  readSyncMetadata().supplierReturnsLastSyncedAt;

export const setSupplierReturnsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.supplierReturnsLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getSalesLastSyncedAt = (): string | null =>
  readSyncMetadata().salesLastSyncedAt;

export const setSalesLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.salesLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getInvoicesLastSyncedAt = (): string | null =>
  readSyncMetadata().invoicesLastSyncedAt;

export const setInvoicesLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.invoicesLastSyncedAt = iso;
  writeSyncMetadata(record);
};

export const getInvoiceAdjustmentsLastSyncedAt = (): string | null =>
  readSyncMetadata().invoiceAdjustmentsLastSyncedAt;

export const setInvoiceAdjustmentsLastSyncedAt = (iso: string): void => {
  const record = readSyncMetadata();
  record.invoiceAdjustmentsLastSyncedAt = iso;
  writeSyncMetadata(record);
};
