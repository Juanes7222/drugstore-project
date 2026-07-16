/**
 * Offline auth domain — barrel export.
 *
 * Re-exports every public symbol from the offline auth sub-domain so
 * consuming modules import from `./offline` (or the parent barrel) instead
 * of reaching into individual files.
 */

// Types
export type {
  OfflineSession,
  OfflineBlessingRejectionReason,
  OfflineTokenClaims,
  CredentialCacheEntry,
  BlessingResult,
  RevocationListEntry,
  OfflineLoginResult,
} from './types';

// Exceptions
export {
  NoOfflineCredentialsException,
  OfflineCredentialsExpiredException,
  OfflineTokenRevokedException,
  OfflineTokenExpiredException,
  OfflineWorkstationMismatchException,
  OfflineBlessingRequiredException,
  SecureStorageUnavailableException,
  ClockDriftException,
} from './exceptions';

// Validation (pure functions)
export {
  verifyOfflineToken,
  decodeOfflineToken,
  isRevoked,
  getOfflineTokenExpiration,
  isTokenExpired,
  validateCachedCredentials,
} from './validation';

// Storage (I/O helpers)
export {
  getCredentialCacheEntry,
  setCredentialCacheEntry,
  clearCredentialCache,
  clearExpiredEntries,
  getRevocationList,
  setRevocationList,
  saveOfflineSession,
  loadOfflineSession,
  removeOfflineSession,
} from './storage';

// Session lifecycle (pure functions)
export {
  createOfflineSession,
  markPendingBlessing,
  applyBlessingResult,
  isSessionValid,
  filterValidSessions,
} from './session';

// Zustand store
export { useOfflineSessionStore } from './local-offline-session.store';
