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
      <svg className="h-3.5 w-3.5 animate-pulse" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clipRule="evenodd" />
      </svg>
    ),
  },
  fresh: {
    color: 'bg-green-50 text-green-700 ring-green-500/30',
    label: 'Token OK',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
    ),
  },
  refreshed: {
    color: 'bg-blue-50 text-blue-700 ring-blue-500/30',
    label: 'Token Refreshed',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
      </svg>
    ),
  },
  exchanged: {
    color: 'bg-indigo-50 text-indigo-700 ring-indigo-500/30',
    label: 'Token Exchanged',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902a48.94 48.94 0 003.017.355.75.75 0 00.046-1.497 47.425 47.425 0 00-2.943-.342.276.276 0 01-.2-.127.276.276 0 01-.053-.223l1.215-2.427 2.143.524a.75.75 0 00.416-1.44l-1.875-.468a.427.427 0 00-.416.101.47.47 0 00-.107.425l.428 1.718a48.595 48.595 0 01-2.219-.278.75.75 0 00-.094 1.497 50.079 50.079 0 003.67.412.75.75 0 00.746-.659l.042-.332a.75.75 0 00-1.492-.082.276.276 0 01-.023.087l-.014.026-.004.007h-.002l.005-.01zm4.5 8.83V10.5a.75.75 0 00-1.5 0v2.25a.75.75 0 00.75.75h2.25a.75.75 0 000-1.5h-.38A7.003 7.003 0 0010 3a.75.75 0 00-.7 1.335 5.48 5.48 0 014.67 2.81c.063.13.112.27.156.408l-.963-.24a.75.75 0 10-.3 1.47l1.876.468a.427.427 0 00.416-.1.47.47 0 00.107-.426l-.43-1.718.001.002z" clipRule="evenodd" />
      </svg>
    ),
  },
  failed: {
    color: 'bg-red-50 text-red-700 ring-red-500/30',
    label: 'Auth Error',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
      </svg>
    ),
  },
  no_session: {
    color: 'bg-gray-100 text-gray-500 ring-gray-300',
    label: 'No Session',
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM5.75 8a1.25 1.25 0 112.5 0 1.25 1.25 0 01-2.5 0zm6.75 1.25a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5zM7.25 12a4.24 4.24 0 015.5 0 .75.75 0 01-1.06 1.06 2.74 2.74 0 00-3.38 0A.75.75 0 017.25 12z" clipRule="evenodd" />
      </svg>
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
