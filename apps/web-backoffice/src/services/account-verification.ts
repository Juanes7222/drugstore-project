/**
 * Email-verification and password-reset endpoints.
 *
 * Every function here is called ONLY from an explicit user action (a form
 * submit or a button click). None of them may be invoked from a mount effect:
 * mail clients and security scanners pre-fetch every link in a message, and the
 * verification/reset tokens are single-use, so an automatic POST would consume
 * the token before the recipient ever sees the page.
 */

import { api } from "./api";

/** Server-side token bound, mirrored from the auth DTO schemas. */
export const TOKEN_MIN_LENGTH = 20;
export const TOKEN_MAX_LENGTH = 200;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Backend error codes these flows branch on. */
export const AUTH_INVALID_VERIFICATION_TOKEN = "AUTH_INVALID_VERIFICATION_TOKEN";
export const AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS";

export interface VerifyEmailResult {
  verified: true;
  email: string;
}

/**
 * Whether a token from the query string can possibly be a real one.
 *
 * A link truncated by a mail client or copy-paste falls outside the server's
 * bound, which the Zod pipe rejects as a plain 400 BAD_REQUEST rather than
 * AUTH_INVALID_VERIFICATION_TOKEN. Checking here keeps the outcome identical
 * for the user and skips a request that cannot succeed.
 */
export function isPlausibleToken(token: string | null): token is string {
  return (
    token !== null &&
    token.length >= TOKEN_MIN_LENGTH &&
    token.length <= TOKEN_MAX_LENGTH
  );
}

/** Generic acknowledgement; identical whether or not the server sent anything. */
export interface Acknowledgement {
  message: string;
}

/**
 * Redeems a verification token. Called from the "Confirm verification" submit
 * handler only.
 *
 * Throws an Axios error carrying errorCode
 * AUTH_INVALID_VERIFICATION_TOKEN (unknown, used or expired) or
 * AUTH_INVALID_CREDENTIALS (issued for an address the account no longer uses).
 * Both mean the same thing to the user: this link cannot be redeemed.
 */
export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  const { data } = await api.post<VerifyEmailResult>("/auth/verify-email", {
    token,
  });
  return data;
}

/**
 * Asks for a fresh verification email. The answer never reveals whether the
 * address is registered, so callers must not branch on the message.
 */
export async function resendVerificationEmail(
  email: string,
): Promise<Acknowledgement> {
  const { data } = await api.post<Acknowledgement>(
    "/auth/resend-verification",
    { email },
  );
  return data;
}

/**
 * Asks for a password-reset email. Same anti-enumeration guarantee as
 * resendVerificationEmail: only sent for a registered, verified address.
 */
export async function requestPasswordReset(email: string): Promise<Acknowledgement> {
  const { data } = await api.post<Acknowledgement>("/auth/forgot-password", {
    email,
  });
  return data;
}

/**
 * Consumes a reset token and sets the new password. The server revokes every
 * session and offline token for the account on success.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<Acknowledgement> {
  const { data } = await api.post<Acknowledgement>("/auth/reset-password", {
    token,
    newPassword,
  });
  return data;
}