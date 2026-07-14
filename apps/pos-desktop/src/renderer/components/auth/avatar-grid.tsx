/**
 * Avatar grid — user selection grid for the login page.
 *
 * Shows a grid of user avatars for quick selection. Below the grid,
 * a link to switch to manual email/password login.
 */
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalUserInfo } from '../../../domain/auth/local-users';
import { Avatar } from './avatar.component';

interface AvatarGridProps {
  users: LocalUserInfo[];
  selectedUserId: string | null;
  onSelect: (user: LocalUserInfo) => void;
  onOtherAccount: () => void;
}

export const AvatarGrid: FC<AvatarGridProps> = ({
  users,
  selectedUserId,
  onSelect,
  onOtherAccount,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div
        className="flex flex-wrap justify-center gap-4"
        role="group"
        aria-label={t('auth.select_user')}
      >
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => onSelect(user)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: 12,
              borderRadius: 'var(--radius-md)',
              border:
                selectedUserId === user.id
                  ? '2px solid var(--color-primary)'
                  : '2px solid transparent',
              backgroundColor:
                selectedUserId === user.id
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
        onClick={onOtherAccount}
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
  );
};
