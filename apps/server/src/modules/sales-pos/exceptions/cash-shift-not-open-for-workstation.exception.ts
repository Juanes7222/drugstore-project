import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class CashShiftNotOpenForWorkstationException extends DomainException {
  constructor(workstationId: string) {
    super(
      'CASH_SHIFT_NOT_OPEN_FOR_WORKSTATION',
      `No open cash shift found for workstation ${workstationId}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
