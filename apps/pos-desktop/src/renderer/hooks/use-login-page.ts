/**
 * Hook that owns all state, effects, and event handlers for the login page.
 *
 * Extracted from the monolithic login.page.tsx so the logic can be
 * unit-tested without rendering the full dialog tree, and to keep the
 * page component as a thin wiring container.
 *
 * Extended with offline login support: when the browser is offline,
 * the hook routes through the offline auth service instead of the
 * regular server-based login, and adjusts 2FA behaviour accordingly.
 */

import { useState, useCallback, useEffect } from 'react';
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
import type { LocalUserInfo } from '../../domain/auth/local-users';
import { useOfflineAuth } from './use-offline-auth';

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

  /** Manually clear the selected user (return to avatar grid). */
  setSelectedUser: (user: LocalUserInfo | null) => void;

  /** Select a user from the avatar grid. */
  handleUserSelect: (user: LocalUserInfo) => void;
  /** Called when the PIN keypad auto-submits. */
  handlePinComplete: (pin: string) => Promise<void>;
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
// Hook
// ---------------------------------------------------------------------------

export function useLoginPage(): UseLoginPageReturn {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

  // Offline auth hook
  const { connectionState, attemptOfflineLogin } = useOfflineAuth();

  // Strict offline check: only use offline login when truly disconnected,
  // not during the RECONNECTING transition (where the browser IS online).
  const isStrictlyOffline = connectionState === 'OFFLINE';

  // Auth service — created once via lazy initializer.
  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

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

  // Redirect to sales if already logged in
  useEffect(() => {
    if (session) {
      dispatch(setActiveScreen('sales'));
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

  const handlePinComplete = useCallback(
    async (pin: string) => {
      if (!selectedUser) return;
      setIsLoading(true);
      setError(null);

      try {
        if (isStrictlyOffline) {
          // Offline login — skip server call
          await attemptOfflineLogin(
            selectedUser.id,
            pin,
            'PIN',
          );
          setOfflineLoginSkipped2fa(false);
          dispatch(setActiveScreen('sales'));
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

        dispatch(setActiveScreen('sales'));
      } catch (err) {
        if (err instanceof InvalidCredentialsException) {
          setError(t('auth.pin_incorrect'));
        } else if (err instanceof NetworkErrorException) {
          // Server unreachable — attempt offline fallback with the same PIN.
          // This covers the case where the browser reports as online but the
          // server is actually down (connection refused, DNS failure, timeout).
          try {
            await attemptOfflineLogin(selectedUser.id, pin, 'PIN');
            setOfflineLoginSkipped2fa(false);
            dispatch(setActiveScreen('sales'));
          } catch (offlineErr) {
            if (offlineErr instanceof NoOfflineCredentialsException) {
              setError(
                t(
                  'offline_login.no_credentials',
                  'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
                ),
              );
              setOfflineErrorMessage(
                'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
              );
            } else if (offlineErr instanceof OfflineCredentialsExpiredException) {
              setError(
                t(
                  'offline_login.credentials_expired',
                  'Tu acceso offline expiró. Conectate a internet para renovar.',
                ),
              );
              setOfflineErrorMessage(
                'Tu acceso offline expiró. Conectate a internet para renovar.',
              );
            } else if (offlineErr instanceof OfflineTokenRevokedException) {
              setError(
                t(
                  'offline_login.token_revoked',
                  'Esta cuenta fue deshabilitada. Contactá al manager.',
                ),
              );
              setOfflineErrorMessage(
                'Esta cuenta fue deshabilitada. Contactá al manager.',
              );
            } else {
              setError(t('auth.connection_error'));
            }
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
    [selectedUser, authService, dispatch, t, isStrictlyOffline, attemptOfflineLogin],
  );

  const handlePasswordLogin = useCallback(async () => {
    if (!identifier || !password) return;
    setIsLoading(true);
    setError(null);

    try {
      if (isStrictlyOffline) {
        // Offline login — attempt via offline auth
        await attemptOfflineLogin(
          selectedUser?.id ?? identifier,
          password,
          'PASSWORD',
        );
        setOfflineLoginSkipped2fa(false);
        dispatch(setActiveScreen('sales'));
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

      dispatch(setActiveScreen('sales'));
    } catch (err) {
      if (err instanceof InvalidCredentialsException) {
        setError(t('auth.password_incorrect'));
      } else if (err instanceof NetworkErrorException) {
        // Server unreachable — attempt offline fallback with the same
        // password.  Uses selectedUser.id when available (avatar grid
        // flow), otherwise falls back to identifier (manual form) which
        // matches the existing offline-branch behaviour.
        try {
          await attemptOfflineLogin(
            selectedUser?.id ?? identifier,
            password,
            'PASSWORD',
          );
          setOfflineLoginSkipped2fa(false);
          dispatch(setActiveScreen('sales'));
        } catch (offlineErr) {
          if (offlineErr instanceof NoOfflineCredentialsException) {
            setError(
              t(
                'offline_login.no_credentials',
                'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
              ),
            );
            setOfflineErrorMessage(
              'No puedes entrar sin conexión. Conectate a internet la primera vez que uses este dispositivo.',
            );
          } else if (offlineErr instanceof OfflineCredentialsExpiredException) {
            setError(
              t(
                'offline_login.credentials_expired',
                'Tu acceso offline expiró. Conectate a internet para renovar.',
              ),
            );
            setOfflineErrorMessage(
              'Tu acceso offline expiró. Conectate a internet para renovar.',
            );
          } else if (offlineErr instanceof OfflineTokenRevokedException) {
            setError(
              t(
                'offline_login.token_revoked',
                'Esta cuenta fue deshabilitada. Contacta al manager.',
              ),
            );
            setOfflineErrorMessage(
              'Esta cuenta fue deshabilitada. Contacta al manager.',
            );
          } else {
            setError(t('auth.connection_error'));
          }
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
  ]);

  const handleTwoFactorComplete = useCallback(() => {
    setRequiresTwoFactor(false);
    setChallengeToken(null);
    dispatch(setActiveScreen('sales'));
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
