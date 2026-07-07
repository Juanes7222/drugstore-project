// Prisma 7 configuration — replaces datasource URL previously in schema.prisma
// dotenv/config loads .env before prisma/config helpers resolve env vars.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
