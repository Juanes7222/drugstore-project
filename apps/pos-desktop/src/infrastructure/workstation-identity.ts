/**
 * Persistent workstation identity for zero-touch self-registration.
 *
 * A freshly installed terminal has no server-side Workstation row yet. The
 * first successful login registers it automatically (server-side), using the
 * client-generated id as the stable identity. This module resolves that id
 * once per app run with the following priority:
 *
 * 1. Build-time override `VITE_WORKSTATION_ID` (never persisted — used by
 *    scripts/dev-multi-station.mjs to pin deterministic ids per dev window).
 * 2. An id persisted locally on a previous run.
 * 3. A newly generated UUID v4, persisted immediately so every later boot
 *    and every login from this machine reuses it.
 *
 * Kept separate from `config.ts` because resolution has side effects
 * (persisting a generated id) and needs injectable storage/uuid for tests,
 * while config stays a pure read of build-time constants. `config.ts`
 * remains the only place that touches `import.meta.env` and calls into this
 * module exactly once at import time.
 */

import { z } from 'zod';

/** localStorage key holding the machine's persistent workstation id. */
const STORAGE_KEY = 'pharmacy.workstation.id';

/**
 * Server treats the supplied workstationId as an opaque identity string;
 * reject only values that are empty after trimming or unreasonably long.
 */
const persistedWorkstationIdSchema = z.string().trim().min(1).max(128);

/** Where the resolved id came from — diagnostics and tests. */
export type WorkstationIdSource = 'env' | 'persisted' | 'generated';

export interface WorkstationIdentity {
  workstationId: string;
  source: WorkstationIdSource;
}

/**
 * Minimal persistence seam so tests can inject an in-memory store and so
 * non-browser environments (SSR, plain node tests) degrade gracefully.
 */
export interface IdentityStorage {
  getItem(): string | null;
  setItem(value: string): void;
}

const createInMemoryIdentityStorage = (): IdentityStorage => {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (next) => {
      value = next;
    },
  };
};

const createLocalStorageIdentityStorage = (): IdentityStorage => {
  const isLocalStorageAvailable = (): boolean =>
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

  return {
    getItem: (): string | null => {
      if (!isLocalStorageAvailable()) return null;
      return window.localStorage.getItem(STORAGE_KEY);
    },
    setItem: (value: string): void => {
      if (!isLocalStorageAvailable()) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // Quota/private-mode failures must never crash boot; the generated
        // id then lives for the process lifetime only (in-memory semantics).
      }
    },
  };
};

const createDefaultIdentityStorage = (): IdentityStorage => {
  const hasLocalStorage =
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  return hasLocalStorage
    ? createLocalStorageIdentityStorage()
    : createInMemoryIdentityStorage();
};

export interface ResolveWorkstationIdOptions {
  /** Raw `VITE_WORKSTATION_ID` value, when present at build time. */
  envWorkstationId?: string;
  /** UUID v4 generator override (tests). Defaults to Web Crypto. */
  generateUuid?: () => string;
  /** Persistence backend override (tests). */
  storage?: IdentityStorage;
}

/**
 * Resolve the workstation identity for this run. See the module docblock
 * for the priority contract: env override > persisted > generated-and-
 * persisted. Never throws — a corrupt persisted value is discarded and
 * replaced by a fresh generation rather than blocking startup.
 */
export const resolveWorkstationId = (
  options: ResolveWorkstationIdOptions = {},
): WorkstationIdentity => {
  const {
    envWorkstationId,
    generateUuid = () => globalThis.crypto.randomUUID(),
    storage = createDefaultIdentityStorage(),
  } = options;

  // a) Build-time override wins. Deliberately NOT persisted, so a dev window
  // running without the env var keeps its own previously persisted identity.
  const envValue = envWorkstationId?.trim();
  if (envValue) {
    return { workstationId: envValue, source: 'env' };
  }

  // b) Locally persisted identity from a previous run.
  const stored = storage.getItem();
  if (stored !== null) {
    const parsed = persistedWorkstationIdSchema.safeParse(stored);
    if (parsed.success) {
      return { workstationId: parsed.data, source: 'persisted' };
    }
    // Corrupt entry (e.g. cleared partially by user tooling) — fall through
    // and mint a new one instead of failing startup over a cosmetic value.
  }

  // c) First boot on this machine: generate once and persist immediately so
  // the server sees a stable id across logins and restarts.
  const generated = generateUuid();
  storage.setItem(generated);
  return { workstationId: generated, source: 'generated' };
};

/**
 * Resolve the human-readable workstation name sent with login requests for
 * server-side self-registration.
 *
 * Priority: explicit `VITE_FRIENDLY_NAME`, else a generic label derived
 * from the stable id. The OS hostname is intentionally not used: reading it
 * would require the Tauri os plugin, which is deliberately not a dependency
 * for cosmetic metadata like this.
 */
export const resolveWorkstationName = (
  workstationId: string,
  envFriendlyName?: string,
): string => {
  const friendly = envFriendlyName?.trim();
  if (friendly) return friendly;
  return `POS ${workstationId.slice(-4).toUpperCase()}`;
};
