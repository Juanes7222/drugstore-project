import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ClientReturnNotFoundException extends DomainException {
  constructor(returnId: string) {
    super(
      'CLIENT_RETURN_NOT_FOUND',
      `Client return with ID ${returnId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
