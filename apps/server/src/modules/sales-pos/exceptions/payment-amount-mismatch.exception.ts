import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PaymentAmountMismatchException extends DomainException {
  constructor(totalAmount: number, totalPaid: number) {
    super(
      'PAYMENT_AMOUNT_MISMATCH',
      `Total payments (${totalPaid}) do not match total sale amount (${totalAmount}).`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
