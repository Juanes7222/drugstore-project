import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid username or password',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
