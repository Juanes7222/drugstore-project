import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Raised when an account with an unverified email attempts to authenticate
 * with a password. Distinct from InvalidCredentialsException so the client can
 * offer the "resend verification email" path instead of a generic failure, and
 * deliberately not AccountInactiveException: the account is usable, its email
 * address is simply unproven.
 */
export class EmailNotVerifiedException extends DomainException {
  constructor(readonly email: string) {
    super(
      'AUTH_EMAIL_NOT_VERIFIED',
      'Email address must be verified before signing in with a password',
      HttpStatus.FORBIDDEN,
    );
  }
}
