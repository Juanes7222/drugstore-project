/**
 * React hook for offline authentication flows.
 *
 * Provides the UI layer with offline login, blessing, and connectivity
 * state. Automatically triggers session blessing when the browser
 * detects a transition from offline to online.
 *
 * ## Usage
 *
 * ```typescript
 * const {
 *   connectionState,
 *   currentOfflineSession,
 *   attemptOfflineLogin,
 *   logoutOffline,
 * } = useOfflineAuth();
 * ```
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  offlineAuthSlice,
  selectConnectionState,
  selectBlessingProgress,
  selectIsBlessingInProgress,
  type ConnectionState,
} from '../store/slices/offline-auth-slice';
import {
  useOfflineSessionStore,
  applyBlessingResult,
  type OfflineSession,
  type OfflineLoginResult,
} from '../../domain/auth/offline';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import { useOnlineStatus } from './use-online-status';
import {
  createOfflineAuthService,
  type OfflineAuthService,
} from '../services/auth/offline/offline-auth-service';
import { API_BASE_URL } from '../../infrastructure/config';
import { createAuthHttpClient } from '../../domain/auth/auth-http-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseOfflineAuthReturn {
  /** Current server connectivity state. */
  connectionState: ConnectionState;

  /** The currently active offline session, or `null`. */
  currentOfflineSession: OfflineSession | null;

  /** All offline sessions that have not yet been blessed by the server. */
  pendingBlessings: OfflineSession[];

  /** Whether a blessing batch is currently in flight. */
  isBlessingInProgress: boolean;

  /** Progress of the current (or most recent) blessing batch. */
  blessingProgress: { total: number; completed: number; failed: number };

  /** Attempt an offline login with cached credentials. */
  attemptOfflineLogin: (
    userId: string,
    credential: string,
    credentialType: 'PIN' | 'PASSWORD',
  ) => Promise<OfflineLoginResult>;

  /** Log out the current offline session. */
  logoutOffline: () => Promise<void>;

  /** Manually trigger a blessing of all pending offline sessions. */
  triggerBlessing: () => Promise<void>;

  /**
   * Probe server connectivity and update the Redux connection state
   * accordingly.
   */
  checkConnectionState: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOfflineAuth(): UseOfflineAuthReturn {
  const dispatch = useAppDispatch();
  const browserIsOnline = useOnlineStatus();

  // Redux state
  const connectionState = useAppSelector(selectConnectionState);
  const blessingProgress = useAppSelector(selectBlessingProgress);
  const isBlessingInProgress = useAppSelector(selectIsBlessingInProgress);

  // Zustand offline session store (accessed via hook for reactivity)
  const sessions = useOfflineSessionStore((s) => s.sessions);
  const currentSessionId = useOfflineSessionStore((s) => s.currentSessionId);

  // Derive current session and pending blessings
  const currentOfflineSession: OfflineSession | null =
    currentSessionId !== null
      ? sessions.find((s) => s.localSessionId === currentSessionId) ?? null
      : null;

  const pendingBlessings: OfflineSession[] = sessions.filter(
    (s) => !s.isBlessed && !s.rejectedAt,
  );

  // Lazily created auth service
  const [authService] = useState<OfflineAuthService>(() =>
    createOfflineAuthService({ baseUrl: API_BASE_URL }),
  );

  // Ref to track previous browser online state for transition detection
  const prevOnlineRef = useRef<boolean>(browserIsOnline);

  // ------------------------------------------------------------------
  // Connectivity change detection -> trigger blessing
  // ------------------------------------------------------------------
  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    const isNowOnline = browserIsOnline;
    prevOnlineRef.current = browserIsOnline;

    if (wasOffline && isNowOnline) {
      // Browser detected a transition from offline -> online.
      // Check actual server reachability and trigger blessing if connected.
      checkConnectionStateInternal().then((isConnected) => {
        if (isConnected) {
          triggerBlessingInternal();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserIsOnline]);

  // ------------------------------------------------------------------
  // checkConnectionState
  // ------------------------------------------------------------------

  /**
   * Internal implementation of checkConnectionState.
   * Returns `true` if the server is reachable.
   */
  const checkConnectionStateInternal = useCallback(async (): Promise<boolean> => {
    try {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession?.accessToken) {
        // No online session — cannot authenticate a health check.
        dispatch(offlineAuthSlice.actions.setConnectionState('OFFLINE'));
        return false;
      }

      // Probe server reachability by fetching the current user's profile.
      const http = createAuthHttpClient(API_BASE_URL);
      await http.getWithAuth('/auth/me', currentSession.accessToken);

      dispatch(offlineAuthSlice.actions.setConnectionState('ONLINE'));
      dispatch(offlineAuthSlice.actions.setError(null));
      return true;
    } catch {
      dispatch(offlineAuthSlice.actions.setConnectionState('RECONNECTING'));
      return false;
    }
  }, [dispatch]);

  /**
   * Publicly exposed checkConnectionState.
   */
  const checkConnectionState = useCallback(async (): Promise<void> => {
    await checkConnectionStateInternal();
  }, [checkConnectionStateInternal]);

  // ------------------------------------------------------------------
  // triggerBlessing
  // ------------------------------------------------------------------

  const triggerBlessingInternal = useCallback(async (): Promise<void> => {
    const unBlessedSessions = useOfflineSessionStore
      .getState()
      .sessions.filter((s) => !s.isBlessed && !s.rejectedAt);

    if (unBlessedSessions.length === 0) {
      return;
    }

    const currentSession = useLocalSessionStore.getState().session;
    if (!currentSession?.accessToken) {
      dispatch(
        offlineAuthSlice.actions.setError(
          'Cannot bless sessions without an active online session',
        ),
      );
      return;
    }

    dispatch(offlineAuthSlice.actions.setBlessingInProgress(true));
    dispatch(
      offlineAuthSlice.actions.setBlessingProgress({
        total: unBlessedSessions.length,
        completed: 0,
        failed: 0,
      }),
    );

    let completed = 0;
    let failed = 0;

    try {
      const results = await authService.blessPendingSessions(
        unBlessedSessions,
        currentSession.accessToken,
      );

      // Apply each blessing result to the corresponding session in the store
      for (const result of results) {
        const session = useOfflineSessionStore
          .getState()
          .sessions.find((s) => s.localSessionId === result.localSessionId);

        if (session) {
          const updated = applyBlessingResult(session, result);
          useOfflineSessionStore
            .getState()
            .updateSession(result.localSessionId, updated);
        }

        if (result.status === 'BLESSED') {
          completed++;
        } else {
          failed++;
        }
      }

      dispatch(
        offlineAuthSlice.actions.setBlessingProgress({
          total: unBlessedSessions.length,
          completed,
          failed,
        }),
      );
      dispatch(
        offlineAuthSlice.actions.setLastBlessingAttempt(new Date().toISOString()),
      );
    } catch (err) {
      failed = unBlessedSessions.length;
      dispatch(
        offlineAuthSlice.actions.setBlessingProgress({
          total: unBlessedSessions.length,
          completed,
          failed,
        }),
      );
      dispatch(
        offlineAuthSlice.actions.setError(
          err instanceof Error ? err.message : 'Blessing failed',
        ),
      );
    } finally {
      dispatch(offlineAuthSlice.actions.setBlessingInProgress(false));
    }
  }, [authService, dispatch]);

  /**
   * Publicly exposed triggerBlessing.
   */
  const triggerBlessing = useCallback(async (): Promise<void> => {
    await triggerBlessingInternal();
  }, [triggerBlessingInternal]);

  // ------------------------------------------------------------------
  // attemptOfflineLogin
  // ------------------------------------------------------------------

  const attemptOfflineLogin = useCallback(
    async (
      userId: string,
      credential: string,
      credentialType: 'PIN' | 'PASSWORD',
    ): Promise<OfflineLoginResult> => {
      // Derive workstation fingerprint from the online session or a fallback
      const onlineSession = useLocalSessionStore.getState().session;
      const workstationFingerprint =
        onlineSession?.workstationId ?? 'local-workstation';

      const result = await authService.attemptOfflineLogin(
        userId,
        credential,
        credentialType,
        workstationFingerprint,
      );

      // Update connection state to OFFLINE since we just used offline auth
      dispatch(offlineAuthSlice.actions.setConnectionState('OFFLINE'));

      return result;
    },
    [authService, dispatch],
  );

  // ------------------------------------------------------------------
  // logoutOffline
  // ------------------------------------------------------------------

  const logoutOffline = useCallback(async (): Promise<void> => {
    const store = authService.getOfflineSessionStore();
    const currentSession = store.getState().getCurrentSession();

    if (currentSession) {
      await authService.logoutOffline(currentSession.localSessionId);
    }
  }, [authService]);

  // ------------------------------------------------------------------
  // Return
  // ------------------------------------------------------------------

  return {
    connectionState,
    currentOfflineSession,
    pendingBlessings,
    isBlessingInProgress,
    blessingProgress,
    attemptOfflineLogin,
    logoutOffline,
    triggerBlessing,
    checkConnectionState,
  };
}
