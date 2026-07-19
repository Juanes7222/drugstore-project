/**
 * Hook that checks whether an active cash shift exists for the current
 * workstation and returns the store's loading state.
 *
 * Consumed by the sales-screen guard (App.tsx) and by any component that
 * must conditionally block or allow an operation based on shift status.
 *
 * ## Usage
 * ```tsx
 * const { hasActiveShift, isLoading } = useRequireActiveShift();
 * if (isLoading) return <Spinner />;
 * if (!hasActiveShift) return <ShiftRequiredOverlay />;
 * return <SalesTransaction />;
 * ```
 */
import { useSyncExternalStore } from 'react';
import { useCashShiftStore } from '../../domain/cash-shift/cash-shift.store';

export interface RequireActiveShiftResult {
  /** True when an open shift is present in the store. */
  hasActiveShift: boolean;
  /** True while the store is being hydrated from the database. */
  isLoading: boolean;
}

export function useRequireActiveShift(): RequireActiveShiftResult {
  const state = useSyncExternalStore(
    useCashShiftStore.subscribe,
    () => useCashShiftStore.getState(),
  );

  return {
    hasActiveShift: state.currentShift !== null,
    isLoading: state.isLoading,
  };
}
