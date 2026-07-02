import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

export class AccountInactiveException extends DomainException {
  constructor() {
    super(
      'AUTH_ACCOUNT_INACTIVE',
      'Account is inactive',
      HttpStatus.FORBIDDEN,
    );
  }
}
