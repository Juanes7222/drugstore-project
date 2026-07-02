// Maximum number of failed login attempts before account lockout.
// This is hardcoded for this phase and is expected to move into SystemConfig
// once the Configuration module (Phase N) exists. Do not build that integration now.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

// Duration in minutes that an account remains locked after exceeding max failed attempts.
// This is hardcoded for this phase and is expected to move into SystemConfig
// once the Configuration module (Phase N) exists. Do not build that integration now.
export const ACCOUNT_LOCK_DURATION_MINUTES = 15;
