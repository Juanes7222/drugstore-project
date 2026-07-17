/**
 * Avatar component with color fallback.
 *
 * If the user has no avatar URL, a deterministic color is generated from
 * their user ID hash. The same user always gets the same color.
 */
import { type FC } from 'react';

interface AvatarProps {
  displayName: string | null | undefined;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  userId?: string;
  size?: number;
  className?: string;
}

/**
 * Generate a deterministic color from a user ID hash.
 */
function getColorFromId(userId: string): string {
  const colors = [
    '#4F46E5', // indigo
    '#0891B2', // cyan
    '#059669', // emerald
    '#D97706', // amber
    '#DC2626', // red
    '#7C3AED', // violet
    '#DB2777', // pink
    '#2563EB', // blue
    '#65A30D', // lime
    '#0D9488', // teal
  ];

  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }

  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export const Avatar: FC<AvatarProps> = ({
  displayName,
  avatarUrl,
  avatarColor,
  userId,
  size = 40,
  className = '',
}) => {
  const safeName = displayName ?? '';
  const bgColor = avatarColor || (userId ? getColorFromId(userId) : '#6366F1');
  const initials = getInitials(safeName);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
        }}
      />
    );
  }

  return (
    <div
      className={className}
      role="img"
      aria-label={displayName}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 600,
        fontSize: size * 0.4,
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  );
};
