/**
 * Card totals with the IVA rate and an optional delivery-fee line.
 *
 * `totalCents` is the grand total (already fee-inclusive); the fee is
 * rendered as its own row above the divider so subtotal, tax, fee and
 * total stay unambiguous at a glance.
 */

import { type CSSProperties, type FC } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/utils/format-currency";

interface TotalsSummaryProps {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  uniqueRate: number | null;
  /** Delivery fee in cents; 0 renders no fee row. */
  deliveryFeeCents?: number;
}

export const TotalsSummary: FC<TotalsSummaryProps> = ({
  subtotalCents,
  taxCents,
  totalCents,
  uniqueRate,
  deliveryFeeCents = 0,
}) => {
  const { t } = useTranslation();
  const mutedStyle: CSSProperties = {
    color: "color-mix(in srgb, var(--color-ink) 70%, transparent)",
  };
  const taxLabel =
    uniqueRate !== null
      ? t("sales.cart.tax", { rate: uniqueRate })
      : t("sales.cart.tax_mixed");

  return (
    <div className="space-y-pos-sm">
      <div className="flex justify-between">
        <span className="text-body-sm" style={mutedStyle}>
          {t("sales.cart.subtotal")}
        </span>
        <span className="font-data text-body tabular-nums" style={mutedStyle}>
          {formatCurrency(subtotalCents)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-body-sm" style={mutedStyle}>
          {taxLabel}
        </span>
        <span className="font-data text-body tabular-nums" style={mutedStyle}>
          {formatCurrency(taxCents)}
        </span>
      </div>
      {deliveryFeeCents > 0 && (
        <div className="flex justify-between">
          <span className="text-body-sm" style={mutedStyle}>
            {t("delivery.fee")}
          </span>
          <span className="font-data text-body tabular-nums" style={mutedStyle}>
            {formatCurrency(deliveryFeeCents)}
          </span>
        </div>
      )}
      <div
        className="h-px"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--color-ink) 15%, transparent)",
        }}
      />
      <div className="flex justify-between">
        <span
          className="text-title font-medium"
          style={{ color: "var(--color-ink)" }}
        >
          {t("sales.cart.total")}
        </span>
        <span
          className="font-data text-title tabular-nums"
          style={{ color: "var(--color-ink)" }}
        >
          {formatCurrency(totalCents)}
        </span>
      </div>
    </div>
  );
};
