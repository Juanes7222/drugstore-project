// Prisma 7 configuration for the FULL build (shared + server-only models).
// Used by apps/server and apps/fiscal-engine.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Points to the assembled directory containing schema.prisma + all .prisma files.
  schema: 'prisma/schema/',
  datasource: {
    // Optional when just generating — empty string prevents errors if DATABASE_URL is unset.
    url: process.env.DATABASE_URL ?? '',
  },
});
