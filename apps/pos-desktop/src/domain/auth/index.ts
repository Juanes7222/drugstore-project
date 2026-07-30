export {
  useLocalSessionStore,
  hasMinRole,
  type LocalSession,
  type SessionTrust,
} from './local-session.store';

export {
  createAuthService,
  type AuthService,
  type AuthServiceConfig,
} from './auth.service';

export {
  createAuthHttpClient,
  type AuthHttpClient,
} from './auth-http-client';

export {
  InvalidCredentialsException,
  NoActiveSessionException,
  InsufficientRoleException,
} from './exceptions';

// Auth guards
export {
  isAuthenticated,
  canPerformOperation,
  isOfflineSessionUsable,
  type AuthGuardResult,
} from './auth-guards';

// Offline auth sub-domain
export * from './offline';

// Local User replica cache
export {
  createUserCacheService,
  type UserCacheService,
  UserNotFoundException,
  UserAlreadyExistsException,
  UserLockedException,
  UserDisabledException,
  PasswordInvalidException,
  UserMaxAttemptsException,
  WebCryptoUnavailableException,
} from './user-cache.service';

export type {
  UserData,
  UserSyncStatus,
  CredentialMode,
  UserStatus,
  SessionTrust as LocalSessionTrust,
  PasswordVerificationResult,
} from './local-types';
