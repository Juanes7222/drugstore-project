import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class InvalidSignatureException extends DomainException {
  constructor() {
    super(
      'UPDATE_INVALID_SIGNATURE',
      'Telemetry signature is invalid',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
