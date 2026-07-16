import { z } from 'zod';

// ---------------------------------------------------------------------------
// Blessing request schema
// ---------------------------------------------------------------------------

const PendingSessionSchema = z.object({
  localSessionId: z.string().min(1),
  userId: z.string().min(1),
  offlineTokenJwt: z.string().min(1),
  workstationFingerprint: z.string().min(1),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
});

export const BlessingRequestSchema = z.object({
  pendingSessions: z.array(PendingSessionSchema).min(1).max(50),
});

export class BlessingRequestDto implements z.infer<typeof BlessingRequestSchema> {
  pendingSessions!: Array<{
    localSessionId: string;
    userId: string;
    offlineTokenJwt: string;
    workstationFingerprint: string;
    createdAt: string;
    lastActiveAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Blessing response schema
// ---------------------------------------------------------------------------

const BlessingResultSchema = z.object({
  localSessionId: z.string(),
  status: z.enum(['BLESSED', 'REJECTED']),
  reason: z.string().optional(),
  replacementToken: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string(),
      offlineToken: z.string(),
      expiresAt: z.string().datetime(),
    })
    .optional(),
});

export const BlessingResponseSchema = z.object({
  results: z.array(BlessingResultSchema),
});

export class BlessingResponseDto
  implements z.infer<typeof BlessingResponseSchema>
{
  results!: Array<{
    localSessionId: string;
    status: 'BLESSED' | 'REJECTED';
    reason?: string;
    replacementToken?: {
      accessToken: string;
      refreshToken: string;
      offlineToken: string;
      expiresAt: Date;
    };
  }>;
}
