/**
 * Reactive Zustand store for contingency mode state.
 *
 * The store mirrors the authoritative state in the local database
 * (ContingencyEvent rows) so React components can react to entry/exit
 * transitions without polling. Services are responsible for keeping the
 * store in sync with the database.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';

export interface ContingencyState {
  /** True when there is an active contingency event (no endedAt). */
  active: boolean;
  /** ID of the active contingency event, if any. */
  activeEventId: string | null;
  /** Human-readable trigger reason for the active event. */
  triggerReason: string | null;
  /** ISO-8601 timestamp when the active event started. */
  startedAt: string | null;
  /** Number of invoices generated during the active event. */
  invoicesGenerated: number;
  /** Number of invoices transmitted during the active event. */
  invoicesTransmitted: number;
  /** Number of invoices that expired during the active event. */
  invoicesExpired: number;
}

export interface ContingencyActions {
  enter(eventId: string, triggerReason: string, startedAt: Date): void;
  exit(): void;
  updateCounts(counts: {
    invoicesGenerated?: number;
    invoicesTransmitted?: number;
    invoicesExpired?: number;
  }): void;
}

export type ContingencyStore = StoreApi<ContingencyState & ContingencyActions>;

const initialState: ContingencyState = {
  active: false,
  activeEventId: null,
  triggerReason: null,
  startedAt: null,
  invoicesGenerated: 0,
  invoicesTransmitted: 0,
  invoicesExpired: 0,
};

export const useContingencyStore: ContingencyStore = createStore<
  ContingencyState & ContingencyActions
>((set) => ({
  ...initialState,

  enter(eventId, triggerReason, startedAt) {
    set({
      active: true,
      activeEventId: eventId,
      triggerReason,
      startedAt: startedAt.toISOString(),
      invoicesGenerated: 0,
      invoicesTransmitted: 0,
      invoicesExpired: 0,
    });
  },

  exit() {
    set({ ...initialState });
  },

  updateCounts(counts) {
    set((state) => ({
      invoicesGenerated:
        counts.invoicesGenerated ?? state.invoicesGenerated,
      invoicesTransmitted:
        counts.invoicesTransmitted ?? state.invoicesTransmitted,
      invoicesExpired:
        counts.invoicesExpired ?? state.invoicesExpired,
    }));
  },
}));
