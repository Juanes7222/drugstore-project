import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class DuplicateClientIdentificationException extends DomainException {
  constructor(identificationType: string, identificationNumber: string) {
    super(
      'DUPLICATE_CLIENT_IDENTIFICATION',
      `Client with identification ${identificationType} ${identificationNumber} already exists`,
      HttpStatus.CONFLICT,
    );
  }
}
