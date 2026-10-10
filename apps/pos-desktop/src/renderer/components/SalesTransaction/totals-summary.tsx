/**
 * Cart totals: subtotal, tax, optional delivery fee, and the grand total.
 *
 * The grand total is the amount being charged, so it is the largest glyph in
 * the cart and sits in the same right-aligned tabular mono column as every
 * figure above it — the cashier and the customer read one aligned edge.
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
    color: "color-mix(in srgb, var(--color-ink) 65%, transparent)",
  };
  const taxLabel =
    uniqueRate !== null
      ? t("sales.cart.tax", { rate: uniqueRate })
      : t("sales.cart.tax_mixed");

  return (
    <div>
      <div className="space-y-pos-xs">
        <div className="flex justify-between gap-pos-md">
          <span className="text-body-sm" style={mutedStyle}>
            {t("sales.cart.subtotal")}
          </span>
          <span
            className="font-data text-body-sm tabular-nums"
            style={mutedStyle}
          >
            {formatCurrency(subtotalCents)}
          </span>
        </div>
        <div className="flex justify-between gap-pos-md">
          <span className="text-body-sm" style={mutedStyle}>
            {taxLabel}
          </span>
          <span
            className="font-data text-body-sm tabular-nums"
            style={mutedStyle}
          >
            {formatCurrency(taxCents)}
          </span>
        </div>
        {deliveryFeeCents > 0 && (
          <div className="flex justify-between gap-pos-md">
            <span className="text-body-sm" style={mutedStyle}>
              {t("delivery.fee")}
            </span>
            <span
              className="font-data text-body-sm tabular-nums"
              style={mutedStyle}
            >
              {formatCurrency(deliveryFeeCents)}
            </span>
          </div>
        )}
      </div>

      <hr className="pos-divider my-pos-sm" />

      <div className="flex items-baseline justify-between gap-pos-md">
        <span
          className="text-body-sm font-semibold uppercase"
          style={{ letterSpacing: "0.04em", color: "var(--color-ink)" }}
        >
          {t("sales.cart.total")}
        </span>
        <span
          className="font-data text-amount font-bold tabular-nums"
          style={{ color: "var(--color-ink)" }}
        >
          {formatCurrency(totalCents)}
        </span>
      </div>
    </div>
  );
};
