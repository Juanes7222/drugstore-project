import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ShiftAlreadyOpenException extends DomainException {
  constructor() {
    super(
      // errorCode kept stable across the per-workstation → global shift
      // migration so existing POS clients matching on it keep working.
      'SHIFT_ALREADY_OPEN',
      'A cash shift is already open for this store',
      HttpStatus.CONFLICT,
    );
  }
}
