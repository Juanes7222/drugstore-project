import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Raised when a verification or reset link was genuinely valid but has since
 * been overtaken: the account's email address changed after the token was
 * issued, so the link proves control of an address the account no longer uses.
 *
 * Distinct from InvalidVerificationTokenException, which covers the opaque
 * cases, and deliberately not InvalidCredentialsException: a 401 would tell an
 * API client that the request failed authentication and send it down a refresh
 * or re-login path, when nothing about the credentials is wrong.
 */
export class StaleVerificationTokenException extends DomainException {
  constructor() {
    super(
      'AUTH_STALE_VERIFICATION_TOKEN',
      'This link was issued for a different email address. Request a new link.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
