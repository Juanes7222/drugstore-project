// Prisma 7 configuration for @pharmacy/database
// dotenv/config loads .env before prisma/config helpers resolve env vars.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Use process.env directly instead of the env() helper so that commands
    // like `prisma generate` (which do not need a database URL) can run
    // without DATABASE_URL being set. See Prisma 7 docs on optional vars.
    url: process.env.DATABASE_URL ?? '',
  },
});
