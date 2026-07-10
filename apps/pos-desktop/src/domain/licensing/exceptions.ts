/**
 * Licensing-specific domain errors for the POS desktop app.
 */
import { DomainError } from '../../common/domain-error';

/**
 * Thrown when a license-dependent operation is attempted while the
 * workstation is in LOCKED state.
 */
export class LicenseInvalidException extends DomainError {
  constructor() {
    super(
      'LICENSE_INVALID',
      'La suscripción está vencida. Contactá a tu proveedor para renovar.',
    );
  }
}

/**
 * Thrown when an activation attempt fails.
 */
export class ActivationFailedException extends DomainError {
  constructor(reason: string) {
    super('ACTIVATION_FAILED', reason);
  }
}

/**
 * Thrown when a check-in attempt fails (network or server error).
 */
export class CheckInFailedException extends DomainError {
  constructor(reason: string) {
    super('CHECK_IN_FAILED', reason);
  }
}

/**
 * Thrown when attempting to activate while already activated.
 */
export class AlreadyActivatedException extends DomainError {
  constructor() {
    super(
      'ALREADY_ACTIVATED',
      'Este punto de venta ya está activado.',
    );
  }
}

/**
 * Thrown when the license token cannot be verified locally.
 */
export class TokenVerificationFailedException extends DomainError {
  constructor(reason: string) {
    super('TOKEN_VERIFICATION_FAILED', reason);
  }
}
