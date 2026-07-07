import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PaymentMethodNotFoundException extends DomainException {
  constructor(paymentMethodId: string) {
    super(
      'PAYMENT_METHOD_NOT_FOUND',
      `Payment method with id ${paymentMethodId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
