import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ShiftNotOpenException extends DomainException {
  constructor() {
    super(
      'SHIFT_NOT_OPEN',
      'The shift is not open',
      HttpStatus.BAD_REQUEST,
    );
  }
}
