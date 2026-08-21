/**
 * Auth-specific domain errors.
 */
import { DomainError } from '../../common/domain-error';

export class InvalidCredentialsException extends DomainError {
  constructor() {
    super(
      'INVALID_CREDENTIALS',
      'The provided username or password is incorrect',
    );
  }
}

export class NoActiveSessionException extends DomainError {
  constructor() {
    super(
      'NO_ACTIVE_SESSION',
      'No active session — you must be logged in to perform this operation',
    );
  }
}

export class InsufficientRoleException extends DomainError {
  constructor(requiredRole: string) {
    super(
      'INSUFFICIENT_ROLE',
      `Access denied — the ${requiredRole} role is required for this operation`,
    );
  }
}

/**
 * Thrown when the server cannot be reached (connection refused, DNS failure,
 * timeout).  Callers should use this as a signal to attempt offline fallback
 * rather than showing a generic error.
 */
export class NetworkErrorException extends DomainError {
  constructor(cause?: string) {
    super(
      'NETWORK_ERROR',
      cause
        ? `Server unreachable — ${cause}`
        : 'Server unreachable',
    );
  }
}

/**
 * Thrown when the server has not configured Firebase
 * (HTTP 503 from POST /auth/login/firebase). Google sign-in is disabled
 * server-side, so the "Continue with Google" button must be hidden.
 */
export class FirebaseNotConfiguredException extends DomainError {
  constructor() {
    super(
      'FIREBASE_NOT_CONFIGURED',
      'Google sign-in is not available right now',
    );
  }
}

/**
 * Thrown when the verified Google email collides with an existing
 * password-protected account (HTTP 409 from POST /auth/login/firebase).
 * The user must sign in with their password instead.
 */
export class GoogleAccountCollisionException extends DomainError {
  constructor() {
    super(
      'GOOGLE_ACCOUNT_COLLISION',
      'This Google account is linked to a password-protected account. Sign in with your password.',
    );
  }
}

/**
 * Thrown when the Firebase ID token is invalid or rejected by the server
 * (HTTP 400 from POST /auth/login/firebase), or for any other unexpected
 * server error during the Google sign-in exchange.
 */
export class InvalidFirebaseTokenException extends DomainError {
  constructor() {
    super(
      'INVALID_FIREBASE_TOKEN',
      'Google sign-in failed. Please try again.',
    );
  }
}