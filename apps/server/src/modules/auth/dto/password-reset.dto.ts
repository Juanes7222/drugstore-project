import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export class ForgotPasswordDto implements z.infer<typeof ForgotPasswordSchema> {
  email!: string;
}

export const ResetPasswordSchema = z.object({
  // Lower bound kept at 1 for the same reason as VerifyEmailSchema: a damaged
  // token must surface as AUTH_INVALID_VERIFICATION_TOKEN, not a schema-level
  // BAD_REQUEST that the client would have to handle separately.
  token: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(128),
});

export class ResetPasswordDto implements z.infer<typeof ResetPasswordSchema> {
  token!: string;
  newPassword!: string;
}
