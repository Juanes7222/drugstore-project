import { z } from 'zod';

// ---------------------------------------------------------------------------
// Revocation list query schema
// ---------------------------------------------------------------------------

export const RevocationListQuerySchema = z.object({
  since: z
    .string()
    .datetime()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 100)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

export class RevocationListQueryDto
  implements z.infer<typeof RevocationListQuerySchema>
{
  since: Date | undefined;
  limit!: number;
  offset!: number;
}

// ---------------------------------------------------------------------------
// Revocation list response schema
// ---------------------------------------------------------------------------

const RevocationEntrySchema = z.object({
  jti: z.string(),
  revokedAt: z.string().datetime(),
  reason: z.string(),
});

export const RevocationListResponseSchema = z.object({
  entries: z.array(RevocationEntrySchema),
  total: z.number(),
});

export class RevocationListResponseDto
  implements z.infer<typeof RevocationListResponseSchema>
{
  entries!: Array<{
    jti: string;
    revokedAt: string;
    reason: string;
  }>;
  total!: number;
}
