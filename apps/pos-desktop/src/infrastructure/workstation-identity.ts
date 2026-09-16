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

// ---------------------------------------------------------------------------
// Shared-file convergence
// ---------------------------------------------------------------------------

/**
 * File name (inside the Tauri app-data dir) holding the machine-wide
 * workstation id. Same pattern as the local-network key: the file is shared
 * by every window/process on the machine, while `localStorage` is scoped to
 * a webview profile and can diverge (cleared storage, private mode, a second
 * profile) — minting a fresh id whose sale sequence restarts at 1 and whose
 * ticket numbers then collide on display with the previous identity's.
 */
export const WORKSTATION_ID_FILE_NAME = 'workstation-id';

/** Result of `convergeWorkstationId`. */
export interface WorkstationConvergence {
  workstationId: string;
  /** Where the converged id came from. */
  source: WorkstationIdSource | 'file';
  /** Whether this call healed a divergence (wrote the file or the storage). */
  converged: boolean;
}

export interface ConvergeWorkstationIdOptions {
  /** Persistence backend override (tests). Defaults to the default storage. */
  storage?: IdentityStorage;
  /** UUID v4 generator override (tests). Defaults to Web Crypto. */
  generateUuid?: () => string;
  /** File-read override (tests). Defaults to the Tauri data-dir command. */
  readFile?: () => Promise<string | null>;
  /** File-write override (tests). Defaults to the Tauri data-dir command. */
  writeFile?: (value: string) => Promise<boolean>;
}

const readWorkstationIdFile = async (): Promise<string | null> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const contents = await invoke<string>('read_data_dir_file_command', {
      fileName: WORKSTATION_ID_FILE_NAME,
    });
    const trimmed = contents?.trim();
    return trimmed ? trimmed : null;
  } catch {
    // Outside Tauri (browser dev server, tests) there is no data-dir file.
    return null;
  }
};

const writeWorkstationIdFile = async (value: string): Promise<boolean> => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_data_dir_file_command', {
      fileName: WORKSTATION_ID_FILE_NAME,
      contents: value,
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Converge the workstation identity toward the machine-wide file.
 *
 * Priority: shared file > valid localStorage value > fresh generation.
 * Whichever source wins is mirrored to the other store on a best-effort
 * basis, so all webviews on this machine agree on one id and sale
 * sequences never restart silently:
 *
 * - file present: localStorage is overwritten when it differs (takes effect
 *   for `WORKSTATION_ID` on the next boot and for the next login/session).
 * - file absent but storage valid: the stored id is promoted to the file.
 * - neither: a fresh id is minted into both stores.
 *
 * Never throws — file I/O failures degrade to the localStorage behaviour.
 */
export const convergeWorkstationId = async (
  options: ConvergeWorkstationIdOptions = {},
): Promise<WorkstationConvergence> => {
  const {
    storage = createDefaultIdentityStorage(),
    generateUuid = () => globalThis.crypto.randomUUID(),
    readFile = readWorkstationIdFile,
    writeFile = writeWorkstationIdFile,
  } = options;

  const parseStored = (): string | null => {
    const stored = storage.getItem();
    if (stored === null) return null;
    const parsed = persistedWorkstationIdSchema.safeParse(stored);
    return parsed.success ? parsed.data : null;
  };

  let fileId: string | null = null;
  try {
    const raw = await readFile();
    if (raw !== null) {
      const parsed = persistedWorkstationIdSchema.safeParse(raw.trim());
      fileId = parsed.success ? parsed.data : null;
    }
  } catch {
    fileId = null;
  }

  if (fileId) {
    const stored = parseStored();
    if (stored !== fileId) {
      try {
        storage.setItem(fileId);
      } catch {
        // Storage write failures keep in-memory semantics; the file — the
        // source of truth on Tauri — already holds the converged id.
      }
      return { workstationId: fileId, source: 'file', converged: true };
    }
    return { workstationId: fileId, source: 'file', converged: false };
  }

  const stored = parseStored();
  if (stored) {
    let converged = false;
    try {
      converged = await writeFile(stored);
    } catch {
      converged = false;
    }
    return { workstationId: stored, source: 'persisted', converged };
  }

  const generated = generateUuid();
  try {
    storage.setItem(generated);
  } catch {
    // Ignore — see above.
  }
  let fileWritten = false;
  try {
    fileWritten = await writeFile(generated);
  } catch {
    fileWritten = false;
  }
  return { workstationId: generated, source: 'generated', converged: fileWritten };
};
