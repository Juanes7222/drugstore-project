-- AlterTable: add sourceOperationUuid for SALE_CONFIRMATION idempotency
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "sourceOperationUuid" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Sale_sourceOperationUuid_key" ON "Sale"("sourceOperationUuid");
