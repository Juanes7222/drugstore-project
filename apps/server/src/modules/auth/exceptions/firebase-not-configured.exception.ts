import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Raised when a Firebase login is attempted but the server has no service
 * account configured. Keeps the failure explicit rather than a generic 500.
 */
export class FirebaseNotConfiguredException extends DomainException {
  constructor() {
    super(
      'AUTH_FIREBASE_NOT_CONFIGURED',
      'Google sign-in is not enabled on this server.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
