import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class SessionExpiredException extends DomainException {
  constructor() {
    super(
      'AUTH_SESSION_EXPIRED',
      'Session has expired',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
