import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ShiftAlreadyOpenException extends DomainException {
  constructor() {
    super(
      'SHIFT_ALREADY_OPEN',
      'A shift is already open for this workstation',
      HttpStatus.CONFLICT,
    );
  }
}
