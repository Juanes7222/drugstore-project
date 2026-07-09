import { z } from 'zod';

/** Validates the environment variables the fiscal engine needs. */
export const envSchema = z.object({
  DATABASE_URL: z.url().describe('PostgreSQL connection string'),
  REDIS_URL: z.string().describe('Redis connection string for BullMQ'),
  CERTIFICATE_BASE_DIR: z.string().describe('Base directory for file:-prefixed certificate references'),
  DIAN_CERTIFICATE_PASSWORD: z.string().describe('Password for PKCS#12 certificates resolved via FileSystemSecretReaderAdapter'),
});

export type EnvConfig = z.infer<typeof envSchema>;
