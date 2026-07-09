/**
 * Cash-shift-specific domain errors.
 *
 * Mirrors the server-side exceptions from apps/server/src/modules/cash-shift/exceptions/
 * but extends the local DomainError base class (no NestJS dependency).
 */
import { DomainError } from '../../common/domain-error';

export class ShiftAlreadyOpenException extends DomainError {
  constructor() {
    super(
      'SHIFT_ALREADY_OPEN',
      'A shift is already open for this workstation',
    );
  }
}

export class ShiftNotOpenException extends DomainError {
  constructor() {
    super(
      'SHIFT_NOT_OPEN',
      'The shift is not open',
    );
  }
}

export class MissingClosingCashCountsException extends DomainError {
  constructor(missingPaymentMethods: string[]) {
    super(
      'MISSING_CLOSING_CASH_COUNTS',
      `Missing closing cash counts for payment methods: ${missingPaymentMethods.join(', ')}`,
    );
  }
}

export class InvalidCashCountForNonCashMethodException extends DomainError {
  constructor() {
    super(
      'INVALID_CASH_COUNT_FOR_NON_CASH_METHOD',
      'Denominations breakdown is only allowed for cash payment methods',
    );
  }
}

export class PaymentMethodNotFoundException extends DomainError {
  constructor(paymentMethodId: string) {
    super(
      'PAYMENT_METHOD_NOT_FOUND',
      `Payment method with id ${paymentMethodId} not found`,
    );
  }
}