/**
 * Login page — the first screen after activation.
 *
 * Shows a row of avatars for users in this location. Tapping an avatar
 * selects that user. A "Different account" link reveals the username/email
 * input for less common users.
 *
 * Once a user is selected, the appropriate credential entry UI appears:
 * - Cashier (PIN): full-screen numeric keypad with auto-submit
 * - Owner/Manager (password): text input with show/hide
 * - 2FA-enabled user: after password, the TOTP modal appears
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/store/hooks';
import { setActiveScreen } from '@/store/slices/ui-slice';
import { RoleType } from '@pharmacy/shared-types';
import { PinKeypad } from './pin-keypad.component';
import { Avatar } from './avatar.component';
import { TwoFactorModal } from './two-factor-modal';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../../domain/auth/auth.service';
import { InvalidCredentialsException } from '../../../domain/auth/exceptions';
import { API_BASE_URL } from '@infra/config';

// Placeholder user list — in production, fetched from the server
interface LocalUserInfo {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}

const PLACEHOLDER_USERS: LocalUserInfo[] = [
  {
    id: 'owner-1',
    displayName: 'Juan Pérez',
    role: RoleType.OWNER,
    avatarUrl: null,
    avatarColor: '#4F46E5',
    username: 'juan.perez',
  },
  {
    id: 'manager-1',
    displayName: 'María García',
    role: RoleType.MANAGER,
    avatarUrl: null,
    avatarColor: '#059669',
    username: 'maria.garcia',
  },
  {
    id: 'cashier-1',
    displayName: 'Carlos López',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#D97706',
    username: 'carlos.lopez',
  },
  {
    id: 'cashier-2',
    displayName: 'Ana Martínez',
    role: RoleType.CASHIER,
    avatarUrl: null,
    avatarColor: '#DC2626',
    username: 'ana.martinez',
  },
];

export const LoginPage: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const session = useLocalSessionStore((s) => s.session);
  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

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

  // Redirect if already logged in
  useEffect(() => {
    if (session) {
      dispatch(setActiveScreen('sales'));
    }
  }, [session, dispatch]);

  // Lockout countdown
  useEffect(() => {
    if (!lockoutUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil.getTime() - Date.now()) / 1000));
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
    [selectedUser, authService, dispatch],
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
  }, [identifier, password, authService, dispatch]);

  const handleTwoFactorComplete = useCallback(() => {
    setRequiresTwoFactor(false);
    setChallengeToken(null);
    dispatch(setActiveScreen('sales'));
  }, [dispatch]);

  const handleForgotPassword = useCallback(() => {
    dispatch(setActiveScreen('forgot-password'));
  }, [dispatch]);

  if (session) return null; // Already logged in, redirect

  if (requiresTwoFactor && challengeToken) {
    return (
      <TwoFactorModal
        challengeToken={challengeToken}
        authService={authService}
        onComplete={handleTwoFactorComplete}
        onCancel={() => {
          setRequiresTwoFactor(false);
          setChallengeToken(null);
        }}
      />
    );
  }

  return (
    <div
      className="flex h-screen flex-col items-center justify-center p-pos-xl"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="w-full max-w-sm flex flex-col items-center gap-pos-lg">
        {/* App logo / title */}
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('common.app_name')}
        </h1>
        <p
          className="text-body"
          style={{ color: 'var(--color-ink-muted)' }}
        >
          {t('auth.login_title')}
        </p>

        {/* User avatar selection */}
        {!showManualInput && (
          <>
            <div
              className="flex flex-wrap justify-center gap-4"
              role="group"
              aria-label={t('auth.select_user')}
            >
              {PLACEHOLDER_USERS.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleUserSelect(user)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: 12,
                    borderRadius: 'var(--radius-md)',
                    border:
                      selectedUser?.id === user.id
                        ? '2px solid var(--color-primary)'
                        : '2px solid transparent',
                    backgroundColor:
                      selectedUser?.id === user.id
                        ? 'var(--color-surface-variant)'
                        : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <Avatar
                    displayName={user.displayName}
                    avatarUrl={user.avatarUrl}
                    avatarColor={user.avatarColor}
                    userId={user.id}
                    size={56}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    {user.displayName}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t(`roles.${user.role.toLowerCase()}`) || user.role}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="text-sm"
              style={{
                color: 'var(--color-primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {t('auth.other_account')}
            </button>
          </>
        )}

        {/* Manual input mode */}
        {showManualInput && (
          <div className="w-full flex flex-col gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--color-ink)' }}
              >
                {t('auth.email_or_username')}
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="pos-input w-full"
                placeholder="usuario@ejemplo.com"
                autoFocus
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--color-ink)' }}
              >
                {t('auth.password')}
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pos-input w-full"
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={!identifier || !password || isLoading}
              onClick={handlePasswordLogin}
              className="pos-button pos-button--primary w-full"
            >
              {isLoading ? 'Ingresando...' : 'Ingresar'}
            </button>
            <button
              type="button"
              onClick={() => setShowManualInput(false)}
              className="text-sm"
              style={{
                color: 'var(--color-primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {t('auth.select_user')}
            </button>
          </div>
        )}

        {/* Selected user credential entry */}
        {selectedUser && !showManualInput && (
          <div className="w-full">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Avatar
                displayName={selectedUser.displayName}
                avatarUrl={selectedUser.avatarUrl}
                avatarColor={selectedUser.avatarColor}
                userId={selectedUser.id}
                size={40}
              />
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--color-ink)' }}
                >
                  {selectedUser.displayName}
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  {selectedUser.role}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-ink-muted)',
                  marginLeft: 'auto',
                  fontSize: 20,
                }}
                aria-label={t('auth.change_user')}
              >
                ✕
              </button>
            </div>

            {selectedUser.role === RoleType.CASHIER ||
            selectedUser.role === RoleType.MANAGER ? (
              <PinKeypad
                length={6}
                onComplete={handlePinComplete}
                onCancel={() => setSelectedUser(null)}
                error={error}
                isLoading={isLoading}
                label={
                  selectedUser.role === RoleType.CASHIER
                    ? t('auth.pin_label')
                    : t('auth.manager_pin_label')
                }
              />
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label
                    className="block text-sm font-medium mb-1"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    {t('auth.password')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pos-input w-full"
                    placeholder="••••••••"
                    onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
                    autoFocus
                  />
                </div>
                {error && (
                  <p
                    className="text-sm"
                    style={{ color: 'var(--color-error)' }}
                  >
                    {error}
                  </p>
                )}
                {countdown > 0 && (
                  <p
                    className="text-sm text-center"
                    style={{ color: 'var(--color-warning)' }}
                  >
                    {t('auth.lockout_countdown', { minutes: Math.floor(countdown / 60), seconds: (countdown % 60).toString().padStart(2, '0') })}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!password || isLoading}
                  onClick={handlePasswordLogin}
                  className="pos-button pos-button--primary w-full"
                >
              {isLoading ? t('auth.signing_in') : t('auth.sign_in')}
                </button>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-sm"
                  style={{
                    color: 'var(--color-primary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {t('auth.forgot_password')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Generic error */}
        {error && !selectedUser && (
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
