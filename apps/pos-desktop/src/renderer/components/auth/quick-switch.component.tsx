/**
 * QuickSwitch — change active user without re-login.
 *
 * Visible in the top nav as the current user's avatar + name + a small chevron.
 * Click opens a dropdown showing the other users in the current location.
 *
 * Selecting a user shows the PIN/password input for that user.
 * The switch is instant: the new user takes over the session, with their own
 * role-based UI.
 */
import { type FC, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RoleType } from '@pharmacy/shared-types';
import { Avatar } from './avatar.component';
import { PinKeypad } from './pin-keypad.component';
import { useLocalSessionStore } from '../../../domain/auth/local-session.store';
import { createAuthService } from '../../../domain/auth/auth.service';
import { InvalidCredentialsException } from '../../../domain/auth/exceptions';
import { API_BASE_URL } from '@infra/config';

interface QuickUser {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}

export const QuickSwitch: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);
  const [isOpen, setIsOpen] = useState(false);
  const [switchState, setSwitchState] = useState<'idle' | 'pin' | 'password'>('idle');
  const [selectedUser, setSelectedUser] = useState<QuickUser | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Users loaded from the server (or local cache as fallback)
  const [users, setUsers] = useState<QuickUser[]>([]);
  const [isFetchingUsers, setIsFetchingUsers] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const [authService] = useState(() =>
    createAuthService({
      baseUrl: API_BASE_URL,
    }),
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSwitchState('idle');
        setSelectedUser(null);
        setError(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch users when the dropdown opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function loadUsers() {
      setIsFetchingUsers(true);
      setFetchError(null);

      try {
        // 1. Try the server (requires OWNER/MANAGER role)
        const result = await authService.listUsers({ limit: 50 });
        if (cancelled) return;

        const mapped: QuickUser[] = (result.users ?? []).map(
          (u: { id: string; displayName?: string; fullName?: string; role: string; avatarUrl?: string | null; avatarColor?: string | null; username?: string }) => ({
            id: u.id,
            displayName: u.displayName ?? u.fullName ?? '',
            role: u.role as RoleType,
            avatarUrl: u.avatarUrl ?? null,
            avatarColor: u.avatarColor ?? null,
            username: u.username ?? '',
          }),
        );
        setUsers(mapped);
        setIsFetchingUsers(false);

        // Update local cache for offline fallback
        const { cacheUsers } = await import('../../../domain/auth/local-user-cache');
        const { mapServerUserToLocalUserInfo } = await import('../../../domain/auth/local-users');
        await cacheUsers(mapped.map((u) => mapServerUserToLocalUserInfo(u)));
      } catch (err) {
        if (cancelled) return;

        // 2. Permission denied or network error — fall back to local cache
        try {
          const { loadCachedUsers } = await import('../../../domain/auth/local-user-cache');
          const cached = await loadCachedUsers();
          if (cancelled) return;

          if (cached.length > 0) {
            setUsers(
              cached.map((u) => ({
                id: u.id,
                displayName: u.displayName,
                role: u.role as RoleType,
                avatarUrl: u.avatarUrl,
                avatarColor: u.avatarColor,
                username: u.username,
              })),
            );
          } else {
            setUsers([]);
            setFetchError(
              (err as Error)?.message?.includes('[403]')
                ? t('auth.no_permission_list_users', 'No tenés permisos para listar usuarios')
                : t('auth.connection_error'),
            );
          }
        } catch {
          if (cancelled) return;
          setUsers([]);
          setFetchError(t('auth.connection_error'));
        } finally {
          setIsFetchingUsers(false);
        }
      }
    }

    void loadUsers();
    return () => { cancelled = true; };
  }, [isOpen, authService, t]);

  if (!session) return null;

  const handleUserSelect = useCallback((user: QuickUser) => {
    setSelectedUser(user);
    setError(null);
    setPassword('');

    // Cashiers and Managers use PIN; Owners and Admins use password.
    setSwitchState(
      user.role === RoleType.CASHIER || user.role === RoleType.MANAGER
        ? 'pin'
        : 'password',
    );
  }, []);

  const handleSwitchComplete = useCallback(async () => {
    if (!selectedUser) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await authService.login(
        selectedUser.username,
        password,
        'PASSWORD',
        session.workstationId,
        undefined,
        'pos-desktop',
      );

      if (result.session) {
        useLocalSessionStore.getState().setSession(result.session);
        setIsOpen(false);
        setSwitchState('idle');
        setSelectedUser(null);
      }
    } catch (err) {
      if (err instanceof InvalidCredentialsException) {
        setError(t('auth.password_incorrect'));
      } else {
        setError(t('auth.connection_error'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedUser, password, authService, session.workstationId]);

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
          session.workstationId,
          undefined,
          'pos-desktop',
        );

        if (result.session) {
          useLocalSessionStore.getState().setSession(result.session);
          setIsOpen(false);
          setSwitchState('idle');
          setSelectedUser(null);
        }
      } catch (err) {
        if (err instanceof InvalidCredentialsException) {
          setError(t('auth.pin_incorrect'));
        } else {
          setError(t('auth.connection_error'));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [selectedUser, authService, session.workstationId],
  );

  return (
    <div ref={dropdownRef} className="relative">
      {/* Current user button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          backgroundColor: isOpen ? 'var(--color-surface-variant)' : 'transparent',
          cursor: 'pointer',
          transition: 'background-color 0.15s',
        }}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={t('auth.switch_user')}
      >
        <Avatar
          displayName={session.displayName || session.fullName}
          avatarUrl={session.avatarUrl}
          avatarColor={session.avatarColor}
          userId={session.userId}
          size={32}
        />
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--color-ink)' }}
        >
          {session.displayName || session.fullName}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            color: 'var(--color-ink-muted)',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="pos-panel absolute right-0 top-full mt-1 z-50 min-w-50"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {switchState === 'idle' && (
            <div className="flex flex-col py-1">
              <p
                className="px-3 py-2 text-xs font-medium"
                style={{ color: 'var(--color-ink-muted)' }}
              >
                {t('auth.switch_user')}
              </p>

              {/* Loading state */}
              {isFetchingUsers && (
                <div className="px-3 py-4 flex items-center justify-center">
                  <span
                    className="text-sm"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('common.loading')}
                  </span>
                </div>
              )}

              {/* Fetch error — no users available */}
              {!isFetchingUsers && fetchError && users.length === 0 && (
                <div className="px-3 py-4">
                  <p
                    className="text-sm text-center"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {fetchError}
                  </p>
                  <p
                    className="text-xs text-center mt-1"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('auth.use_manual_login', 'Usá el inicio de sesión manual')}
                  </p>
                </div>
              )}

              {/* Empty state — loaded successfully but no users */}
              {!isFetchingUsers && !fetchError && users.length === 0 && (
                <div className="px-3 py-4">
                  <p
                    className="text-sm text-center"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('auth.no_users_available', 'No hay usuarios disponibles')}
                  </p>
                </div>
              )}

              {/* User list — loaded from server or cache */}
              {!isFetchingUsers && users.length > 0 && users
                .filter((u) => u.id !== session.userId)
                .map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleUserSelect(user)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                      width: '100%',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-surface-variant)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
                  >
                    <Avatar
                      displayName={user.displayName}
                      avatarUrl={user.avatarUrl}
                      avatarColor={user.avatarColor}
                      userId={user.id}
                      size={28}
                    />
                    <div className="flex flex-col">
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
                        {user.role}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          )}

          {switchState === 'pin' && selectedUser && (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <Avatar
                  displayName={selectedUser.displayName}
                  avatarUrl={selectedUser.avatarUrl}
                  avatarColor={selectedUser.avatarColor}
                  userId={selectedUser.id}
                  size={32}
                />
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    {selectedUser.displayName}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('auth.enter_pin')}
                  </p>
                </div>
              </div>
              <PinKeypad
                minLength={4}
                maxLength={6}
                onComplete={handlePinComplete}
                error={error}
                isLoading={isLoading}
                label=""
              />
              <button
                type="button"
                onClick={() => {
                  setSwitchState('idle');
                  setSelectedUser(null);
                  setError(null);
                }}
                className="text-sm mt-2"
                style={{
                  color: 'var(--color-ink-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t('common.back') || 'Volver'}
              </button>
            </div>
          )}

          {switchState === 'password' && selectedUser && (
            <div className="p-3">
              <div className="flex items-center gap-2 mb-3">
                <Avatar
                  displayName={selectedUser.displayName}
                  avatarUrl={selectedUser.avatarUrl}
                  avatarColor={selectedUser.avatarColor}
                  userId={selectedUser.id}
                  size={32}
                />
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    {selectedUser.displayName}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >
                    {t('auth.enter_password')}
                  </p>
                </div>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pos-input w-full mb-2"
                placeholder={t('auth.password')}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSwitchComplete()}
              />
              {error && (
                <p
                  className="text-sm mb-2"
                  style={{ color: 'var(--color-error)' }}
                >
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSwitchState('idle');
                    setSelectedUser(null);
                    setError(null);
                  }}
                  className="pos-button pos-button--ghost flex-1"
                >
                  {t('common.cancel') || 'Cancelar'}
                </button>
                <button
                  type="button"
                  disabled={!password || isLoading}
                  onClick={handleSwitchComplete}
                  className="pos-button pos-button--primary flex-1"
                >
                  {isLoading ? '...' : t('auth.switch_button')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
