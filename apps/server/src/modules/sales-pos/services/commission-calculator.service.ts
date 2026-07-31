import { Injectable } from '@nestjs/common';
import { Prisma, CommissionType } from '@pharmacy/database';

export interface CommissionLineInput {
  unitPrice: Prisma.Decimal;
  quantity: number;
  discountAmount: Prisma.Decimal;
}

export interface CommissionConfigInput {
  commissionType: CommissionType;
  commissionValue: Prisma.Decimal;
  commissionStartsAt: Date | null;
  commissionEndsAt: Date | null;
}

export interface CommissionResult {
  commissionTypeSnapshot: CommissionType | null;
  commissionValueSnapshot: Prisma.Decimal | null;
  commissionAmount: Prisma.Decimal;
}

/**
 * Evaluates the sales commission for a single sale line from the product's
 * configured commission. Used server-side when the sale payload does not
 * carry POS-evaluated commission values (direct HTTP API, legacy payloads);
 * the offline POS replay path sends its own values instead and skips this.
 */
@Injectable()
export class CommissionCalculatorService {
  /**
   * Compute the commission accrued on one sale line.
   *
   * The commission is active only while the type is not NONE, the value is
   * positive, and the sale moment falls inside the optional window. An
   * expired (or not yet started) window never blocks the sale — it just
   * yields no commission.
   */
  compute(config: CommissionConfigInput, line: CommissionLineInput, at: Date = new Date()): CommissionResult {
    if (!this.isActive(config, at)) {
      return { commissionTypeSnapshot: null, commissionValueSnapshot: null, commissionAmount: new Prisma.Decimal(0) };
    }

    const baseAmount = this.baseAmount(config, line);
    return {
      commissionTypeSnapshot: config.commissionType,
      commissionValueSnapshot: config.commissionValue,
      commissionAmount: baseAmount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    };
  }

  private isActive(config: CommissionConfigInput, at: Date): boolean {
    if (config.commissionType === CommissionType.NONE) return false;
    if (!config.commissionValue.greaterThan(0)) return false;
    if (config.commissionStartsAt && at < config.commissionStartsAt) return false;
    if (config.commissionEndsAt && at > config.commissionEndsAt) return false;
    return true;
  }

  private baseAmount(config: CommissionConfigInput, line: CommissionLineInput): Prisma.Decimal {
    if (config.commissionType === CommissionType.PERCENTAGE) {
      // Commission on the discounted line value: (unitPrice * quantity - discountAmount) * value / 100.
      const discountedValue = line.unitPrice.times(line.quantity).minus(line.discountAmount);
      return discountedValue.times(config.commissionValue).dividedBy(100);
    }
    // FIXED: per-unit commission times quantity sold.
    return config.commissionValue.times(line.quantity);
  }
}
