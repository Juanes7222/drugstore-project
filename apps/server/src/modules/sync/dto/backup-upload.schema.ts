import { z } from 'zod';

/**
 * Headers expected on a terminal backup upload request.
 * The payload itself is opaque encrypted binary and is intentionally not
 * described or validated here.
 */
export const BackupUploadHeadersSchema = z.object({
  'x-backup-id': z.string().min(1, 'X-Backup-Id is required'),
  'x-backup-created-at': z
    .string()
    .datetime('X-Backup-Created-At must be an ISO 8601 datetime'),
  'x-backup-sha256': z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'X-Backup-Sha256 must be a 64-character hex string'),
});

export type BackupUploadHeadersInput = z.infer<typeof BackupUploadHeadersSchema>;

/**
 * Route parameters for the terminal backup upload endpoint.
 */
export const BackupUploadParamsSchema = z.object({
  id: z
    .string()
    .min(1, 'Workstation id is required')
    .regex(
      /^[a-zA-Z0-9-_]+$/,
      'Workstation id contains invalid characters',
    ),
});

export type BackupUploadParamsInput = z.infer<typeof BackupUploadParamsSchema>;
