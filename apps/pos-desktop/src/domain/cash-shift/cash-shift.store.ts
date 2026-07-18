/**
 * Zustand store for the current open cash shift.
 *
 * Holds the open shift record in memory for the lifetime of the running app
 * process. Hydrated from the local database at service startup (via
 * `initializeServices`) so every consumer — header, page, app-shell — reads
 * the same reactive state without redundant DB queries.
 *
 * ## Usage (React)
 * ```tsx
 * import { useCashShiftStore } from './cash-shift.store';
 * const shift = useCashShiftStore((s) => s.currentShift);
 * ```
 *
 * ## Usage (plain TS)
 * ```ts
 * const shift = useCashShiftStore.getState().currentShift;
 * ```
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PrismaClient } from '@pharmacy/database/local';
import type { CashShiftRecord } from './cash-shift.service';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CashShiftState {
  /** The currently-open shift, or null if no shift is open. */
  currentShift: CashShiftRecord | null;
  /** True while the store is being populated from the database. */
  isLoading: boolean;

  /** Replace the current shift record (after open / after DB hydrate). */
  setCurrentShift: (shift: CashShiftRecord | null) => void;
  /** Load the open shift from the local database for a given workstation. */
  hydrateFromDb: (
    prisma: PrismaClient,
    workstationId: string,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCashShiftStore: StoreApi<CashShiftState> = createStore<
  CashShiftState
>()((set) => ({
  currentShift: null,
  isLoading: true,

  setCurrentShift: (shift) => set({ currentShift: shift, isLoading: false }),

  hydrateFromDb: async (prisma, workstationId) => {
    try {
      const openShift = (await prisma.cashShift.findFirst({
        where: { workstationId, state: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      })) as CashShiftRecord | null;

      set({ currentShift: openShift, isLoading: false });
    } catch {
      set({ currentShift: null, isLoading: false });
    }
  },
}));

/** Convenience snapshot accessor for non-React callers. */
export const getCashShiftState = (): CashShiftState =>
  useCashShiftStore.getState();
