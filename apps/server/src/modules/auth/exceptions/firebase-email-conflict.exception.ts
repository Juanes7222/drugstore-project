import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Raised when a verified Google email collides with an existing local account
 * that already has a password. Linking would let a Google identity take over a
 * password-protected account, so the user must sign in with the password.
 */
export class FirebaseEmailConflictException extends DomainException {
  constructor() {
    super(
      'AUTH_FIREBASE_EMAIL_CONFLICT',
      'An account with this email already exists. Sign in with your password instead.',
      HttpStatus.CONFLICT,
    );
  }
}
