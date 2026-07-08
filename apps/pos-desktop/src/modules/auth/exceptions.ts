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