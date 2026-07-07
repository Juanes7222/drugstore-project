/**
 * Format an integer amount of Colombian pesos (COP) for display.
 *
 * The locale is driven by the active i18n language so English users see the
 * same numeric grouping with the COP symbol.
 */
import i18n from "i18next";

export const formatCurrency = (amountCents: number): string => {
  return new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amountCents);
};
