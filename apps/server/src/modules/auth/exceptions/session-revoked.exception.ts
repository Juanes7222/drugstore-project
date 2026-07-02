import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class SessionRevokedException extends DomainException {
  constructor() {
    super(
      'AUTH_SESSION_REVOKED',
      'Session has been revoked',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
