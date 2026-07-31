/**
 * Sales-commission calculation for the POS desktop app.
 *
 * Pure functions — no I/O, no React, no Prisma client. The sale service
 * feeds the product's commission configuration and the line totals into
 * `calculateCommission`, and the result is snapshotted onto the
 * `SaleItem` row so later catalog changes never rewrite history.
 *
 * ## Rules (product configuration)
 *
 * - `commissionType` selects the formula: PERCENTAGE (of the line
 *   subtotal after discount, before tax) or FIXED (per unit sold).
 * - `commissionValue` is the rate (percentage points) or the fixed
 *   amount in COP. A value of 0 behaves like no commission.
 * - `commissionStartsAt` / `commissionEndsAt` bound the validity
 *   window. Outside the window no commission accrues and the sale is
 *   NOT blocked — the line simply carries commissionAmount 0.
 * - The window is evaluated against the sale time, never against the
 *   sync time, so a late push does not change what a cashier earned.
 */
import { Prisma, CommissionType } from '@pharmacy/database/local';

export interface CommissionConfigInput {
  /** Optional so window-only checks don't need the full config. */
  type?: CommissionType | null;
  /** Percentage points (PERCENTAGE) or COP per unit (FIXED). */
  value?: Prisma.Decimal | string | number | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
}

export interface CommissionCalculationInput {
  /** Product's commission configuration at sale time. */
  config: CommissionConfigInput;
  /** Catalog unit price of the line (before discount). */
  unitPrice: Prisma.Decimal;
  quantity: number;
  /** Discount already applied to the line (unitPrice × qty × pct / 100). */
  discountAmount: Prisma.Decimal;
  /** Reference instant for the validity window — the sale time. */
  at: Date;
}

export interface CommissionCalculationResult {
  /** Snapshot of the active configuration, or null when inactive. */
  type: CommissionType | null;
  value: Prisma.Decimal | null;
  /** COP accrued on the line, 0 when no commission is active. */
  amount: Prisma.Decimal;
}

/**
 * True when the commission window contains `at`.
 *
 * An unset boundary means "no limit on this side": only `startsAt` set
 * → active forever after start; only `endsAt` set → active until then;
 * neither set → always active.
 */
export const isCommissionWindowActive = (
  config: CommissionConfigInput,
  at: Date,
): boolean => {
  if (config.startsAt != null) {
    const startsAt = new Date(config.startsAt);
    if (Number.isNaN(startsAt.getTime()) || at < startsAt) return false;
  }
  if (config.endsAt != null) {
    const endsAt = new Date(config.endsAt);
    if (Number.isNaN(endsAt.getTime()) || at > endsAt) return false;
  }
  return true;
};

/**
 * Compute the commission accrued by a single sale line.
 *
 * - NONE type, a non-positive value, or an expired / not-yet-started
 *   window yield `{ type: null, value: null, amount: 0 }`.
 * - PERCENTAGE: `(unitPrice × quantity − discountAmount) × value / 100`,
 *   rounded half-up to cents.
 * - FIXED: `value × quantity`, rounded half-up to cents.
 */
export const calculateCommission = (
  input: CommissionCalculationInput,
): CommissionCalculationResult => {
  const zero = new Prisma.Decimal(0);
  const { config } = input;

  const type = config?.type ?? CommissionType.NONE;
  if (type === CommissionType.NONE) {
    return { type: null, value: null, amount: zero };
  }

  const value =
    config?.value == null ? null : new Prisma.Decimal(config.value);
  if (value == null || value.lessThanOrEqualTo(zero)) {
    return { type: null, value: null, amount: zero };
  }

  if (!isCommissionWindowActive(config, input.at)) {
    return { type: null, value: null, amount: zero };
  }

  const quantity = new Prisma.Decimal(input.quantity);
  if (type === CommissionType.FIXED) {
    const amount = value
      .times(quantity)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return { type, value, amount };
  }

  // PERCENTAGE — base is the line subtotal after discount, before tax.
  const base = input.unitPrice.times(quantity).minus(input.discountAmount);
  const amount = base
    .times(value)
    .dividedBy(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { type, value, amount };
};
