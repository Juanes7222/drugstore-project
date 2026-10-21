/**
 * Persistent cash-shift header displayed on every POS screen.
 *
 * Hierarchy (bento-like): the state badge is the visual anchor, the store-
 * wide "Turno de caja" label sits above it in sentence case at caption
 * size — no uppercase eyebrow. Facts group by proximity (balance + elapsed
 * time share one cluster, separated from the badge by real space, not
 * divider dots). All figures use the data face (JetBrains Mono tabular).
 *
 * Shows the store-wide shift STATE first (open / none), the opening balance
 * and elapsed active time while a shift is open. The shift belongs to the
 * store, not to this workstation or user — the logged-in operator is shown
 * separately by the QuickSwitch in the AppShell header row.
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
import { useCashShiftStore } from "../../../domain/cash-shift/cash-shift.store";

interface CashShiftHeaderProps {
  /** Optional: fallback to current open shift from the store. */
  openingBalanceCents?: number;
  /** Optional: fallback to current open shift from the store. */
  openedAt?: string;
}

export const CashShiftHeader: FC<CashShiftHeaderProps> = ({
  openingBalanceCents: openingBalanceCentsProp,
  openedAt: openedAtProp,
}) => {
  const { t } = useTranslation();

  // Read current open shift from store as fallback (vanilla zustand)
  const cashShiftState = useSyncExternalStore(useCashShiftStore.subscribe, () =>
    useCashShiftStore.getState(),
  );
  const currentShift = cashShiftState.currentShift;

  const openingBalanceCents =
    openingBalanceCentsProp ??
    (currentShift ? Number(currentShift.openingBalance) * 100 : 0);

  const openedAt =
    openedAtProp ??
    currentShift?.openedAt?.toISOString() ??
    new Date().toISOString();

  // Only tick the elapsed timer while a store-wide shift is actually open.
  // A caller-supplied balance/time counts as an open shift too (callers that
  // pass explicit props own their shift source).
  const hasOpenShift =
    Boolean(currentShift) || openingBalanceCentsProp !== undefined;
  const elapsed = useElapsedTime(openedAt, hasOpenShift);

  return (
    <header className="flex min-w-0 flex-1 items-center bg-panel px-pos-md py-pos-xs">
      <div className="flex min-w-0 items-center gap-x-4">
        {/* State badge — the anchor. Label + badge read as one unit before
            the facts cluster. */}
        <div className="flex shrink-0 flex-col justify-center leading-tight">
          <span
            className="text-caption-2 font-medium"
            style={{ color: "var(--color-ink-muted)" }}
          >
            {t("cash_shift.header_label")}
          </span>
          {currentShift ? (
            <span
              className="mt-0.5 inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-0.5 text-body-sm font-semibold"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-pharma) 12%, transparent)",
                color: "var(--color-pharma)",
              }}
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--color-pharma)" }}
              />
              {t("cash_shift.state_open")}
            </span>
          ) : (
            <span
              className="mt-0.5 inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-0.5 text-body-sm font-semibold"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-sync) 10%, transparent)",
                color: "var(--color-sync)",
              }}
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--color-sync)" }}
              />
              {t("cash_shift.no_open_shift_short")}
            </span>
          )}
        </div>

        {/* Facts cluster — grouped by proximity, data face for figures. */}
        {hasOpenShift && (
          <div
            className="flex min-w-0 flex-col gap-0.5 border-l pl-pos-md"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-ink) 10%, transparent)",
            }}
          >
            <span
              className="text-caption-2 font-medium"
              style={{ color: "var(--color-ink-muted)" }}
            >
              {t("cash_shift.opening_balance")}
            </span>
            <div className="flex items-baseline gap-x-3">
              <span
                className="font-data whitespace-nowrap text-body-sm font-semibold tabular-nums"
                style={{ color: "var(--color-ink)" }}
              >
                {formatCurrency(openingBalanceCents)}
              </span>
              <span
                className="font-data whitespace-nowrap text-body-sm font-semibold tabular-nums"
                style={{ color: "var(--color-pharma)" }}
              >
                {elapsed}
              </span>
              <span
                className="whitespace-nowrap text-caption-2"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {t("cash_shift.active")}
              </span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
