import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class AccountLockedException extends DomainException {
  constructor(readonly lockedUntil: Date) {
    super(
      'AUTH_ACCOUNT_LOCKED',
      'Account is temporarily locked due to too many failed login attempts',
      HttpStatus.FORBIDDEN,
    );
  }
}
