// Re-export the PrismaClient class and all generated types, enums, and helpers.
// This is the single import path (@pharmacy/database) that replaces every existing @prisma/client import.
// The Prisma 7 generated client places its main entry at client.ts (not index.ts).
export * from '../generated/client/client.js';
