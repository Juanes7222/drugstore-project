-- Stamp the server-assigned entity id and normalized internalCode onto
-- SyncQueue rows so ALREADY_ACCEPTED retries can echo them back to the
-- POS even when the first response was lost in transit.
ALTER TABLE "SyncQueue" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "SyncQueue" ADD COLUMN IF NOT EXISTS "entityInternalCode" TEXT;
