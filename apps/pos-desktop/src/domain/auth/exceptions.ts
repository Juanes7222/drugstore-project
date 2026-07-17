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