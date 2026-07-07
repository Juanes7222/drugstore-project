/**
 * Persistent cash-shift header displayed on every POS screen.
 *
 * Shows cashier name, opening balance, elapsed active time, and a small
 * sync-state control (dev-only) so reviewers can verify all three Ambient
 * Sync Pulse states without leaving the screen.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { useElapsedTime } from "@/hooks/use-elapsed-time";
import { formatCurrency } from "@/utils/format-currency";
import { SyncState } from "./sync-pulse";

interface CashShiftHeaderProps {
  cashierName: string;
  openingBalanceCents: number;
  openedAt: string;
  syncState: SyncState;
  onSyncStateChange?: (state: SyncState) => void;
}

const SYNC_STATES: SyncState[] = ["online", "offline", "draining"];

export const CashShiftHeader: FC<CashShiftHeaderProps> = ({
  cashierName,
  openingBalanceCents,
  openedAt,
  syncState,
  onSyncStateChange,
}) => {
  const { t } = useTranslation();
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
