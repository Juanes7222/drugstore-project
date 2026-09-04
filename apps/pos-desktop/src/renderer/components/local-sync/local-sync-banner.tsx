/**
 * Local-sync status banner.
 *
 * Compact top-bar indicator showing the current local-sync connection state.
 * Clicking navigates to the local network management page.
 *
 * @category Local Sync
 */

import { type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpFromLineIcon, ServerIcon } from "@/components/ui/icons";
import { useLocalSync } from '../../hooks/use-local-sync';
import { useAppDispatch } from '../../store/hooks';
import { navigateToLocalNetwork } from '../../store/slices/ui-slice';
import { HubStatusIcon } from "@/components/ui/icons/animated";

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const STATE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  connected: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-400',
  },
  pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-400',
  },
  disconnected: {
    bg: 'bg-red-50',
    text: 'text-red-800',
    border: 'border-red-400',
  },
  hubActive: {
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-400',
  },
  reconnecting: {
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    border: 'border-gray-300',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LocalSyncBanner: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const {
    isConnected,
    isDisconnected,
    isReconnecting,
    isThisWorkstationHub,
    hasPendingOps,
    pendingPushCount,
    pendingPullCount,
    currentHub,
  } = useLocalSync();

  const handleClick = useCallback(() => {
    dispatch(navigateToLocalNetwork());
  }, [dispatch]);

  // Debug trace for split-brain banner
  console.log('[local-sync-banner]', {
    isThisWorkstationHub,
    isDisconnected,
    isConnected,
    hasPendingOps,
    currentHub: currentHub?.workstationId,
    isSelf: currentHub?.isSelf,
    friendlyName: currentHub?.friendlyName,
  });

  // Determine which state to show (prioritised).
  let stateKey: string;
  let label: string;

  if (isThisWorkstationHub) {
    stateKey = 'hubActive';
    label = t('local_sync.banner_hub_active');
  } else if (isReconnecting) {
    stateKey = 'reconnecting';
    label = t('local_sync.banner_transitioning');
  } else if (isDisconnected) {
    stateKey = 'disconnected';
    label = t('local_sync.banner_disconnected');
  } else if (hasPendingOps) {
    stateKey = 'pending';
    const totalPending = pendingPushCount + pendingPullCount;
    label = t('local_sync.banner_pending', { count: totalPending });
  } else if (isConnected) {
    stateKey = 'connected';
    label = t('local_sync.banner_connected', { hubName: currentHub?.friendlyName ?? '—' });
  } else {
    // Fallback: show disconnected while initialising.
    stateKey = 'disconnected';
    label = t('local_sync.banner_disconnected');
  }

  const styles = STATE_STYLES[stateKey] ?? STATE_STYLES.disconnected;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-center gap-2 border-b px-4 py-1.5 text-xs font-medium transition-colors hover:brightness-95 ${styles.bg} ${styles.text} ${styles.border}`}
      aria-label={label}
    >
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
        {isThisWorkstationHub && (
          <>
            <HubStatusIcon status="connected" size={14} ariaLabel="" />
            <ServerIcon size={12} strokeWidth={2} />
          </>
        )}
        {isReconnecting && (
          <HubStatusIcon status="electing" size={14} ariaLabel="" />
        )}
        {isDisconnected && !isReconnecting && (
          <HubStatusIcon status="disconnected" size={14} ariaLabel="" />
        )}
        {hasPendingOps && !isDisconnected && (
          <ArrowUpFromLineIcon size={12} strokeWidth={2} className="text-amber-600" />
        )}
        {isConnected && !hasPendingOps && !isThisWorkstationHub && (
          <HubStatusIcon status="connected" size={14} ariaLabel="" />
        )}
      </span>

      <span className="truncate">{label}</span>
    </button>
  );
};
