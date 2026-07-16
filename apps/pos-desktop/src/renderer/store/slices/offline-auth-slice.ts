/**
 * Redux Toolkit slice for offline auth UI state.
 *
 * Tracks the connection state, blessing progress, and revocation list
 * fetch timing so the UI can render appropriate indicators (Sync Slate,
 * blessing progress bar, error toasts).
 *
 * This slice holds *UI-relevant* offline auth state only. The actual
 * offline sessions and credentials live in the Zustand offline session
 * store and SecureStorage, respectively.
 */
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'RECONNECTING';

export interface BlessingProgress {
  total: number;
  completed: number;
  failed: number;
}

export interface OfflineAuthState {
  /** Current server connectivity state as determined by periodic checks. */
  connectionState: ConnectionState;

  /** ISO-8601 timestamp of the last successful revocation list fetch, or `null`. */
  lastRevocationListFetch: string | null;

  /** ISO-8601 timestamp of the last blessing attempt, or `null`. */
  lastBlessingAttempt: string | null;

  /** Whether a blessing batch is currently in flight. */
  isBlessingInProgress: boolean;

  /** Progress of the current (or most recent) blessing batch. */
  blessingProgress: BlessingProgress;

  /** User-facing error message from the last failed operation, or `null`. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: OfflineAuthState = {
  connectionState: navigator.onLine ? 'ONLINE' : 'OFFLINE',
  lastRevocationListFetch: null,
  lastBlessingAttempt: null,
  isBlessingInProgress: false,
  blessingProgress: { total: 0, completed: 0, failed: 0 },
  error: null,
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const offlineAuthSlice = createSlice({
  name: 'offlineAuth',
  initialState,
  reducers: {
    setConnectionState: (state, action: PayloadAction<ConnectionState>) => {
      state.connectionState = action.payload;
    },

    setLastRevocationListFetch: (state, action: PayloadAction<string | null>) => {
      state.lastRevocationListFetch = action.payload;
    },

    setLastBlessingAttempt: (state, action: PayloadAction<string | null>) => {
      state.lastBlessingAttempt = action.payload;
    },

    setBlessingInProgress: (state, action: PayloadAction<boolean>) => {
      state.isBlessingInProgress = action.payload;
    },

    setBlessingProgress: (state, action: PayloadAction<BlessingProgress>) => {
      state.blessingProgress = action.payload;
    },

    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

    /** Reset all values to their initial state. */
    resetOfflineAuthState: () => initialState,
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const {
  setConnectionState,
  setLastRevocationListFetch,
  setLastBlessingAttempt,
  setBlessingInProgress,
  setBlessingProgress,
  setError,
  resetOfflineAuthState,
} = offlineAuthSlice.actions;

/** Selector: connection state. */
export const selectConnectionState = (state: {
  offlineAuth: OfflineAuthState;
}): ConnectionState => state.offlineAuth.connectionState;

/** Selector: blessing progress. */
export const selectBlessingProgress = (state: {
  offlineAuth: OfflineAuthState;
}): BlessingProgress => state.offlineAuth.blessingProgress;

/** Selector: is blessing in flight. */
export const selectIsBlessingInProgress = (state: {
  offlineAuth: OfflineAuthState;
}): boolean => state.offlineAuth.isBlessingInProgress;

/** Selector: last known error. */
export const selectOfflineAuthError = (state: {
  offlineAuth: OfflineAuthState;
}): string | null => state.offlineAuth.error;
