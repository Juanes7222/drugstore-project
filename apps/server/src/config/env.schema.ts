import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url().describe('PostgreSQL connection string'),
  JWT_ACCESS_SECRET: z.string().min(32).describe('JWT access token secret'),
  JWT_REFRESH_SECRET: z.string().min(32).describe('JWT refresh token secret'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = z.infer<typeof envSchema>;
