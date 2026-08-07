/**
 * Cash-shift reconciliation view.
 *
 * Displays the reconciliation screen for a cash shift, including the
 * operational-drift banner at the top when adjustments are present and a
 * side-by-side fiscal vs operational comparison table underneath.
 * This is a presentational container — the parent page (wired by pos-local)
 * supplies the drift data and mode-toggle callback.
 *
 * @category Component
 */

import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { OperationalDriftBanner } from "./operational-drift-banner";
import { FiscalOperationalComparison } from "./fiscal-operational-comparison";
import type { ShiftFiscalComparison } from "../../../domain/cash-shift/cash-shift.service";

export interface ReconciliationViewProps {
  /**
   * Data describing any operational drift present on the shift's invoices.
   * When `null` or undefined, the banner is hidden.
   */
  drift: {
    hasDrift: boolean;
    adjustmentCount: number;
    driftAmount?: number | string;
    /** Per-method fiscal/operational totals; renders the comparison table. */
    totals?: ShiftFiscalComparison["totals"];
  } | null;
  /**
   * Currently active viewing mode.
   * @default 'operational'
   */
  viewMode: "fiscal" | "operational";
  /**
   * Callback to toggle between fiscal and operational viewing modes.
   */
  onToggleView: () => void;
  /**
   * Label for the current shift (e.g. "Turno #POS-00427").
   */
  shiftLabel: string;
  /**
   * Children are rendered as the main reconciliation content
   * (totals table, payment-method breakdown, etc.).
   */
  children?: React.ReactNode;
}

export const ReconciliationView: FC<ReconciliationViewProps> = ({
  drift,
  viewMode,
  onToggleView,
  shiftLabel,
  children,
}) => {
  const { t } = useTranslation();
  // The banner toggle reveals/hides the side-by-side comparison table.
  const [showComparison, setShowComparison] = useState(true);

  const handleToggleView = () => {
    setShowComparison((visible) => !visible);
    onToggleView();
  };

  const comparisonTotals = drift?.hasDrift ? drift.totals : undefined;

  return (
    <section
      aria-label={t("cash_shift.label")}
      className="flex flex-col gap-pos-md"
    >
      {/* Operational-drift notification banner */}
      {drift && (
        <OperationalDriftBanner
          hasDrift={drift.hasDrift}
          adjustmentCount={drift.adjustmentCount}
          driftAmount={
            drift.driftAmount === undefined
              ? undefined
              : Number(drift.driftAmount)
          }
          onToggleView={handleToggleView}
          comparisonVisible={showComparison}
          variant="banner"
        />
      )}

      {/* Fiscal vs operational comparison table */}
      {comparisonTotals &&
        comparisonTotals.length > 0 &&
        showComparison && (
          <FiscalOperationalComparison totals={comparisonTotals} />
        )}

      {/* View-mode indicator */}
      <div className="flex items-center justify-between">
        <h2 className="pos-page-title m-0">{shiftLabel}</h2>
        <span
          className="inline-flex items-center gap-1.5 rounded-pos px-pos-sm py-pos-xs text-caption font-medium"
          style={{
            backgroundColor:
              viewMode === "operational"
                ? "var(--color-urgency-surface)"
                : "color-mix(in srgb, var(--color-pharma) 10%, transparent)",
            color:
              viewMode === "operational"
                ? "var(--color-urgency)"
                : "var(--color-pharma)",
          }}
        >
          {viewMode === "operational"
            ? t("fiscal.operational_operational")
            : t("fiscal.operational_fiscal")}
        </span>
      </div>

      {/* Main content — totals, payment breakdown, etc. */}
      <div className="pos-panel p-pos-md">
        {children ?? (
          <p
            className="text-body-sm m-0"
            style={{ color: "color-mix(in srgb, var(--color-ink) 50%, transparent)" }}
          >
            {t("common.loading")}
          </p>
        )}
      </div>
    </section>
  );
};
