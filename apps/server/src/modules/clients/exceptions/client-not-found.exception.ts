import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ClientNotFoundException extends DomainException {
  constructor(clientId: string) {
    super(
      'CLIENT_NOT_FOUND',
      `Client with ID ${clientId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
