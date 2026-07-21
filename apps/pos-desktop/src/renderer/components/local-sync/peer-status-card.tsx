/**
 * Per-peer status card.
 *
 * Shows a single discovered workstation's connection state, identity,
 * last-seen timestamp, eligibility badges, and optional actions.
 *
 * @category Local Sync
 */

import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiscoveredPeer } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a human-readable relative time string in Spanish.
 * e.g. "hace 2 min", "hace 3 h", "hace 5 d", "ahora mismo".
 */
function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'ahora mismo';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'ahora mismo';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PeerStatusCardProps {
  /** The discovered peer to display. */
  peer: DiscoveredPeer;
  /** Whether this peer is the current hub. */
  isCurrentHub: boolean;
  /** Called when the "Make hub" action is triggered. */
  onMakeHub?: (workstationId: string) => void;
  /** Called when the "Remove" action is triggered. */
  onRemove?: (workstationId: string) => void;
  /** Whether to show action buttons (default true). */
  showActions?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PeerStatusCard: FC<PeerStatusCardProps> = ({
  peer,
  isCurrentHub,
  onMakeHub,
  onRemove,
  showActions = true,
}) => {
  const { t } = useTranslation();

  const statusLabel = peer.isOnline
    ? t('local_sync.peer_online')
    : t('local_sync.peer_offline');

  const statusDotColor = peer.isOnline ? 'bg-emerald-500' : 'bg-gray-300';

  return (
    <div
      className="flex items-center gap-4 rounded-lg border bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {/* Status dot */}
      <span
        className={`h-3 w-3 shrink-0 rounded-full ${statusDotColor}`}
        aria-hidden="true"
      />

      {/* Peer info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold" style={{ color: 'var(--color-ink)' }}>
            {peer.friendlyName}
          </span>

          {/* Hub-eligible badge */}
          {peer.hubEligible && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              {t('local_sync.peer_hub_eligible')}
            </span>
          )}

          {/* Current hub badge */}
          {isCurrentHub && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
              }}
            >
              {t('local_sync.current_hub')}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-3 text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          <span>{statusLabel}</span>
          <span>{peer.ipAddress}</span>
          <span>{t('local_sync.peer_last_seen', { time: formatRelativeTime(peer.lastSeenAt) })}</span>
        </div>
      </div>

      {/* Actions */}
      {showActions && (
        <div className="flex shrink-0 items-center gap-2">
          {!peer.isCurrentHub && onMakeHub && (
            <button
              type="button"
              onClick={() => onMakeHub(peer.workstationId)}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                color: 'var(--color-accent)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 18%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 10%, transparent)';
              }}
            >
              {t('local_sync.peer_make_hub')}
            </button>
          )}

          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(peer.workstationId)}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-danger, #dc2626) 8%, transparent)',
                color: 'var(--color-danger, #dc2626)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-danger, #dc2626) 16%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-danger, #dc2626) 8%, transparent)';
              }}
            >
              {t('local_sync.peer_remove')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
