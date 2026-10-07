import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Raised when a verification or reset link is unknown, already used, or past
 * its expiry. All three collapse into one error on purpose: distinguishing them
 * would tell an attacker holding a guessed token whether it was ever valid, and
 * the remedy offered to the user is identical in all three cases.
 */
export class InvalidVerificationTokenException extends DomainException {
  constructor() {
    super(
      'AUTH_INVALID_VERIFICATION_TOKEN',
      'Verification link is invalid, already used, or expired',
      HttpStatus.BAD_REQUEST,
    );
  }
}
