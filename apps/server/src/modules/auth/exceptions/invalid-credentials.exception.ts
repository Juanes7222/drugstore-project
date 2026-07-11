import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class InvalidCredentialsException extends DomainException {
  constructor(message?: string) {
    super(
      'AUTH_INVALID_CREDENTIALS',
      message ?? 'Invalid username or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
