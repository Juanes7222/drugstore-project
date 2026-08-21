-- AlterEnum
-- Guarded: PostgreSQL leaves enum labels behind even when the enclosing
-- transaction rolls back, so an earlier failed attempt can already have added
-- 'PROCESSING'. Fresh databases add it here; existing ones no-op.
DO $$
BEGIN
  ALTER TYPE "DataImportStatus" ADD VALUE 'PROCESSING';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;