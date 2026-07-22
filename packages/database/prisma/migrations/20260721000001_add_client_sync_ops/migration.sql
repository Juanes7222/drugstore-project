-- Add CLIENT_UPDATE and CLIENT_DEACTIVATE to SyncOperationType enum
-- These values were added to the Prisma schema but never migrated to the database.
ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'CLIENT_UPDATE';
ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'CLIENT_DEACTIVATE';
