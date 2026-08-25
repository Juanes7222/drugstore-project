import { z } from 'zod';

/**
 * Env files commonly leave optional variables present but empty (`VAR=`).
 * dotenv loads those as empty strings, which would otherwise fail format
 * validations even though the variable is effectively unset.
 */
function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

export const envSchema = z.object({
  DATABASE_URL: z.url().describe('PostgreSQL connection string'),
  JWT_ACCESS_SECRET: z.string().min(32).describe('JWT access token secret'),
  JWT_REFRESH_SECRET: z.string().min(32).describe('JWT refresh token secret'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  // Days a finished sync-queue row (COMPLETED / PERMANENT_FAILURE / DISCARDED)
  // is kept before the cleanup job deletes it.
  SYNC_QUEUE_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  REDIS_URL: z
    .string()
    .default('redis://localhost:6379')
    .describe('Redis connection string for BullMQ'),
  BACKUP_STORAGE_PATH: z
    .string()
    .default('./storage')
    .describe('Root directory for uploaded terminal backup files'),
  LICENSE_TOKEN_SECRET: z
    .string()
    .min(32)
    .default('dev-license-secret-change-in-prod-min-32-chars!!')
    .describe('Secret for signing license tokens'),
  LICENSE_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(604800)
    .describe('License token TTL in seconds (default 7 days)'),
  TOTP_ISSUER: z
    .string()
    .default('PharmacyPOS')
    .describe('Issuer name for TOTP QR codes'),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .optional()
    .describe('32-byte hex key for encrypting TOTP secrets at rest'),
  BOOTSTRAP_SAAS_ADMIN_EMAIL: z
    .email()
    .optional()
    .describe('Email for first SaaS admin auto-creation'),
  BOOTSTRAP_TOKEN: z
    .string()
    .optional()
    .describe(
      'Secret token that enables POST /auth/bootstrap (first SAAS_ADMIN provisioning)',
    ),
  BACKOFFICE_ALLOWED_DOMAINS: z
    .string()
    .optional()
    .describe(
      'Comma-separated email domains allowed to self-register via Google sign-in',
    ),
  UPDATE_STORAGE_PATH: z
    .string()
    .default('./storage/updates')
    .describe('Root directory for uploaded update binary files'),
  UPDATE_PUBLIC_BASE_URL: z
    .string()
    .default('http://localhost:3000')
    .describe('Public base URL for constructing download URLs'),
  UPDATE_TELEMETRY_HMAC_SECRET: z
    .string()
    .min(32)
    .default('dev-telemetry-hmac-secret-change-in-prod-32chars!!!')
    .describe('HMAC secret for verifying telemetry signatures'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .describe('Allowed CORS origin for the frontend'),

  // ----------------------------------------------------------------------------
  // Object storage (Cloudflare R2) — terminal backups and POS update binaries.
  // Two separate S3-compatible API tokens, one per bucket, both scoped with
  // "Object Read & Write" to their specific bucket only (never an Admin token).
  // The account id inside R2_ENDPOINT is not secret material.
  //
  // STORAGE_DRIVER deliberately defaults to 'local' in every environment: a
  // single-VM production deployment may legitimately keep disk storage. The
  // production Infisical checklist documents setting it explicitly to 'r2'
  // together with the full R2_* credential set.
  //
  // Every R2_* variable tolerates present-but-empty entries (`VAR=`) by
  // treating them as unset: with the local driver no R2 configuration is
  // needed at all, and with the r2 driver an incomplete set surfaces as the
  // storage-policy message instead of a raw format error.
  // ----------------------------------------------------------------------------
  STORAGE_DRIVER: z
    .enum(['local', 'r2'])
    .default('local')
    .describe('Where uploaded backups and update binaries are stored'),
  R2_ENDPOINT: z
    .preprocess(emptyStringToUndefined, z.url().optional())
    .describe('R2 S3 endpoint: https://<account_id>.r2.cloudflarestorage.com'),
  R2_BACKUPS_BUCKET: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .describe('Bucket holding uploaded terminal backups'),
  R2_BACKUPS_ACCESS_KEY_ID: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  R2_BACKUPS_SECRET_ACCESS_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  R2_UPDATES_BUCKET: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .describe('Bucket holding published POS update binaries'),
  R2_UPDATES_ACCESS_KEY_ID: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  R2_UPDATES_SECRET_ACCESS_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),

  // Wompi Colombia payment gateway
  WOMPI_PUBLIC_KEY: z
    .string()
    .optional()
    .describe('Public key from Wompi dashboard (pub_test_* / pub_prod_*)'),
  WOMPI_PRIVATE_KEY: z
    .string()
    .optional()
    .describe('Private key from Wompi dashboard (prv_test_* / prv_prod_*)'),
  WOMPI_EVENTS_SECRET: z
    .string()
    .optional()
    .describe('Wompi events secret for webhook signature verification'),
  WOMPI_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),

  // Firebase (Google sign-in). The service account JSON is server-only and is
  // never exposed to clients. The public web config is delivered to the SPA
  // through GET /auth/firebase/config so no Firebase keys are hardcoded in the
  // frontend. All values are optional; when FIREBASE_SERVICE_ACCOUNT is absent
  // Google sign-in is disabled and the endpoints return a clear error.
  FIREBASE_SERVICE_ACCOUNT: z
    .string()
    .optional()
    .describe('JSON string of the Firebase service account key'),
  FIREBASE_API_KEY: z
    .string()
    .optional()
    .describe('Public Firebase web API key'),
  FIREBASE_AUTH_DOMAIN: z
    .string()
    .optional()
    .describe('Firebase auth domain (e.g. project.firebaseapp.com)'),
  FIREBASE_PROJECT_ID: z.string().optional().describe('Firebase project id'),
  FIREBASE_STORAGE_BUCKET: z
    .string()
    .optional()
    .describe('Firebase storage bucket'),
  FIREBASE_MESSAGING_SENDER_ID: z
    .string()
    .optional()
    .describe('Firebase messaging sender id'),
  FIREBASE_APP_ID: z.string().optional().describe('Firebase web app id'),
  FIREBASE_MEASUREMENT_ID: z
    .string()
    .optional()
    .describe('Firebase measurement id'),
});

// When the R2 driver is selected, its full credential set is mandatory — a
// half-configured driver would fail later at first upload instead of boot.
const R2_REQUIRED_KEYS_WHEN_DRIVER_IS_R2 = [
  'R2_ENDPOINT',
  'R2_BACKUPS_BUCKET',
  'R2_BACKUPS_ACCESS_KEY_ID',
  'R2_BACKUPS_SECRET_ACCESS_KEY',
  'R2_UPDATES_BUCKET',
  'R2_UPDATES_ACCESS_KEY_ID',
  'R2_UPDATES_SECRET_ACCESS_KEY',
] as const;

export const envSchemaWithStoragePolicy = envSchema.refine(
  (env) =>
    env.STORAGE_DRIVER !== 'r2' ||
    R2_REQUIRED_KEYS_WHEN_DRIVER_IS_R2.every((key) => Boolean(env[key])),
  {
    message:
      'STORAGE_DRIVER=r2 requires: ' +
      R2_REQUIRED_KEYS_WHEN_DRIVER_IS_R2.join(', '),
  },
);

export type EnvConfig = z.infer<typeof envSchema>;
