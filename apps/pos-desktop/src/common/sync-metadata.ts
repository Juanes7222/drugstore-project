/**
 * Persistent sync-timestamp store.
 *
 * Keeps the last-successful-sync timestamp for every pull-based sync
 * operation (catalog, inventory lots, clients, …) in a single `localStorage`
 * key so a reader can query any field without caring about which module
 * does the writing.
 *
 * Fields
 * ------
 * - `catalogLastSyncedAt` – written by `CatalogSyncService.pullCatalog()`
 * - `lotsLastSyncedAt` – written by `LotSyncService.pullLots()`
 * - `clientsLastSyncedAt` – written by `ClientPullService.pullClients()`
 */

const STORAGE_KEY = 'pharmacy_sync_metadata';

interface SyncMetadataRecord {
  catalogLastSyncedAt: string | null;
  lotsLastSyncedAt: string | null;
  clientsLastSyncedAt: string | null;
}

const DEFAULTS: SyncMetadataRecord = {
  catalogLastSyncedAt: null,
  lotsLastSyncedAt: null,
  clientsLastSyncedAt: null,
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
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
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
