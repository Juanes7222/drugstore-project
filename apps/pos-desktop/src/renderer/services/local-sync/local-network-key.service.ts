/**
 * Local network key management service.
 *
 * Manages the location's local network key: generation, storage,
 * rotation, and sharing with the Tauri backend for HMAC auth and
 * mDNS token hashing.
 */

import { createSecureStorage } from '../../../infrastructure/secure-storage';

const STORAGE_KEY = 'local_network_key';
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours.

export interface LocalNetworkKeyService {
  /** Get the current local network key, or null if not set. */
  getKey(): Promise<string | null>;

  /** Generate a new local network key (256-bit random). */
  generateKey(): Promise<string>;

  /** Persist a new key and return the old key (for grace period). */
  rotateKey(): Promise<{ newKey: string; oldKey: string | null }>;

  /** Get the timestamp of the last key rotation. */
  getLastRotation(): Promise<string | null>;

  /** Check if the key has been rotated within the grace period. */
  isInGracePeriod(): Promise<boolean>;
}

/**
 * Create a LocalNetworkKeyService backed by secure storage.
 */
export function createLocalNetworkKeyService(): LocalNetworkKeyService {
  const storage = createSecureStorage();
  const rotationStorageKey = `${STORAGE_KEY}_rotated_at`;

  function generateRandomKey(): string {
    // Generate a 256-bit (32-byte) random hex string.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return {
    async getKey(): Promise<string | null> {
      return storage.getItem(STORAGE_KEY);
    },

    async generateKey(): Promise<string> {
      const key = generateRandomKey();
      await storage.setItem(STORAGE_KEY, key);
      return key;
    },

    async rotateKey(): Promise<{ newKey: string; oldKey: string | null }> {
      const oldKey = await storage.getItem(STORAGE_KEY);
      const newKey = generateRandomKey();
      await storage.setItem(STORAGE_KEY, newKey);
      await storage.setItem(rotationStorageKey, new Date().toISOString());
      return { newKey, oldKey };
    },

    async getLastRotation(): Promise<string | null> {
      return storage.getItem(rotationStorageKey);
    },

    async isInGracePeriod(): Promise<boolean> {
      const lastRotation = await storage.getItem(rotationStorageKey);
      if (!lastRotation) return false;
      const elapsed = Date.now() - new Date(lastRotation).getTime();
      return elapsed < GRACE_PERIOD_MS;
    },
  };
}
