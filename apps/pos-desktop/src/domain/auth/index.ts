export {
  useLocalSessionStore,
  hasMinRole,
  type LocalSession,
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
