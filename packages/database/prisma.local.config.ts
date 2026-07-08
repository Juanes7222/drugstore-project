// Prisma 7 configuration for the LOCAL build (shared models only).
// Used by apps/pos-desktop (future).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // Points to the assembled directory containing schema.prisma + shared .prisma files.
  schema: 'prisma/schema-local/',
  datasource: {
    // Optional when just generating — empty string prevents errors if DATABASE_URL is unset.
    url: process.env.DATABASE_URL ?? '',
  },
});
