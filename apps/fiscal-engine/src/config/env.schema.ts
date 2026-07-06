import { z } from 'zod';

/** Validates the two environment variables the fiscal engine needs. */
export const envSchema = z.object({
  DATABASE_URL: z.string().url().describe('PostgreSQL connection string'),
  REDIS_URL: z.string().describe('Redis connection string for BullMQ'),
});

export type EnvConfig = z.infer<typeof envSchema>;
