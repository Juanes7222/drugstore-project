/**
 * Persistent cash-shift header displayed on every POS screen.
 *
 * Shows cashier name, opening balance (from props or from the cash-shift
 * store), elapsed active time, and a small sync-state control (dev-only) so
 * reviewers can verify all three Ambient Sync Pulse states without leaving
 * the screen.
 *
 * When the props are omitted (undefined) the component falls back to the
 * current open shift from the cash-shift Zustand store — meaning most
 * callers in App.tsx can simply omit openingBalanceCents / openedAt and
 * get real data automatically.
 */
import { type FC, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useElapsedTime } from "@/hooks/use-elapsed-time";
import { formatCurrency } from "@/utils/format-currency";
import { SyncState } from "./sync-pulse";
import { useCashShiftStore } from "../../../domain/cash-shift/cash-shift.store";

interface CashShiftHeaderProps {
  cashierName: string;
  /** Optional: fallback to current open shift from the store. */
  openingBalanceCents?: number;
  /** Optional: fallback to current open shift from the store. */
  openedAt?: string;
  syncState: SyncState;
  onSyncStateChange?: (state: SyncState) => void;
}

const SYNC_STATES: SyncState[] = ["online", "offline", "draining"];

export const CashShiftHeader: FC<CashShiftHeaderProps> = ({
  cashierName,
  openingBalanceCents: openingBalanceCentsProp,
  openedAt: openedAtProp,
  syncState,
  onSyncStateChange,
}) => {
  const { t } = useTranslation();

  // Read current open shift from store as fallback (vanilla zustand)
  const cashShiftState = useSyncExternalStore(
    useCashShiftStore.subscribe,
    () => useCashShiftStore.getState(),
  );
  const currentShift = cashShiftState.currentShift;

  const openingBalanceCents =
    openingBalanceCentsProp ??
    (currentShift ? Number(currentShift.openingBalance) * 100 : 0);

  const openedAt =
    openedAtProp ?? (currentShift?.openedAt?.toISOString() ?? new Date().toISOString());

  const elapsed = useElapsedTime(openedAt, true);

  return (
    <header
      className="flex items-center justify-between px-pos-md py-pos-sm bg-panel"
      style={{
        borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
      }}
    >
      <div className="flex items-center gap-pos-lg">
        <span className="text-body font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("cash_shift.label")}: {cashierName}
        </span>
        <span className="text-caption" style={{ color: "color-mix(in srgb, var(--color-ink) 60%, transparent)" }}>
          {t("cash_shift.opening_balance")}:{" "}
          <span className="font-data tabular-nums">
            {formatCurrency(openingBalanceCents)}
          </span>
        </span>
        <span
          className="font-data tabular-nums text-body"
          style={{ color: "var(--color-pharma)" }}
        >
          {elapsed} {t("cash_shift.active")}
        </span>
      </div>

      {onSyncStateChange && (
        <div className="flex items-center gap-pos-xs" role="group" aria-label={t("sync.state_online")}>
          {SYNC_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => onSyncStateChange(state)}
              className={`pos-button text-caption px-pos-sm py-pos-xs ${
                syncState === state ? "pos-button-primary" : "pos-button-secondary"
              }`}
              aria-pressed={syncState === state}
            >
              {t(`sync.state_${state}`)}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};
