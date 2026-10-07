// Maximum number of failed login attempts before account lockout.
// This is hardcoded for this phase and is expected to move into SystemConfig
// once the Configuration module (Phase N) exists. Do not build that integration now.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

// Duration in minutes that an account remains locked after exceeding max failed attempts.
// This is hardcoded for this phase and is expected to move into SystemConfig
// once the Configuration module (Phase N) exists. Do not build that integration now.
export const ACCOUNT_LOCK_DURATION_MINUTES = 15;

// ---------------------------------------------------------------------------
// Email verification and password reset
// ---------------------------------------------------------------------------

/**
 * How long an account-verification link stays usable. Generous because the
 * email is asynchronous and pharmacy staff check it between shifts, but kept
 * finite so a message forwarded years later is worthless: providers retain the
 * rendered body for weeks, and only expiry makes that retention harmless.
 */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a password-reset link stays usable. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Minimum gap between two tokens of the same purpose for one user. Absorbs
 * double-clicks and impatient resend taps; enforced in the database rather than
 * only by the HTTP throttle so it holds regardless of which path issues it.
 */
export const EMAIL_VERIFICATION_REISSUE_COOLDOWN_MS = 60 * 1000;
export const PASSWORD_RESET_REISSUE_COOLDOWN_MS = 5 * 60 * 1000;
