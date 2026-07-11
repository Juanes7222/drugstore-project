import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class AccountInactiveException extends DomainException {
  constructor(message?: string) {
    super(
      'AUTH_ACCOUNT_INACTIVE',
      message ?? 'Account is inactive',
      HttpStatus.FORBIDDEN,
    );
  }
}
