/**
 * Per-line money math for the cart — the single source of truth shared by
 * the sales slice totals and every UI that displays a line amount.
 *
 * Kept out of the slice so components can read the same figures the totals
 * are derived from instead of re-deriving them.
 */
import { CartItem } from "./sales-types";

export interface CartItemMoney {
  /** Line total in cents after the line's discount. */
  lineTotalCents: number;
  /** Tax in cents, computed on the discounted line total. */
  taxCents: number;
}

/**
 * Per-item money math, mirroring the domain sale service so the totals the
 * cashier sees are exactly what the DB records and the payment screen
 * charges:
 *   - discount = round(subtotal × pct / 100) to the cent
 *   - line total = subtotal − discount
 *   - tax = round(line total × rate / 100) to the cent
 *
 * The discount is rounded once, on the subtotal. Rounding the discounted
 * *unit* price and multiplying by the quantity instead diverges by a centavo
 * on lines like 3 × $3.33 at 10%, so the row total would stop matching the
 * subtotal summed from the same rows.
 *
 * The service applies the same per-item centavos rounding (ROUND_HALF_UP),
 * so the frontend total can never drift from sale.totalAmount — a drift of
 * a cent or more made credit-only payments look overpaid and threw
 * ChangeRequiresCashPaymentException at confirm time.
 */
export function computeCartItemMoney(item: CartItem): CartItemMoney {
  const subtotalCents = item.unitPriceCents * item.quantity;
  const discountCents = Math.round(
    (subtotalCents * (item.discountPercentage ?? 0)) / 100,
  );
  const lineTotalCents = subtotalCents - discountCents;
  const taxRate = (item.taxPercentage ?? 0) / 100;
  return {
    lineTotalCents,
    taxCents: Math.round(lineTotalCents * taxRate),
  };
}
