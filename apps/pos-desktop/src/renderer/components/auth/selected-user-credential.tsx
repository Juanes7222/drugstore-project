/**
 * Selected user credential entry — PIN or password form.
 *
 * After selecting a user from the avatar grid, the appropriate credential
 * entry UI appears based on the user role:
 * - Cashier / Manager: PinKeypad with a numeric PIN input
 * - Owner (or other role): password text input with lockout handling
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { RoleType } from '@pharmacy/shared-types';
import type { LocalUserInfo } from '../../../domain/auth/local-users';
import { Avatar } from './avatar.component';
import { PinKeypad } from './pin-keypad.component';

interface SelectedUserCredentialProps {
  user: LocalUserInfo;
  password: string;
  error: string | null;
  isLoading: boolean;
  countdown: number;
  onPasswordChange: (value: string) => void;
  onPinComplete: (pin: string) => void;
  onPasswordSubmit: () => void;
  onChangeUser: () => void;
  onForgotPassword: () => void;
}

export const SelectedUserCredential: FC<SelectedUserCredentialProps> = ({
  user,
  password,
  error,
  isLoading,
  countdown,
  onPasswordChange,
  onPinComplete,
  onPasswordSubmit,
  onChangeUser,
  onForgotPassword,
}) => {
  const { t } = useTranslation();

  const isPinUser =
    user.role === RoleType.CASHIER || user.role === RoleType.MANAGER;

  return (
    <div className="w-full">
      {/* User info header with avatar, name, role, and change user button */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <Avatar
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          avatarColor={user.avatarColor}
          userId={user.id}
          size={40}
        />
        <div>
          <p
            className="font-medium"
            style={{ color: 'var(--color-ink)' }}
          >
            {user.displayName}
          </p>
          <p
            className="text-sm"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {t(`roles.${user.role.toLowerCase()}`) || user.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onChangeUser}
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

      {isPinUser ? (
        <PinKeypad
          length={6}
          onComplete={onPinComplete}
          onCancel={onChangeUser}
          error={error}
          isLoading={isLoading}
          label={
            user.role === RoleType.CASHIER
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
              onChange={(e) => onPasswordChange(e.target.value)}
              className="pos-input w-full"
              placeholder="••••••••"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onPasswordSubmit();
                }
              }}
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
              {t('auth.lockout_countdown', {
                minutes: Math.floor(countdown / 60),
                seconds: (countdown % 60).toString().padStart(2, '0'),
              })}
            </p>
          )}

          <button
            type="button"
            disabled={!password || isLoading}
            onClick={onPasswordSubmit}
            className="pos-button pos-button--primary w-full"
          >
            {isLoading ? t('auth.signing_in') : t('auth.sign_in')}
          </button>

          <button
            type="button"
            onClick={onForgotPassword}
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
  );
};
