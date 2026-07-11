import { z } from 'zod';

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export class ForgotPasswordDto implements z.infer<typeof ForgotPasswordSchema> {
  email!: string;
}

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export class ResetPasswordDto implements z.infer<typeof ResetPasswordSchema> {
  token!: string;
  newPassword!: string;
}
