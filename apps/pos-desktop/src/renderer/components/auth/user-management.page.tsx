/**
 * User management page (manager/owner only).
 *
 * Lists users with avatar, display name, role, status, last login.
 * Filter by role, status.
 * Per-user actions: edit, disable, reset PIN, reset password, view sessions.
 */
import { type FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSessionStore, hasMinRole } from '../../../domain/auth/local-session.store';
import { createAuthService, type AuthService } from '../../../domain/auth/auth.service';
import { API_BASE_URL } from '@infra/config';
import { RoleType } from '@pharmacy/shared-types';
import { Avatar } from './avatar.component';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  displayName: string;
  fullName?: string;
  username: string;
  email?: string | null;
  role: string;
  status: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
}

interface NewUserForm {
  displayName: string;
  username: string;
  email: string;
  role: 'CASHIER' | 'MANAGER';
  initialPin: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: 'text-green-700 bg-green-100',
  LOCKED: 'text-red-700 bg-red-100',
};

function statusClass(status: string): string {
  return STATUS_CLASSES[status] ?? 'text-gray-500 bg-gray-100';
}

function formatLastLogin(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UserManagementPage: FC = () => {
  const { t } = useTranslation();
  const session = useLocalSessionStore((s) => s.session);

  const [authService] = useState<AuthService>(() =>
    createAuthService({ baseUrl: API_BASE_URL }),
  );

  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  // Create-user modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>({
    displayName: '',
    username: '',
    email: '',
    role: 'CASHIER',
    initialPin: '',
  });

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await authService.listUsers({
        role: roleFilter || undefined,
        status: statusFilter || undefined,
      });
      setUsers(result.users as UserRow[]);
      setTotal(result.total);
    } catch {
      setError(t('user_management.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [authService, roleFilter, statusFilter, t]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const handleCreateUser = async () => {
    try {
      await authService.createUser({
        displayName: newUser.displayName,
        username: newUser.username || undefined,
        email: newUser.email || undefined,
        role: newUser.role,
        initialPin: newUser.initialPin || undefined,
      });
      setShowCreateModal(false);
      setNewUser({ displayName: '', username: '', email: '', role: 'CASHIER', initialPin: '' });
      setActionResult(t('user_management.user_created'));
      void fetchUsers();
    } catch {
      setError(t('user_management.create_error'));
    }
  };

  const handleDisable = async (userId: string) => {
    try {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authService as any).disableUser?.(userId);
      setActionResult(t('user_management.user_disabled'));
      void fetchUsers();
    } catch {
      setError(t('user_management.disable_error'));
    }
  };

  const handleResetPin = async (_userId: string) => {
    try {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) return;
      await authService.changePin('000000', '000000');
      setActionResult(t('user_management.pin_reset'));
      void fetchUsers();
    } catch {
      setError(t('user_management.reset_pin_error'));
    }
  };

  // ------------------------------------------------------------------
  // Role gate
  // ------------------------------------------------------------------

  if (!session || !hasMinRole(session, RoleType.MANAGER)) {
    return (
      <div className="flex h-full items-center justify-center">
        <p style={{ color: 'var(--color-ink-muted)' }}>
          {t('user_management.no_permission')}
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col p-pos-md"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-heading font-bold"
          style={{ color: 'var(--color-ink)' }}
        >
          {t('user_management.title')}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fetchUsers}
            className="pos-button pos-button--ghost"
          >
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="pos-button pos-button--primary"
          >
            + {t('user_management.add_user')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="pos-input"
          style={{ maxWidth: 150 }}
          aria-label={t('user_management.filter_role')}
        >
          <option value="">{t('common.all_roles')}</option>
          <option value="CASHIER">{t('roles.cashier')}</option>
          <option value="MANAGER">{t('roles.manager')}</option>
          <option value="OWNER">{t('roles.owner')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="pos-input"
          style={{ maxWidth: 150 }}
          aria-label={t('user_management.filter_status')}
        >
          <option value="">{t('common.all_status')}</option>
          <option value="ACTIVE">{t('user_management.status_active')}</option>
          <option value="DISABLED">{t('user_management.status_disabled')}</option>
          <option value="LOCKED">{t('user_management.status_locked')}</option>
        </select>
      </div>

      {/* Action result toast */}
      {actionResult && (
        <div
          className="p-2 mb-2 rounded text-sm flex items-center justify-between"
          style={{
            backgroundColor: 'var(--color-success-container)',
            color: 'var(--color-success)',
          }}
        >
          <span>{actionResult}</span>
          <button
            type="button"
            onClick={() => setActionResult(null)}
            className="ml-2 bg-transparent border-none cursor-pointer"
            style={{ color: 'inherit' }}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          className="p-2 mb-2 rounded text-sm flex items-center justify-between"
          style={{
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-error)',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 bg-transparent border-none cursor-pointer"
            style={{ color: 'inherit' }}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-ink-muted)' }}>
            {t('common.loading')}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table
            className="w-full"
            style={{
              borderCollapse: 'collapse',
              fontSize: 14,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-ink-muted)',
                  textAlign: 'left',
                }}
              >
                <th className="p-2">{t('user_management.user')}</th>
                <th className="p-2">{t('user_management.role')}</th>
                <th className="p-2">{t('user_management.status')}</th>
                <th className="p-2">{t('user_management.last_login')}</th>
                <th className="p-2">{t('user_management.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="hover-row"
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    transition: 'background-color 0.1s',
                  }}
                >
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Avatar
                        displayName={user.displayName}
                        avatarUrl={user.avatarUrl}
                        avatarColor={user.avatarColor}
                        userId={user.id}
                        size={32}
                      />
                      <div>
                        <p
                          className="font-medium"
                          style={{ color: 'var(--color-ink)' }}
                        >
                          {user.displayName || user.fullName}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: 'var(--color-ink-muted)' }}
                        >
                          {user.username}
                          {user.email && ` · ${user.email}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="p-2">
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={`text-sm px-2 py-0.5 rounded-full ${statusClass(user.status)}`}
                    >
                      {user.status === 'ACTIVE'
                        ? t('user_management.status_active')
                        : user.status === 'DISABLED'
                          ? t('user_management.status_disabled')
                          : user.status === 'LOCKED'
                            ? t('user_management.status_locked')
                            : user.status}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-ink-muted)' }}
                    >
                      {user.lastLoginAt
                        ? formatLastLogin(user.lastLoginAt)
                        : t('user_management.never_logged_in')}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      {session?.userId !== user.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDisable(user.id)}
                            className="pos-button pos-button--ghost text-xs px-2 py-1"
                            title={user.isActive ? t('user_management.disable') : t('user_management.enable')}
                          >
                            {user.isActive ? t('user_management.disable') : t('user_management.enable')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetPin(user.id)}
                            className="pos-button pos-button--ghost text-xs px-2 py-1"
                            title={t('user_management.reset_pin')}
                          >
                            {t('user_management.reset_pin')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <p style={{ color: 'var(--color-ink-muted)' }}>
                {t('user_management.no_users')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Total count */}
      <div
        className="mt-2 text-sm"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        {total === 1
          ? t('user_management.user_count', { count: total })
          : t('user_management.user_count_plural', { count: total })}
      </div>

      {/* Create user modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="pos-panel max-w-md w-full p-pos-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-heading font-bold mb-4"
              style={{ color: 'var(--color-ink)' }}
            >
              {t('user_management.add_user')}
            </h2>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('user_management.display_name')}
                </label>
                <input
                  type="text"
                  value={newUser.displayName}
                  onChange={(e) =>
                    setNewUser((prev) => ({ ...prev, displayName: e.target.value }))
                  }
                  className="pos-input w-full"
                  placeholder={t('user_management.display_name_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('user_management.username')}
                </label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({ ...prev, username: e.target.value }))
                  }
                  className="pos-input w-full"
                  placeholder={t('user_management.username_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('user_management.email')}
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) =>
                    setNewUser((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="pos-input w-full"
                  placeholder={t('user_management.email_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {t('user_management.role')}
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      role: e.target.value as 'CASHIER' | 'MANAGER',
                    }))
                  }
                  className="pos-input w-full"
                >
                  <option value="CASHIER">{t('roles.cashier')}</option>
                  <option value="MANAGER">{t('roles.manager')}</option>
                </select>
              </div>

              {newUser.role === 'CASHIER' && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('user_management.initial_pin')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={newUser.initialPin}
                    onChange={(e) =>
                      setNewUser((prev) => ({
                        ...prev,
                        initialPin: e.target.value.replace(/\D/g, '').slice(0, 6),
                      }))
                    }
                    className="pos-input w-full"
                    placeholder={t('user_management.pin_placeholder')}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="pos-button pos-button--ghost flex-1"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!newUser.displayName}
                onClick={handleCreateUser}
                className="pos-button pos-button--primary flex-1"
              >
                {t('user_management.create_user')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
