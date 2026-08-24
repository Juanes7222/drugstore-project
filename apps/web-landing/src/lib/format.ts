import type { BillingPeriod } from '@pharmacy/shared-types';

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** Format a cents amount as Colombian pesos, e.g. `19900000` → `$ 199.000`. */
export function formatCOP(amountCents: number): string {
  return copFormatter.format(amountCents / 100);
}

/**
 * Total price for a billing period. Mirrors calculateAmount() in the server's
 * checkout controller exactly — if that formula changes there, change it here
 * or the displayed total will disagree with what Wompi charges.
 *
 * MONTHLY = base · QUARTERLY = 3 months −10 % · ANNUAL = 12 months −20 %.
 */
export function calculatePeriodPriceCents(
  basePriceCents: number,
  period: BillingPeriod,
): number {
  switch (period) {
    case 'QUARTERLY':
      return Math.round(basePriceCents * 3 * 0.9);
    case 'ANNUAL':
      return Math.round(basePriceCents * 12 * 0.8);
    case 'MONTHLY':
    default:
      return basePriceCents;
  }
}

/** Months covered by a billing period, used for the "≈ per month" line. */
export function periodMonths(period: BillingPeriod): number {
  switch (period) {
    case 'QUARTERLY':
      return 3;
    case 'ANNUAL':
      return 12;
    case 'MONTHLY':
    default:
      return 1;
  }
}
