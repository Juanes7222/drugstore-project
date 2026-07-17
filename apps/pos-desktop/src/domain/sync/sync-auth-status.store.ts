/**
 * Zustand store for the sync scheduler's auth token refresh status.
 *
 * The SyncScheduler writes to this store on every `tick()` so that the
 * sync health UI can display whether the access token is fresh, was
 * recently refreshed, or has authentication failures — without coupling
 * the scheduler directly to React or to the health page.
 *
 * @module sync-auth-status.store
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Status of the last auth-token refresh attempt by the SyncScheduler.
 */
export type SyncAuthStatus =
  | 'unknown'       // Never checked yet
  | 'fresh'         // Token still valid (no refresh needed)
  | 'refreshed'     // Standard POST /auth/refresh succeeded
  | 'exchanged'     // Offline token exchange (fallback) succeeded
  | 'failed'        // Both refresh paths failed — auth error likely
  | 'no_session';   // No session available (user not logged in)

export interface SyncAuthStatusState {
  /** When the last status was recorded (epoch ms). */
  lastCheckAt: number | null;
  /** Current auth status. */
  status: SyncAuthStatus;
  /** Human-readable detail message. */
  detail: string;
  /** Cumulative count of successful offline token exchanges this session. */
  exchangeCount: number;

  // ── Actions ──────────────────────────────────────────────────────────
  setFresh: () => void;
  setRefreshed: (detail?: string) => void;
  setExchanged: (detail?: string) => void;
  setFailed: (detail?: string) => void;
  setNoSession: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState: Pick<
  SyncAuthStatusState,
  'lastCheckAt' | 'status' | 'detail' | 'exchangeCount'
> = {
  lastCheckAt: null,
  status: 'unknown',
  detail: '',
  exchangeCount: 0,
};

export const useSyncAuthStatusStore = create<SyncAuthStatusState>((set) => ({
  ...initialState,

  setFresh: () =>
    set({
      status: 'fresh',
      detail: 'Token still valid',
      lastCheckAt: Date.now(),
    }),

  setRefreshed: (detail?: string) =>
    set({
      status: 'refreshed',
      detail: detail ?? 'Access token refreshed via /auth/refresh',
      lastCheckAt: Date.now(),
    }),

  setExchanged: (detail?: string) =>
    set((state) => ({
      status: 'exchanged',
      detail:
        detail ??
        'Offline token exchanged for fresh credentials via /auth/token/exchange',
      lastCheckAt: Date.now(),
      exchangeCount: state.exchangeCount + 1,
    })),

  setFailed: (detail?: string) =>
    set({
      status: 'failed',
      detail:
        detail ??
        'Token refresh failed — sync requests may receive 401 errors',
      lastCheckAt: Date.now(),
    }),

  setNoSession: () =>
    set({
      status: 'no_session',
      detail: 'No active session — user not logged in',
      lastCheckAt: Date.now(),
    }),

  reset: () => set({ ...initialState }),
}));
