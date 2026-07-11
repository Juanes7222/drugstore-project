import { z } from 'zod';

export const LoginSchema = z.object({
  identifier: z.string().min(1, 'Identifier is required'),
  secret: z.string().min(1, 'Secret is required'),
  sessionType: z.enum(['PASSWORD', 'PIN']),
  workstationId: z.string().min(1, 'Workstation ID is required'),
  hardwareFingerprint: z.string().optional(),
  deviceInfo: z.string().optional(),
});

export class LoginDto implements z.infer<typeof LoginSchema> {
  identifier!: string;
  secret!: string;
  sessionType!: 'PASSWORD' | 'PIN';
  workstationId!: string;
  hardwareFingerprint?: string;
  deviceInfo?: string;
}

export const TwoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  totpCode: z.string().length(6).optional(),
  backupCode: z.string().optional(),
});

export class TwoFactorLoginDto implements z.infer<typeof TwoFactorLoginSchema> {
  challengeToken!: string;
  totpCode?: string;
  backupCode?: string;
}
