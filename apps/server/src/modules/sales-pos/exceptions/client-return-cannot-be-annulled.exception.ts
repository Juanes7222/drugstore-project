import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ClientReturnCannotBeAnnulledException extends DomainException {
  constructor(returnId: string) {
    super(
      'CLIENT_RETURN_CANNOT_BE_ANNULLED',
      `Client return ${returnId} is already CONFIRMED and cannot be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
