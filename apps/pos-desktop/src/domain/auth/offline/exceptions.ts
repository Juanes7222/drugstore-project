/**
 * Offline auth domain exceptions.
 *
 * Each exception extends `DomainError` with a unique, stable `errorCode`
 * for programmatic discrimination in catch blocks.
 */
import { DomainError } from '../../../common/domain-error';

// ---------------------------------------------------------------------------
// Credential cache
// ---------------------------------------------------------------------------

/**
 * The local credential cache has no entry for the requested user.
 * The user must log in online to re-establish their cached credentials.
 */
export class NoOfflineCredentialsException extends DomainError {
  constructor() {
    super(
      'NO_OFFLINE_CREDENTIALS',
      'No cached credentials found for this user — an online login is required first',
    );
  }
}

/**
 * The cached credentials have expired and can no longer be used for
 * offline authentication.
 */
export class OfflineCredentialsExpiredException extends DomainError {
  constructor() {
    super(
      'OFFLINE_CREDENTIALS_EXPIRED',
      'Cached credentials have expired — an online login is required to refresh them',
    );
  }
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/**
 * The offline token has been revoked by the server and can no longer
 * be used to operate this workstation.
 */
export class OfflineTokenRevokedException extends DomainError {
  constructor() {
    super(
      'OFFLINE_TOKEN_REVOKED',
      'The offline session token has been revoked — an online login is required',
    );
  }
}

/**
 * The offline token has expired and can no longer be used.
 */
export class OfflineTokenExpiredException extends DomainError {
  constructor() {
    super(
      'OFFLINE_TOKEN_EXPIRED',
      'The offline session token has expired — an online login is required',
    );
  }
}

/**
 * The workstation fingerprint in the offline token does not match
 * the current device.  This may indicate token theft.
 */
export class OfflineWorkstationMismatchException extends DomainError {
  constructor() {
    super(
      'OFFLINE_WORKSTATION_MISMATCH',
      'The offline session token is bound to a different workstation',
    );
  }
}

// ---------------------------------------------------------------------------
// Blessing
// ---------------------------------------------------------------------------

/**
 * The offline session has not yet been blessed by the server and the
 * requested operation requires server confirmation.
 */
export class OfflineBlessingRequiredException extends DomainError {
  constructor() {
    super(
      'OFFLINE_BLESSING_REQUIRED',
      'This operation requires server confirmation — the offline session has not been blessed yet',
    );
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * The secure storage backend is not available in the current runtime
 * environment.
 */
export class SecureStorageUnavailableException extends DomainError {
  constructor() {
    super(
      'SECURE_STORAGE_UNAVAILABLE',
      'Secure storage is not available — offline authentication cannot proceed',
    );
  }
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * The local system clock is significantly out of sync with the server
 * time, making token validation unreliable.
 */
export class ClockDriftException extends DomainError {
  constructor(public readonly driftMs: number) {
    super(
      'CLOCK_DRIFT',
      `System clock drift detected (${driftMs}ms) — token validation requires accurate time`,
    );
  }
}
