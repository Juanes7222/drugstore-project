/**
 * Sales-pos-specific domain errors for the POS desktop app.
 *
 * Mirrors the server-side exceptions from
 * apps/server/src/modules/sales-pos/exceptions/ but extends the local
 * DomainError base class (no NestJS dependency).
 *
 * Only exceptions needed for the local-authority primitives this module
 * exposes (create and confirm) are ported here. Server-authoritative
 * exceptions like annul-related or client-return-related ones are
 * omitted — they live on the server only.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when attempting to confirm a sale whose operational state is not
 * IN_PROGRESS.
 */
export class SaleNotInProgressException extends DomainError {
  constructor(saleId: string) {
    super(
      'SALE_NOT_IN_PROGRESS',
      `Sale ${saleId} is not in IN_PROGRESS state and cannot be confirmed.`,
    );
  }
}

/**
 * Thrown when a sale item references a product whose saleType requires a
 * prescription (PRESCRIPTION or CONTROLLED_SUBSTANCE). Only FREE_SALE is
 * supported in the local POS.
 */
export class PrescriptionRequiredNotSupportedException extends DomainError {
  constructor(productId: string) {
    super(
      'PRESCRIPTION_REQUIRED_NOT_SUPPORTED',
      `Product ${productId} requires a prescription, which is not supported in this phase.`,
    );
  }
}

/**
 * Thrown when the total payment amount does not meet or exceed the sale's
 * totalAmount.
 */
export class PaymentAmountMismatchException extends DomainError {
  constructor(totalAmount: number, totalPaid: number) {
    super(
      'PAYMENT_AMOUNT_MISMATCH',
      `Total payments (${totalPaid}) do not match total sale amount (${totalAmount}).`,
    );
  }
}

/**
 * Thrown when overpayment (change due) is required but no cash payment
 * method is present in the payment list.
 */
export class ChangeRequiresCashPaymentException extends DomainError {
  constructor() {
    super(
      'CHANGE_REQUIRES_CASH_PAYMENT',
      'Change can only be returned if at least one payment method is cash.',
    );
  }
}

/**
 * Thrown when a sale with the given ID is not found.
 */
export class SaleNotFoundException extends DomainError {
  constructor(saleId: string) {
    super(
      'SALE_NOT_FOUND',
      `Sale with ID ${saleId} not found`,
    );
  }
}
