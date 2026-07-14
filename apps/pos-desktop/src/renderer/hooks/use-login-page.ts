/**
 * Hook that owns all state, effects, and event handlers for the login page.
 *
 * Extracted from the monolithic login.page.tsx so the logic can be
 * unit-tested without rendering the full dialog tree, and to keep the
 * page component as a thin wiring container.
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { useLocalSessionStore } from '../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../domain/auth/auth.service';
import { InvalidCredentialsException } from '../../domain/auth/exceptions';
import { API_BASE_URL } from '@infra/config';
import type { LocalUserInfo } from '../../domain/auth/local-users';

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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoginPage(): UseLoginPageReturn {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);

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
        const result = await authService.login(
          selectedUser.username,
          pin,
          'PIN',
          'local-workstation',
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
        } else if ((err as Error).message?.includes('locked')) {
          setError(t('auth.too_many_attempts'));
        } else {
          setError(t('auth.connection_error'));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [selectedUser, authService, dispatch, t],
  );

  const handlePasswordLogin = useCallback(async () => {
    if (!identifier || !password) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await authService.login(
        identifier,
        password,
        'PASSWORD',
        'local-workstation',
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
      } else if ((err as Error).message?.includes('locked')) {
        setLockoutUntil(new Date(Date.now() + 5 * 60 * 1000));
        setError(t('auth.too_many_attempts_minutes'));
      } else {
        setError(t('auth.connection_error'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [identifier, password, authService, dispatch, t]);

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
  };
}
