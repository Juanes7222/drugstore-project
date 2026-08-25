import { Readable } from 'node:stream';

/**
 * Storage-agnostic blob operations used by domain services. Keys are
 * slash-separated object paths scoped to the provider's root (local driver)
 * or bucket (R2 driver); callers never see filesystem or S3 details.
 */
export interface ObjectStorage {
  /**
   * Stores the body under the given key, creating intermediate namespaces.
   */
  put(key: string, body: Readable | Buffer): Promise<void>;

  /** Reads the whole object into memory (small payloads only). */
  get(key: string): Promise<Buffer>;

  /** Opens the object as a readable stream (large payloads/downloads). */
  getStream(key: string): Promise<Readable>;

  /** True when an object exists at the exact key. */
  exists(key: string): Promise<boolean>;

  /** Deletes a single object; a missing object is not an error. */
  remove(key: string): Promise<void>;

  /**
   * Deletes every object under the given prefix ("directory" semantics).
   * A prefix matching nothing is not an error.
   */
  removePrefix(prefix: string): Promise<void>;
}

/**
 * Backup-scope storage: encrypted terminal backups uploaded by POS
 * workstations. Local driver roots at BACKUP_STORAGE_PATH; R2 driver uses
 * the dedicated pharmacy-backups credentials/bucket.
 */
export const BACKUP_OBJECT_STORAGE = Symbol('BACKUP_OBJECT_STORAGE');

/**
 * Updates-scope storage: published POS update binaries. Local driver roots
 * at UPDATE_STORAGE_PATH; R2 driver uses the pharmacy-updates credentials.
 */
export const UPDATES_OBJECT_STORAGE = Symbol('UPDATES_OBJECT_STORAGE');

const MAX_KEY_LENGTH = 1024;

/**
 * Rejects keys that could escape the namespace: path separators other than
 * '/', traversal segments, control characters, and empty segments. Both
 * drivers call this defensively — on R2 a malicious key cannot escape, but
 * consistent rejection keeps keys portable across drivers.
 */
export function assertSafeObjectKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new Error(`Object storage key has invalid length: ${key.length}`);
  }
  if (key.includes('\\')) {
    throw new Error(`Object storage key must use '/' separators: ${key}`);
  }
  if (/[\x00-\x1f\x7f]/.test(key)) {
    throw new Error(`Object storage key contains control characters: ${key}`);
  }
  const segments = key.split('/');
  const isTraversal = segments.some(
    (segment) => segment.length === 0 || segment === '.' || segment === '..',
  );
  if (isTraversal) {
    throw new Error(`Object storage key contains empty or traversal segment: ${key}`);
  }
}
