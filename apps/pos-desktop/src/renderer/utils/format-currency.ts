/**
 * Format a price in cents (e.g., 250050 for $2,500.50 COP) as a currency
 * string in Colombian pesos.
 *
 * The POS always uses Colombian formatting (`es-CO`) so the cashier sees the
 * peso symbol and dot thousand separators regardless of the active UI
 * language. Tabular figures are applied by the component layer.
 *
 * COP centavos are not used in practice, so the formatted value is rounded
 * to the nearest whole peso (`maximumFractionDigits: 0`).
 */
export const formatCurrency = (amountCents: number): string => {
  const amountPesos = amountCents / 100;

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amountPesos);
};
