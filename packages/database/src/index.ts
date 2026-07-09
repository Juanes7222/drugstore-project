// Re-export the FULL Prisma Client as the default export path.
// Prefer '@pharmacy/database/full' for explicit intent.
// The Prisma 7 generated client places its main entry at client.ts (not index.ts).
export * from '../generated/full-client/client.js';
export { PrismaClient } from '../generated/full-client/client.js';
export { LOCAL_SCHEMA_SQL } from './local-schema.js';