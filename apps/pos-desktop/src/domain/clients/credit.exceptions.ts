/**
 * Credit-domain errors for the POS desktop app (abonos / credit payments).
 *
 * Extends the shared DomainError base class (no NestJS dependency), mirroring
 * the sales-pos exceptions file.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when a credit payment (abono) amount is not a positive number.
 */
export class CreditPaymentInvalidAmountException extends DomainError {
  constructor(amountCents: number) {
    super(
      'CREDIT_PAYMENT_INVALID_AMOUNT',
      `Credit payment amount (${amountCents}) must be a positive number.`,
    );
  }
}

/**
 * Thrown when a credit payment (abono) exceeds the client's current debt.
 * Abonos are capped at the outstanding debt to avoid negative balances.
 */
export class CreditPaymentExceedsDebtException extends DomainError {
  constructor(
    public readonly requestedCents: number,
    public readonly debtCents: number,
  ) {
    super(
      'CREDIT_PAYMENT_EXCEEDS_DEBT',
      `Credit payment (${requestedCents}) exceeds the client's current debt (${debtCents}).`,
    );
  }
}

/**
 * Thrown when a credit payment (abono) is recorded while no cash shift is
 * open for the workstation — the payment must be tied to the open shift for
 * cash reconciliation.
 */
export class NoOpenCashShiftForCreditPaymentException extends DomainError {
  constructor(workstationId: string) {
    super(
      'NO_OPEN_CASH_SHIFT_FOR_CREDIT_PAYMENT',
      `No open cash shift found for workstation ${workstationId}.`,
    );
  }
}

/**
 * Thrown when an annulment is attempted for a credit payment (abono) that
 * does not exist locally.
 */
export class CreditPaymentNotFoundException extends DomainError {
  constructor(paymentId: string) {
    super(
      'CREDIT_PAYMENT_NOT_FOUND',
      `Credit payment ${paymentId} was not found.`,
    );
  }
}

/**
 * Thrown when a credit payment (abono) that was already annulled is annulled
 * again — annulment is a terminal state, mirroring the returns annulment
 * rule.
 */
export class CreditPaymentAlreadyAnnulledException extends DomainError {
  constructor(paymentId: string) {
    super(
      'CREDIT_PAYMENT_CANNOT_BE_ANNULLED',
      `Credit payment ${paymentId} is already annulled and cannot be annulled again.`,
    );
  }
}

/**
 * Thrown when an annulment is attempted without a mandatory reason.
 */
export class CreditPaymentInvalidAnnulmentReasonException extends DomainError {
  constructor() {
    super(
      'CREDIT_PAYMENT_ANNULMENT_REASON_REQUIRED',
      'An annulment reason is required for credit payment annulment.',
    );
  }
}
