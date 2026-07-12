import { z } from 'zod';

/**
 * Schema for publishing a new update version (POST /admin/updates/versions).
 * The binary file is handled separately via multipart upload.
 */
export const PublishVersionSchema = z.object({
  version: z.string().min(1, 'Version is required (semver)'),
  channel: z.enum(['STABLE', 'BETA']).default('STABLE'),
  releaseNotes: z.string().default(''),
  updateType: z.enum(['CRITICAL', 'MANDATORY', 'OPTIONAL', 'HOTFIX']),
  rolloutStrategy: z.enum(['PHASED', 'INSTANT']).default('PHASED'),
  rolloutSchedule: z
    .array(
      z.object({
        percent: z.number().int().min(1).max(100),
        afterDays: z.number().int().min(0),
      }),
    )
    .optional(),
  mandatoryFrom: z.string().datetime().optional().nullable(),
  minAppVersion: z.string().optional().nullable(),
  maxAppVersion: z.string().optional().nullable(),
  requiredPlanFeatures: z.array(z.string()).default([]),
  minPlan: z.string().optional().nullable(),
});

export type PublishVersionInput = z.infer<typeof PublishVersionSchema>;
