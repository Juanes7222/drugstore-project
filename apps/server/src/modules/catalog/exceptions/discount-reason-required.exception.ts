import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DiscountReasonRequiredException extends DomainException {
  constructor() {
    super(
      'DISCOUNT_REASON_REQUIRED',
      'A discount reason is required when a discount percentage is applied',
      HttpStatus.BAD_REQUEST,
    );
  }
}
