/**
 * Secure storage abstraction for sensitive local data.
 *
 * Provides a typed interface for storing credentials, offline tokens, and
 * other sensitive values. The current implementation uses localStorage
 * (encrypted at rest is a future concern — the PGlite database has no
 * built-in encryption, and the offline auth layer needs Tauri 2's
 * `tauri-plugin-stronghold` or the OS keychain for real security).
 *
 * ## Implementation strategy
 *
 * 1. **Production** — Tauri stronghold plugin (via `window.__TAURI__`).
 * 2. **Fallback** — `localStorage` with a simple XOR mask + base64
 *    obfuscation so credentials are not stored as plain text.
 * 3. **Dev / test** — in-memory `Map` that disappears on page reload.
 *
 * The implementation is injectable so domain code never depends on a
 * particular backend.
 */

const STORAGE_KEY_PREFIX = 'pharmacy_secure_';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface SecureStorage {
  /** Initialise the backing store (no-op for localStorage / in-memory). */
  initialize(): Promise<void>;

  /** Retrieve a value by key, or `null` if absent. */
  getItem(key: string): Promise<string | null>;

  /** Persist a key/value pair. */
  setItem(key: string, value: string): Promise<void>;

  /** Remove a single key. */
  removeItem(key: string): Promise<void>;

  /** `true` when the backing store is ready and usable. */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// In-memory implementation (dev / test)
// ---------------------------------------------------------------------------

const createInMemoryStorage = (): SecureStorage => {
  const store = new Map<string, string>();

  return {
    initialize: async () => {},
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    isAvailable: async () => true,
  };
};

// ---------------------------------------------------------------------------
// localStorage implementation (fallback)
// ---------------------------------------------------------------------------

/**
 * Light obfuscation so credentials are not stored as verbatim plain text.
 * This is **not** encryption — it prevents casual reading but provides no
 * security against an attacker who has access to the device's localStorage.
 */
const obfuscate = (value: string): string => {
  const chars = Array.from(value);
  const masked = chars.map((c, i) =>
    String.fromCodePoint(c.codePointAt(0)! ^ (i % 256)),
  );
  return btoa(masked.join(''));
};

const deobfuscate = (encoded: string): string => {
  const masked = atob(encoded);
  const chars = Array.from(masked);
  return chars
    .map((c, i) => String.fromCodePoint(c.codePointAt(0)! ^ (i % 256)))
    .join('');
};

const createLocalStorageStorage = (): SecureStorage => {
  const isLocalStorageAvailable = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined';

  return {
    initialize: async () => {},
    getItem: async (key: string): Promise<string | null> => {
      if (!isLocalStorageAvailable()) return null;
      const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + key);
      if (!raw) return null;
      try {
        return deobfuscate(raw);
      } catch {
        // If deobfuscation fails, the data may have been stored before
        // obfuscation was introduced. Return as-is for backwards compat.
        return raw;
      }
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (!isLocalStorageAvailable()) return;
      window.localStorage.setItem(STORAGE_KEY_PREFIX + key, obfuscate(value));
    },
    removeItem: async (key: string): Promise<void> => {
      if (!isLocalStorageAvailable()) return;
      window.localStorage.removeItem(STORAGE_KEY_PREFIX + key);
    },
    isAvailable: async (): Promise<boolean> => isLocalStorageAvailable(),
  };
};

// ---------------------------------------------------------------------------
// Tauri stronghold implementation (future)
// ---------------------------------------------------------------------------

interface TauriStronghold {
  initialize(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

const createTauriStrongholdStorage = (): SecureStorage => {
  const stronghold: TauriStronghold = {
    initialize: async () => {
      // Placeholder — requires tauri-plugin-stronghold to be installed
      // and a vault to be created / loaded.
      //   import { Client, Vault } from 'tauri-plugin-stronghold';
      //   const client = await Client.init('pharmacy-pos');
      //   const vault = await client.createVault('auth');
      //   ...
    },
    getItem: async (_key: string): Promise<string | null> => {
      // TODO: implement once tauri-plugin-stronghold is added
      return null;
    },
    setItem: async (_key: string, _value: string): Promise<void> => {
      // TODO: implement once tauri-plugin-stronghold is added
    },
    removeItem: async (_key: string): Promise<void> => {
      // TODO: implement once tauri-plugin-stronghold is added
    },
    isAvailable: async (): Promise<boolean> => {
      try {
        return (
          typeof window !== 'undefined' &&
          window !== null &&
          '__TAURI__' in window &&
          (window as any).__TAURI__?.plugins?.stronghold !== undefined
        );
      } catch {
        return false;
      }
    },
  };

  return stronghold;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the most capable secure storage implementation available in the
 * current runtime environment.
 *
 * Priority:
 * 1. Tauri stronghold (native, hardware-backed)
 * 2. localStorage with obfuscation (useful in the renderer when stronghold
 *    is not yet integrated)
 * 3. In-memory Map (test / dev server in plain browser)
 */
export const createSecureStorage = (): SecureStorage => {
  // When running inside a Tauri webview, attempt stronghold.
  try {
    if (
      typeof window !== 'undefined' &&
      '__TAURI__' in window &&
      (window as any).__TAURI__?.plugins?.stronghold
    ) {
      return createTauriStrongholdStorage();
    }
  } catch {
    // Silently fall through.
  }

  // Fall back to localStorage (renderer context or Tauri without stronghold).
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return createLocalStorageStorage();
    }
  } catch {
    // Silently fall through.
  }

  // Last resort: in-memory (SSR, test runner without jsdom, etc.).
  return createInMemoryStorage();
};
