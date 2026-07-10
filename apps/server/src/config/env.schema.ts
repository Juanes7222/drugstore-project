import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url().describe('PostgreSQL connection string'),
  JWT_ACCESS_SECRET: z.string().min(32).describe('JWT access token secret'),
  JWT_REFRESH_SECRET: z.string().min(32).describe('JWT refresh token secret'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.string().default('redis://localhost:6379').describe('Redis connection string for BullMQ'),
  BACKUP_STORAGE_PATH: z.string().default('./storage').describe('Root directory for uploaded terminal backup files'),
  LICENSE_TOKEN_SECRET: z.string().min(32).default('dev-license-secret-change-in-prod-min-32-chars!!').describe('Secret for signing license tokens'),
  LICENSE_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800).describe('License token TTL in seconds (default 7 days)'),
});

export type EnvConfig = z.infer<typeof envSchema>;
