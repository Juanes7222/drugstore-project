/**
 * Auth Status Badge — shows whether the sync scheduler's access token is
 * fresh, was recently refreshed, or has authentication failures.
 *
 * Reads directly from the Zustand `useSyncAuthStatusStore` so it always
 * reflects the latest state set by the SyncScheduler during each tick().
 *
 * @category Component
 */

import { type FC, useSyncExternalStore } from 'react';
import { useSyncAuthStatusStore, type SyncAuthStatus } from '../../../domain/sync/sync-auth-status.store';
import { Tooltip } from '../ui/tooltip';
import { CheckCircleIcon, RefreshCwIcon, RepeatIcon, UserCircleIcon, XCircleIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BadgeVisual {
  /** Tailwind ring/bg color group. */
  color: string;
  /** Short label shown on the badge. */
  label: string;
  /** Icon path data (20×20 heroicons-style). */
  icon: React.ReactNode;
}

const STATUS_VISUALS: Record<SyncAuthStatus, BadgeVisual> = {
  unknown: {
    color: 'bg-gray-100 text-gray-500 ring-gray-300',
    label: 'Checking\u2026',
    icon: (
      <LoaderIcon className="h-3.5 w-3.5" />
    ),
  },
  fresh: {
    color: 'bg-green-50 text-green-700 ring-green-500/30',
    label: 'Token OK',
    icon: (
      <CheckCircleIcon className="h-3.5 w-3.5" />
    ),
  },
  refreshed: {
    color: 'bg-blue-50 text-blue-700 ring-blue-500/30',
    label: 'Token Refreshed',
    icon: (
      <RefreshCwIcon className="h-3.5 w-3.5" />
    ),
  },
  exchanged: {
    color: 'bg-indigo-50 text-indigo-700 ring-indigo-500/30',
    label: 'Token Exchanged',
    icon: (
      <RepeatIcon className="h-3.5 w-3.5" />
    ),
  },
  failed: {
    color: 'bg-red-50 text-red-700 ring-red-500/30',
    label: 'Auth Error',
    icon: (
      <XCircleIcon className="h-3.5 w-3.5" />
    ),
  },
  no_session: {
    color: 'bg-gray-100 text-gray-500 ring-gray-300',
    label: 'No Session',
    icon: (
      <UserCircleIcon className="h-3.5 w-3.5" />
    ),
  },
};

// ---------------------------------------------------------------------------
// Subscribe helper (re-renders only when status changes)
// ---------------------------------------------------------------------------

function subscribeToStore(callback: () => void): () => void {
  return useSyncAuthStatusStore.subscribe(callback);
}

function getSnapshot(): SyncAuthStatus {
  return useSyncAuthStatusStore.getState().status;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AuthStatusBadge: FC = () => {
  const status = useSyncExternalStore(subscribeToStore, getSnapshot, getSnapshot);
  const visual = STATUS_VISUALS[status];

  // Subscribe to detail changes so the tooltip text stays current.
  const detail = useSyncExternalStore(
    (cb: () => void) => useSyncAuthStatusStore.subscribe(cb),
    () => useSyncAuthStatusStore.getState().detail,
    () => useSyncAuthStatusStore.getState().detail,
  );

  const tooltipText = detail || visual.label;

  return (
    <Tooltip label={tooltipText} position="top" delay={600}>
      <div
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors duration-300 ${visual.color}`}
      >
        {visual.icon}
        <span>{visual.label}</span>
      </div>
    </Tooltip>
  );
};
