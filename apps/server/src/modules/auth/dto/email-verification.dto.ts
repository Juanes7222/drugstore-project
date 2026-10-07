import { z } from 'zod';

/**
 * Email-verification and password-reset request bodies.
 *
 * Promotion candidate: the POS desktop renders a "verify your email" screen and
 * a "forgot password" screen, so both shapes are cross-client contracts. Once
 * the backoffice and POS schemas agree on them they belong in
 * @pharmacy/shared-validation rather than here.
 */

export const ResendVerificationSchema = z.object({
  email: z.string().email(),
});

export class ResendVerificationDto {
  email!: string;
}

export const VerifyEmailSchema = z.object({
  // Deliberately permissive on the low end. A strict minimum would make a
  // truncated or malformed link fail schema validation with a generic
  // BAD_REQUEST, splitting "this link is unusable" across two error codes
  // depending on how the link was damaged. Letting it through means every
  // unusable token returns AUTH_INVALID_VERIFICATION_TOKEN from the service,
  // which is the single code the client branches on. The upper bound still
  // rejects absurd input before it reaches the database.
  token: z.string().min(1).max(200),
});

export class VerifyEmailDto {
  token!: string;
}
