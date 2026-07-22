-- Add deletedAt column to User for soft-delete support
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Set deletedAt for existing soft-deleted users (identified by [Deleted] prefix)
UPDATE "User" SET "deletedAt" = "updatedAt" WHERE "displayName" LIKE '[Deleted]%' AND "deletedAt" IS NULL;
