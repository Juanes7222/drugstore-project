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
 *
 * On Tauri the key is primarily stored in the shared app-data file
 * (`pglite-data/local-network-key`) so every window/process on the same
 * machine sees the same key. `SecureStorage` (localStorage) is kept as a
 * fallback for the browser dev server and as a migration source when the
 * file does not exist yet.
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

  async function readKeyFromFile(): Promise<string | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const contents = await invoke<string>('read_data_dir_file_command', {
        fileName: STORAGE_KEY,
      });
      const trimmed = contents?.trim();
      return trimmed ? trimmed : null;
    } catch {
      return null;
    }
  }

  async function writeKeyToFile(key: string): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_data_dir_file_command', {
        fileName: STORAGE_KEY,
        contents: key,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function readRotationFromFile(): Promise<string | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const contents = await invoke<string>('read_data_dir_file_command', {
        fileName: rotationStorageKey,
      });
      return contents?.trim() ?? null;
    } catch {
      return null;
    }
  }

  async function writeRotationToFile(value: string): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_data_dir_file_command', {
        fileName: rotationStorageKey,
        contents: value,
      });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async getKey(): Promise<string | null> {
      const fileKey = await readKeyFromFile();
      if (fileKey) return fileKey;
      const stored = await storage.getItem(STORAGE_KEY);
      if (stored) {
        // Migrate the localStorage key to the shared file so a second
        // window on the same machine converges on the same hash.
        await writeKeyToFile(stored);
        return stored;
      }
      return null;
    },

    async generateKey(): Promise<string> {
      // Another window on the same machine may have created the shared file
      // between getKey() and generateKey() — never overwrite an existing key.
      const existing = await readKeyFromFile();
      if (existing) {
        try {
          await storage.setItem(STORAGE_KEY, existing);
        } catch {
          // Ignore — file is the source of truth on Tauri.
        }
        return existing;
      }

      const key = generateRandomKey();
      const wroteFile = await writeKeyToFile(key);
      if (!wroteFile) {
        await storage.setItem(STORAGE_KEY, key);
      } else {
        // Keep localStorage in sync for the browser fallback.
        try {
          await storage.setItem(STORAGE_KEY, key);
        } catch {
          // Ignore — file is the source of truth on Tauri.
        }
      }
      return key;
    },

    async rotateKey(): Promise<{ newKey: string; oldKey: string | null }> {
      const oldKey = await this.getKey();
      const newKey = generateRandomKey();
      const wroteFile = await writeKeyToFile(newKey);
      if (!wroteFile) {
        await storage.setItem(STORAGE_KEY, newKey);
      } else {
        try {
          await storage.setItem(STORAGE_KEY, newKey);
        } catch {}
      }
      const stamp = new Date().toISOString();
      const wroteRot = await writeRotationToFile(stamp);
      if (!wroteRot) {
        await storage.setItem(rotationStorageKey, stamp);
      }
      return { newKey, oldKey };
    },

    async getLastRotation(): Promise<string | null> {
      const fileRot = await readRotationFromFile();
      if (fileRot) return fileRot;
      return storage.getItem(rotationStorageKey);
    },

    async isInGracePeriod(): Promise<boolean> {
      const lastRotation = await this.getLastRotation();
      if (!lastRotation) return false;
      const elapsed = Date.now() - new Date(lastRotation).getTime();
      return elapsed < GRACE_PERIOD_MS;
    },
  };
}
