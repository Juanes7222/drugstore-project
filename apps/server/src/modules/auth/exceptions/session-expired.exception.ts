import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class SessionExpiredException extends DomainException {
  constructor(message?: string) {
    super(
      'AUTH_SESSION_EXPIRED',
      message ?? 'Session has expired',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
