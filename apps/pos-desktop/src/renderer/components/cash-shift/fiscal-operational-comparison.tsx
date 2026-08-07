/**
 * Fiscal vs operational payment-method comparison table.
 *
 * Renders the per-method fiscal (DIAN) and operational (droguería) totals
 * side by side with the per-method difference, so the cashier can see at a
 * glance which payment methods drifted and by how much. Shown inside the
 * reconciliation view when the shift carries payment adjustments.
 *
 * @category Component
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "../../utils/format-currency";
import type { ShiftFiscalComparison } from "../../../domain/cash-shift/cash-shift.service";

type ComparisonTotals = ShiftFiscalComparison["totals"];

interface FiscalOperationalComparisonProps {
  /** Per-method fiscal/operational totals (union of both maps). */
  totals: ComparisonTotals;
}

const asNumber = (amount: string): number => Number(amount);

export const FiscalOperationalComparison: FC<FiscalOperationalComparisonProps> = ({
  totals,
}) => {
  const { t } = useTranslation();

  const summary = useMemo(() => {
    let fiscal = 0;
    let operational = 0;
    for (const row of totals) {
      fiscal += asNumber(row.fiscalAmount);
      operational += asNumber(row.operationalAmount);
    }
    return { fiscal, operational, difference: operational - fiscal };
  }, [totals]);

  return (
    <section
      aria-label={t("cash_shift.operational_drift.comparison_title")}
      className="rounded-pos border p-pos-md"
      style={{
        borderColor: "color-mix(in srgb, var(--color-urgency) 30%, transparent)",
      }}
    >
      <h3 className="mb-pos-sm text-body-sm font-semibold" style={{ color: "var(--color-ink)" }}>
        {t("cash_shift.operational_drift.comparison_title")}
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr
              style={{
                borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 8%, transparent)",
              }}
            >
              <th className="py-pos-xs pr-pos-md font-medium text-caption" style={{ color: "var(--color-ink-muted)" }}>
                {t("cash_shift.wizard_method")}
              </th>
              <th className="py-pos-xs pr-pos-md font-medium text-caption text-right" style={{ color: "var(--color-ink-muted)" }}>
                {t("cash_shift.operational_drift.comparison_fiscal")}
              </th>
              <th className="py-pos-xs pr-pos-md font-medium text-caption text-right" style={{ color: "var(--color-ink-muted)" }}>
                {t("cash_shift.operational_drift.comparison_operational")}
              </th>
              <th className="py-pos-xs font-medium text-caption text-right" style={{ color: "var(--color-ink-muted)" }}>
                {t("cash_shift.operational_drift.comparison_difference")}
              </th>
            </tr>
          </thead>
          <tbody>
            {totals.map((row) => {
              const difference =
                asNumber(row.operationalAmount) - asNumber(row.fiscalAmount);
              const hasDifference = difference !== 0;
              return (
                <tr
                  key={row.paymentMethodId}
                  style={{
                    borderBottom: "1px solid color-mix(in srgb, var(--color-ink) 5%, transparent)",
                  }}
                  className="hover:opacity-80"
                >
                  <td className="py-pos-xs pr-pos-md font-data">
                    {row.methodName}
                    {row.isCash && (
                      <span className="ml-pos-xs text-caption" style={{ color: "var(--color-ink-muted)" }}>
                        ({t("cash_shift.cash")})
                      </span>
                    )}
                  </td>
                  <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right">
                    {formatCurrency(asNumber(row.fiscalAmount) * 100)}
                  </td>
                  <td className="py-pos-xs pr-pos-md font-data tabular-nums text-right">
                    {formatCurrency(asNumber(row.operationalAmount) * 100)}
                  </td>
                  <td
                    className="py-pos-xs font-data tabular-nums text-right"
                    style={{
                      color: hasDifference
                        ? "var(--color-urgency)"
                        : "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                    }}
                  >
                    {hasDifference
                      ? `${difference > 0 ? "+" : ""}${formatCurrency(Math.abs(difference) * 100)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr>
              <td className="pt-pos-sm pr-pos-md font-semibold">
                {t("cash_shift.wizard_total")}
              </td>
              <td className="pt-pos-sm pr-pos-md font-data tabular-nums text-right font-semibold">
                {formatCurrency(summary.fiscal * 100)}
              </td>
              <td className="pt-pos-sm pr-pos-md font-data tabular-nums text-right font-semibold">
                {formatCurrency(summary.operational * 100)}
              </td>
              <td
                className="pt-pos-sm font-data tabular-nums text-right font-semibold"
                style={{
                  color:
                    summary.difference !== 0
                      ? "var(--color-urgency)"
                      : "color-mix(in srgb, var(--color-ink) 45%, transparent)",
                }}
              >
                {summary.difference !== 0
                  ? `${summary.difference > 0 ? "+" : ""}${formatCurrency(Math.abs(summary.difference) * 100)}`
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};
