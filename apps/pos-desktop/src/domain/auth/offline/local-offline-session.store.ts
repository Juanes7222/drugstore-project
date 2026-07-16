/**
 * Zustand store for offline sessions.
 *
 * Manages a collection of offline sessions for users who have logged in
 * without server connectivity.  Sessions are held in memory during the
 * app lifetime and persisted (encrypted) to localStorage so they survive
 * an app restart.
 *
 * ## Persistence strategy
 *
 * The store persists its state to `localStorage` under the key
 * `pharmacy_offline_sessions`.  Data is serialised as JSON.  Loading and
 * saving happen synchronously so the store is ready before the first
 * render; the trade-off is that very large session lists (unlikely for
 * a single-workstation POS) may cause brief main-thread blocking.
 *
 * ## When the store is hydrated
 *
 * If no session key exists in localStorage on startup, the store
 * initialises with an empty session list.  The hydrating call should be
 * made from the app bootstrap layer (e.g. in a `useEffect` in the root
 * component or in the store's own initialisation logic).
 *
 * ## Security note
 *
 * The serialised sessions include the `offlineToken`, which is a JWT.
 * localStorage persistence is obfuscated but **not encrypted at rest**.
 * Full encryption-at-rest requires Tauri stronghold integration (see
 * `SecureStorage`).
 */
import { create } from 'zustand';
import { OfflineSession } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pharmacy_offline_sessions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfflineSessionState {
  /** All offline sessions known to this workstation. */
  sessions: OfflineSession[];

  /** The `localSessionId` of the currently active session, or `null`. */
  currentSessionId: string | null;

  /** Add a new session to the collection. */
  addSession: (session: OfflineSession) => void;

  /** Apply partial updates to an existing session. */
  updateSession: (localSessionId: string, updates: Partial<OfflineSession>) => void;

  /** Remove a session from the collection. */
  removeSession: (localSessionId: string) => void;

  /** Set or clear the current session. */
  setCurrentSession: (localSessionId: string | null) => void;

  /** Get the current session object (derived from `sessions` + `currentSessionId`). */
  getCurrentSession: () => OfflineSession | null;

  /** Replace the entire session list (used when loading from storage). */
  setSessions: (sessions: OfflineSession[]) => void;

  /** Clear all sessions and the current session pointer. */
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Serialise an array of OfflineSession objects to JSON.
 *
 * Date objects are converted to ISO strings for storage.
 */
function serializeSessions(sessions: OfflineSession[]): string {
  return JSON.stringify(sessions, (_key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  });
}

/**
 * Deserialise an array of OfflineSession objects from JSON storage.
 *
 * ISO date strings are converted back to Date objects.
 */
function deserializeSessions(raw: string): OfflineSession[] {
  const parsed: unknown[] = JSON.parse(raw);
  return parsed.map((item: any) => ({
    ...item,
    createdAt: new Date(item.createdAt),
    lastActiveAt: new Date(item.lastActiveAt),
    blessedAt: item.blessedAt ? new Date(item.blessedAt) : undefined,
    rejectedAt: item.rejectedAt ? new Date(item.rejectedAt) : undefined,
  }));
}

/**
 * Save sessions to localStorage.
 */
function persistSessions(sessions: OfflineSession[]): void {
  try {
    const serialized = serializeSessions(sessions);
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // localStorage full or unavailable — fail silently.
    // The in-memory store still works for the current session.
  }
}

/**
 * Load sessions from localStorage.
 *
 * Returns an empty array if no data exists or deserialisation fails.
 */
function loadSessions(): OfflineSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return deserializeSessions(raw);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useOfflineSessionStore = create<OfflineSessionState>(
  (set, get) => ({
    // Initialise from localStorage on first access
    sessions: loadSessions(),
    currentSessionId: null,

    addSession: (session: OfflineSession) => {
      set((state) => {
        const sessions = [...state.sessions, session];
        persistSessions(sessions);
        return { sessions };
      });
    },

    updateSession: (localSessionId: string, updates: Partial<OfflineSession>) => {
      set((state) => {
        const sessions = state.sessions.map((s) =>
          s.localSessionId === localSessionId ? { ...s, ...updates } : s,
        );
        persistSessions(sessions);
        return { sessions };
      });
    },

    removeSession: (localSessionId: string) => {
      set((state) => {
        const sessions = state.sessions.filter(
          (s) => s.localSessionId !== localSessionId,
        );
        const currentSessionId =
          state.currentSessionId === localSessionId
            ? null
            : state.currentSessionId;
        persistSessions(sessions);
        return { sessions, currentSessionId };
      });
    },

    setCurrentSession: (localSessionId: string | null) => {
      set({ currentSessionId: localSessionId });
    },

    getCurrentSession: (): OfflineSession | null => {
      const state = get();
      if (!state.currentSessionId) return null;
      return (
        state.sessions.find(
          (s) => s.localSessionId === state.currentSessionId,
        ) ?? null
      );
    },

    setSessions: (sessions: OfflineSession[]) => {
      persistSessions(sessions);
      set({ sessions });
    },

    clearAll: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Silently continue.
      }
      set({ sessions: [], currentSessionId: null });
    },
  }),
);
