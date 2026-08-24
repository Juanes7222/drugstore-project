/**
 * Module-scoped reactive state for sync ledger integrity results.
 *
 * Holds the outcome of the last post-reconnect verification so any sync
 * surface (sync-health page, banners) can render a non-blocking review
 * notice without re-running the network check. The count is advisory only:
 * nothing in the app may auto-delete or auto-modify local queue data based
 * on it — remediation is manual/administrative.
 */

import { create } from 'zustand';

interface SyncIntegrityState {
  /**
   * Number of operations whose last verdict was not OK. `null` means no
   * verification has run (or the last one was inconclusive/failed).
   */
  reviewRequiredCount: number | null;
  /** Server `checkedAt` of the last completed verification. */
  checkedAt: string | null;
}

interface SyncIntegrityActions {
  setReviewRequired: (count: number, checkedAt: string | null) => void;
  clearReviewRequired: () => void;
}

export type SyncIntegrityStore = SyncIntegrityState & SyncIntegrityActions;

export const useSyncIntegrityStore = create<SyncIntegrityStore>()((set) => ({
  reviewRequiredCount: null,
  checkedAt: null,
  setReviewRequired: (count, checkedAt) =>
    set({ reviewRequiredCount: count, checkedAt }),
  clearReviewRequired: () => set({ reviewRequiredCount: null, checkedAt: null }),
}));
