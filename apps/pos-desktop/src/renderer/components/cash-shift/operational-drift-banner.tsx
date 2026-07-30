/**
 * Operational-drift notification banner for the cash-shift reconciliation screen.
 *
 * Informs the cashier that operational adjustments exist on one or more invoices
 * within the current shift, so the displayed totals may differ from the
 * fiscal/DIAN totals. Available as a full-width banner or a compact inline badge.
 *
 * @category Component
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertTriangleIcon, InfoIcon } from "@/components/ui/icons";

/* ────────────────── Props ────────────────── */

export interface OperationalDriftBannerProps {
  /** Whether operational drift exists (controls visibility). */
  hasDrift: boolean;
  /** Number of operational adjustments applied to invoices in the shift. */
  adjustmentCount: number;
  /**
   * Absolute difference between fiscal and operational totals, in COP cents.
   * Displayed below the body text when provided.
   */
  driftAmount?: number;
  /**
   * Callback to switch between fiscal and operational viewing modes.
   * When provided, a toggle button is rendered inside the banner.
   */
  onToggleView?: () => void;
  /**
   * Display variant:
   * - `'banner'` — Full-width amber panel with left border accent, icon, and toggle button.
   * - `'inline'` — Compact amber pill badge for embedding next to a total or row.
   * @default 'banner'
   */
  variant?: "banner" | "inline";
}

/* ────────────────── Banner variant ────────────────── */

const BannerVariant: FC<OperationalDriftBannerProps> = ({
  adjustmentCount,
  driftAmount,
  onToggleView,
}) => {
  const { t } = useTranslation();

  const driftLine = useMemo(() => {
    if (driftAmount === undefined) return null;
    return t("cash_shift.operational_drift.banner_drift_amount", {
      amount: new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0,
      }).format(driftAmount),
    });
  }, [driftAmount, t]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-pos-md rounded-pos border-l-[3px] px-pos-md py-pos-sm"
      style={{
        backgroundColor: "var(--color-urgency-surface)",
        borderLeftColor: "var(--color-urgency)",
      }}
    >
      {/* Icon column */}
      <div className="flex pt-0.5">
        <InfoIcon size={20} style={{ color: "var(--color-urgency)" }} />
      </div>

      {/* Text column */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body font-semibold" style={{ color: "var(--color-ink)" }}>
          {t("cash_shift.operational_drift.banner_title")}
        </p>
        <p
          className="text-body-sm leading-snug"
          style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
        >
          {t("cash_shift.operational_drift.banner_body", {
            count: adjustmentCount,
          })}
        </p>
        {driftLine && (
          <p
            className="font-data tabular-nums text-body-sm mt-0.5"
            style={{ color: "var(--color-urgency)" }}
          >
            {driftLine}
          </p>
        )}
      </div>

      {/* Toggle button column */}
      {onToggleView && (
        <div className="flex shrink-0 items-start pt-1">
          <button
            type="button"
            onClick={onToggleView}
            className="cursor-pointer rounded-pos px-pos-sm py-pos-xs text-body-sm font-medium whitespace-nowrap transition-colors duration-100"
            style={{
              backgroundColor: "transparent",
              color: "var(--color-ink)",
              border: "1px solid color-mix(in srgb, var(--color-ink) 15%, transparent)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--color-urgency) 10%, transparent)";
              e.currentTarget.style.borderColor = "var(--color-urgency)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--color-ink) 15%, transparent)";
            }}
          >
            {t("cash_shift.operational_drift.banner_toggle_button")}
          </button>
        </div>
      )}
    </div>
  );
};

/* ────────────────── Inline variant ────────────────── */

const InlineVariant: FC<OperationalDriftBannerProps> = ({
  adjustmentCount,
}) => {
  const { t } = useTranslation();

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 rounded-full px-pos-sm py-0.5 font-data tabular-nums text-caption font-medium"
      style={{
        backgroundColor: "var(--color-urgency-surface)",
        color: "var(--color-urgency)",
      }}
    >
      <AlertTriangleIcon size={14} style={{ color: "var(--color-urgency)" }} />
      <span>{t("cash_shift.operational_drift.inline_label")}</span>
      <span aria-hidden="true">&middot;</span>
      <span>{adjustmentCount}</span>
    </span>
  );
};

/* ────────────────── Root component ────────────────── */

export const OperationalDriftBanner: FC<OperationalDriftBannerProps> = ({
  hasDrift,
  adjustmentCount,
  driftAmount,
  onToggleView,
  variant = "banner",
}) => {
  if (!hasDrift) return null;

  const isBanner = variant === "banner";

  return (
    <motion.div
      initial={isBanner ? { opacity: 0, y: -12 } : { opacity: 0, scale: 0.95 }}
      animate={isBanner ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {isBanner ? (
        <BannerVariant
          hasDrift={hasDrift}
          adjustmentCount={adjustmentCount}
          driftAmount={driftAmount}
          onToggleView={onToggleView}
          variant="banner"
        />
      ) : (
        <InlineVariant
          hasDrift={hasDrift}
          adjustmentCount={adjustmentCount}
          driftAmount={driftAmount}
          onToggleView={onToggleView}
          variant="inline"
        />
      )}
    </motion.div>
  );
};
