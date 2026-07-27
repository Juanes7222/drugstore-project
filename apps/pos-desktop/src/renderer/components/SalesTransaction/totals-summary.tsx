/**
 * Totals summary block: subtotal, IVA, and grand total.
 *
 * All monetary values are rendered with the data/mono face and tabular
 * figures so the cashier can read them at a glance while the customer watches.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/utils/format-currency";

interface TotalsSummaryProps {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /**
   * Unique taxPercentage that all cart items share.
   * null when items have mixed rates — shows "IVA" without percentage.
   * Example: 19 → "IVA (19%)", null → "IVA".
   */
  uniqueRate: number | null;
}

export const TotalsSummary: FC<TotalsSummaryProps> = ({
  subtotalCents,
  taxCents,
  totalCents,
  uniqueRate,
}) => {
  const { t } = useTranslation();

  const taxLabel =
    uniqueRate !== null
      ? t("sales.cart.tax", { rate: uniqueRate })
      : t("sales.cart.tax_mixed");

  return (
    <div className="mt-auto pt-pos-md">
      <div
        className="pos-divider mb-pos-md"
        style={{ borderTopColor: "color-mix(in srgb, var(--color-ink) 15%, transparent)" }}
      />

      <div className="flex justify-between text-body">
        <span style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}>
          {t("sales.cart.subtotal")}
        </span>
        <span className="font-data tabular-nums">
          {formatCurrency(subtotalCents)}
        </span>
      </div>

      <div className="mt-pos-xs flex justify-between text-body">
        <span style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}>
          {taxLabel}
        </span>
        <span className="font-data tabular-nums">{formatCurrency(taxCents)}</span>
      </div>

      <div
        className="pos-divider my-pos-md"
        style={{ borderTopColor: "color-mix(in srgb, var(--color-ink) 25%, transparent)" }}
      />

      <div className="flex justify-between text-total font-bold">
        <span style={{ color: "var(--color-ink)" }}>{t("sales.cart.total")}</span>
        <span className="font-data tabular-nums">{formatCurrency(totalCents)}</span>
      </div>
    </div>
  );
};
