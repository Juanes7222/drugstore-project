/**
 * Format an integer amount of Colombian pesos (COP) for display.
 *
 * The POS always uses Colombian formatting (`es-CO`) so the cashier sees the
 * peso symbol and dot thousand separators regardless of the active UI
 * language. Tabular figures are applied by the component layer.
 */
export const formatCurrency = (amountCents: number): string => {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(amountCents);
};
