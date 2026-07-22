import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ClientAlreadyInactiveException extends DomainException {
  constructor(clientId: string) {
    super(
      'CLIENT_ALREADY_INACTIVE',
      `Client with ID ${clientId} is already inactive`,
      HttpStatus.CONFLICT,
    );
  }
}
