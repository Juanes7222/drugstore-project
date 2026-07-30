/**
 * Hook that owns all state, effects, and event handlers for the login page.
 *
 * The login flow:
 * 1. User selects avatar or enters username + password manually.
 * 2. The hook looks up the user in the local PGlite User cache.
 * 3. If found, verifies the password against the local hash (PBKDF2).
 * 4. If valid, creates a LocalSession with `sessionTrust = LOCAL_UNVERIFIED`.
 * 5. If online, additionally validates with the server (2FA, password changes).
 * 6. If the user is not in the local cache, falls back to server login
 *    (which seeds the cache on success).
 *
 * @module
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../domain/auth/auth.service';
import { InvalidCredentialsException, NetworkErrorException } from '../../domain/auth/exceptions';
import {
  NoOfflineCredentialsException,
  OfflineCredentialsExpiredException,
  OfflineTokenRevokedException,
} from '../../domain/auth/offline';
import { API_BASE_URL, WORKSTATION_ID } from '@infra/config';
import {
  type LocalUserInfo,
  mapLocalUserDataToLocalUserInfo,
} from '../../domain/auth/local-users';
import { useOfflineAuth } from './use-offline-auth';
import {
  createUserCacheService,
  PasswordInvalidException,
  UserLockedException,
  UserDisabledException,
  UserMaxAttemptsException,
} from '../../domain/auth/user-cache.service';
import type { UserData } from '../../domain/auth/local-types';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseLoginPageReturn {
  /** Currently selected user (from avatar grid), or null. */
  selectedUser: LocalUserInfo | null;
  /** Whether the manual email/password input form is shown. */
  showManualInput: boolean;
  /** Current identifier text (username/email). */
  identifier: string;
  /** Current password text. */
  password: string;
  /** User-visible error message, or null. */
  error: string | null;
  /** Whether an auth request is in flight. */
  isLoading: boolean;
  /** Whether the 2FA modal should be displayed. */
  requiresTwoFactor: boolean;
  /** Challenge token for the 2FA flow. */
  challengeToken: string | null;
  /** Timestamp until which the account is locked, or null. */
  lockoutUntil: Date | null;
  /** Seconds remaining in the lockout countdown. */
  countdown: number;

  /** Auth service instance — exposed for TwoFactorModal. */
  authService: AuthService;

  /** Local PGlite users to show in the avatar grid alongside cached server users. */
  localUsers: LocalUserInfo[];

  /** Manually clear the selected user (return to avatar grid). */
  setSelectedUser: (user: LocalUserInfo | null) => void;

  /** Select a user from the avatar grid. */
  handleUserSelect: (user: LocalUserInfo) => void;
  /** Called when the PIN keypad auto-submits (treats input as password). */
  handlePinComplete: (password: string) => Promise<void>;
  /** Called when the password form is submitted. */
  handlePasswordLogin: () => Promise<void>;
  /** Called after 2FA verification succeeds. */
  handleTwoFactorComplete: () => void;
  /** Cancel the 2FA modal and return to login. */
  handleTwoFactorCancel: () => void;
  /** Navigate to the forgot-password screen. */
  handleForgotPassword: () => void;
  /** Toggle manual input mode. */
  setShowManualInput: (show: boolean) => void;
  /** Set the identifier (username/email) field value. */
  setIdentifier: (id: string) => void;
  /** Set the password field value. */
  setPassword: (pw: string) => void;

  // ---- Offline extensions ----

  /** Whether the application is currently in strict offline mode. */
  isOfflineMode: boolean;
  /** User-visible offline error message, or null. */
  offlineErrorMessage: string | null;
  /** Whether 2FA was skipped because the app is offline. */
  offlineLoginSkipped2fa: boolean;
  /** Clear the offline error message. */
  handleOfflineDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoginPage(): UseLoginPageReturn {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

  // Offline auth hook
  const { connectionState, attemptOfflineLogin } = useOfflineAuth();

  // Strict offline check
  const isStrictlyOffline = connectionState === 'OFFLINE';

  // Auth service — created once via lazy initializer.
  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

  // User cache service — created once.
  const [userCache] = useState(() => createUserCacheService());

  // -- Local state --
  const [selectedUser, setSelectedUser] = useState<LocalUserInfo | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [offlineLoginSkipped2fa, setOfflineLoginSkipped2fa] = useState(false);
  const [offlineErrorMessage, setOfflineErrorMessage] = useState<string | null>(null);

  // Local PGlite users for the avatar grid.
  const [localUsers, setLocalUsers] = useState<LocalUserInfo[]>([]);

  /** On mount: load locally-cached users for the avatar grid. */
  const usersLoadedRef = useRef(false);
  useEffect(() => {
    if (usersLoadedRef.current) return;
    usersLoadedRef.current = true;

    userCache.getUsers().then((users) => {
      const mapped = users.map(mapLocalUserDataToLocalUserInfo);
      setLocalUsers(mapped);
    }).catch((err) => {
      console.warn('[use-login-page] Failed to load local users:', err);
    });
  }, [userCache]);

  // Redirect to home dashboard after login
  useEffect(() => {
    if (session) {
      dispatch(setActiveScreen('home'));
    }
  }, [session, dispatch]);

  // Lockout countdown
  useEffect(() => {
    if (!lockoutUntil) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((lockoutUntil.getTime() - Date.now()) / 1000),
      );
      setCountdown(remaining);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setCountdown(0);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  // -- Handlers --

  const handleUserSelect = useCallback((user: LocalUserInfo) => {
    setSelectedUser(user);
    setError(null);
    setIdentifier(user.username);
    setShowManualInput(false);
  }, []);

  /**
   * Attempt local auth against the PGlite User cache.
   * Returns true if the user was found and auth was attempted locally.
   * If the user is not cached locally, returns false so the caller can
   * fall through to server / offline token auth.
   */
  const attemptLocalPasswordAuth = useCallback(
    async (userId: string, password: string): Promise<boolean> => {
      let user: UserData;
      try {
        const cached = await userCache.getUser(userId);
        if (!cached) return false; // Not in local cache — fall through
        user = cached;
      } catch {
        return false;
      }

      const result = await userCache.verifyPassword(userId, password);

      if (result.valid) {
        await userCache.recordLogin(userId);
        useLocalSessionStore.getState().setSession({
          userId: user.id,
          username: user.username,
          fullName: user.displayName,
          displayName: user.displayName,
          role: user.role,
          subscriptionId: null,
          workstationId: WORKSTATION_ID,
          accessToken: '',
          refreshToken: '',
          offlineToken: null,
          sessionId: crypto.randomUUID(),
          sessionTrust: 'LOCAL_UNVERIFIED',
        });
        return true;
      }

      if (result.locked) {
        setLockoutUntil(new Date(user.lockedUntil ?? Date.now() + 5 * 60 * 1000));
        setError(t('auth.too_many_attempts'));
        return true;
      }

      // Invalid password — error already set by verifyPassword
      throw new PasswordInvalidException();
    },
    [userCache, t],
  );

  const handlePinComplete = useCallback(
    async (pin: string) => {
      if (!selectedUser) return;
      setIsLoading(true);
      setError(null);

      try {
        // ---- Local-first: try local PGlite User cache ----
        const handled = await attemptLocalPasswordAuth(selectedUser.id, pin);
        if (handled) return;

        // ---- Fallback: offline or server auth ----
        if (isStrictlyOffline) {
          await attemptOfflineLogin(
            selectedUser.id,
            pin,
            'PIN',
          );
          setOfflineLoginSkipped2fa(false);
          dispatch(setActiveScreen('home'));
          return;
        }

        // Online login — normal flow
        const result = await authService.login(
          selectedUser.username,
          pin,
          'PIN',
          WORKSTATION_ID,
          undefined,
          'pos-desktop',
        );

        if (result.requiresTwoFactor && result.challengeToken) {
          setRequiresTwoFactor(true);
          setChallengeToken(result.challengeToken);
          return;
        }

        // authService.login() already set the session in the store.
        dispatch(setActiveScreen('home'));
      } catch (err) {
        // ---- Local cache errors ----
        if (err instanceof PasswordInvalidException) {
          setError(t('auth.pin_incorrect'));
        } else if (err instanceof UserLockedException) {
          setError(t('auth.too_many_attempts'));
        } else if (err instanceof UserDisabledException) {
          setError(t('auth.account_disabled', 'Cuenta deshabilitada. Contactá al manager.'));
        } else if (err instanceof UserMaxAttemptsException) {
          setError(t('auth.too_many_attempts_admin', 'Demasiados intentos. Contactá al administrador.'));
        // ---- Server/offline errors ----
        } else if (err instanceof InvalidCredentialsException) {
          setError(t('auth.pin_incorrect'));
        } else if (err instanceof NetworkErrorException) {
          try {
            await attemptOfflineLogin(selectedUser.id, pin, 'PIN');
            setOfflineLoginSkipped2fa(false);
            dispatch(setActiveScreen('home'));
          } catch (_offlineErr) {
            setError(t('auth.connection_error'));
            setOfflineErrorMessage(t('auth.connection_error'));
          }
        } else if (err instanceof NoOfflineCredentialsException) {
          setError(
            t(
              'offline_login.no_credentials',
              'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
            ),
          );
          setOfflineErrorMessage(
            'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
          );
        } else if (err instanceof OfflineCredentialsExpiredException) {
          setError(
            t(
              'offline_login.credentials_expired',
              'Tu acceso offline expiró. Conectate a internet para renovar.',
            ),
          );
          setOfflineErrorMessage(
            'Tu acceso offline expiró. Conectate a internet para renovar.',
          );
        } else if (err instanceof OfflineTokenRevokedException) {
          setError(
            t(
              'offline_login.token_revoked',
              'Esta cuenta fue deshabilitada. Contactá al manager.',
            ),
          );
          setOfflineErrorMessage(
            'Esta cuenta fue deshabilitada. Contacta al manager.',
          );
        } else if ((err as Error).message?.includes('locked')) {
          setError(t('auth.too_many_attempts'));
        } else {
          setError(t('auth.connection_error'));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [selectedUser, authService, dispatch, t, isStrictlyOffline, attemptOfflineLogin, userCache, attemptLocalPasswordAuth],
  );

  const handlePasswordLogin = useCallback(async () => {
    if (!identifier || !password) return;
    setIsLoading(true);
    setError(null);

    try {
      // ---- Local-first: try local PGlite User cache ----
      // Look up by username first, then try local auth.
      const cachedUser = await userCache.getUserByUsername(identifier);
      if (cachedUser) {
        const handled = await attemptLocalPasswordAuth(cachedUser.id, password);
        if (handled) return;
      }

      // ---- Fallback: offline or server auth ----
      if (isStrictlyOffline) {
        await attemptOfflineLogin(
          selectedUser?.id ?? identifier,
          password,
          'PASSWORD',
        );
        setOfflineLoginSkipped2fa(false);
        dispatch(setActiveScreen('home'));
        return;
      }

      // Online login — normal flow
      const result = await authService.login(
        identifier,
        password,
        'PASSWORD',
        WORKSTATION_ID,
        undefined,
        'pos-desktop',
      );

      if (result.requiresTwoFactor && result.challengeToken) {
        setRequiresTwoFactor(true);
        setChallengeToken(result.challengeToken);
        return;
      }

      // authService.login() already set the session in the store.
      dispatch(setActiveScreen('home'));
    } catch (err) {
      // ---- Local cache errors ----
      if (err instanceof PasswordInvalidException) {
        setError(t('auth.password_incorrect'));
      } else if (err instanceof UserLockedException) {
        setError(t('auth.too_many_attempts'));
      } else if (err instanceof UserDisabledException) {
        setError(t('auth.account_disabled', 'Cuenta deshabilitada. Contactá al manager.'));
      } else if (err instanceof UserMaxAttemptsException) {
        setError(t('auth.too_many_attempts_admin', 'Demasiados intentos. Contactá al administrador.'));
      // ---- Server/offline errors ----
      } else if (err instanceof InvalidCredentialsException) {
        setError(t('auth.password_incorrect'));
      } else if (err instanceof NetworkErrorException) {
        try {
          await attemptOfflineLogin(
            selectedUser?.id ?? identifier,
            password,
            'PASSWORD',
          );
          setOfflineLoginSkipped2fa(false);
          dispatch(setActiveScreen('home'));
        } catch (_offlineErr) {
          setError(t('auth.connection_error'));
          setOfflineErrorMessage(t('auth.connection_error'));
        }
      } else if (err instanceof NoOfflineCredentialsException) {
        setError(
          t(
            'offline_login.no_credentials',
            'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
          ),
        );
        setOfflineErrorMessage(
          'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
        );
      } else if (err instanceof OfflineCredentialsExpiredException) {
        setError(
          t(
            'offline_login.credentials_expired',
            'Tu acceso offline expiró. Conectate a internet para renovar.',
          ),
        );
        setOfflineErrorMessage(
          'Tu acceso offline expiró. Conectate a internet para renovar.',
        );
      } else if (err instanceof OfflineTokenRevokedException) {
        setError(
          t(
            'offline_login.token_revoked',
            'Esta cuenta fue deshabilitada. Contacta al manager.',
          ),
        );
        setOfflineErrorMessage(
          'Esta cuenta fue deshabilitada. Contacta al manager.',
        );
      } else if ((err as Error).message?.includes('locked')) {
        setLockoutUntil(new Date(Date.now() + 5 * 60 * 1000));
        setError(t('auth.too_many_attempts_minutes'));
      } else {
        setError(t('auth.connection_error'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    identifier,
    password,
    selectedUser,
    authService,
    dispatch,
    t,
    isStrictlyOffline,
    attemptOfflineLogin,
    userCache,
    attemptLocalPasswordAuth,
  ]);

  const handleTwoFactorComplete = useCallback(() => {
    setRequiresTwoFactor(false);
    setChallengeToken(null);
    dispatch(setActiveScreen('home'));
  }, [dispatch]);

  const handleTwoFactorCancel = useCallback(() => {
    setRequiresTwoFactor(false);
    setChallengeToken(null);
  }, []);

  const handleForgotPassword = useCallback(() => {
    dispatch(setActiveScreen('forgot-password'));
  }, [dispatch]);

  const handleOfflineDismiss = useCallback(() => {
    setOfflineErrorMessage(null);
  }, []);

  return {
    selectedUser,
    showManualInput,
    identifier,
    password,
    error,
    isLoading,
    requiresTwoFactor,
    challengeToken,
    lockoutUntil,
    countdown,
    authService,
    localUsers,
    setSelectedUser,
    handleUserSelect,
    handlePinComplete,
    handlePasswordLogin,
    handleTwoFactorComplete,
    handleTwoFactorCancel,
    handleForgotPassword,
    setShowManualInput,
    setIdentifier,
    setPassword,

    // Offline extensions
    isOfflineMode: isStrictlyOffline,
    offlineErrorMessage,
    offlineLoginSkipped2fa,
    handleOfflineDismiss,
  };
}
