-- AlterEnum
-- Guarded: PostgreSQL leaves the enum label behind even when the enclosing
-- transaction rolls back, so an earlier failed attempt can already have added
-- 'IMPORT'. Fresh databases add it here; existing ones no-op.
DO $$
BEGIN
  ALTER TYPE "AuditAction" ADD VALUE 'IMPORT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
CREATE TYPE "ImportSourceFormat" AS ENUM ('CSV', 'XLSX', 'JSON');

-- CreateEnum
CREATE TYPE "DataImportStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataImportRowStatus" AS ENUM ('VALID', 'ERROR');

-- CreateTable
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "sourceFormat" "ImportSourceFormat" NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "status" "DataImportStatus" NOT NULL DEFAULT 'COMPLETED',
    "failureReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" "DataImportRowStatus" NOT NULL,
    "issues" JSONB,
    "entityId" TEXT,

    CONSTRAINT "DataImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataImport_subscriptionId_createdAt_idx" ON "DataImport"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "DataImport_entityKey_createdAt_idx" ON "DataImport"("entityKey", "createdAt");

-- CreateIndex
CREATE INDEX "DataImportRow_importId_idx" ON "DataImportRow"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "DataImportRow_importId_rowNumber_key" ON "DataImportRow"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "DataImportRow" ADD CONSTRAINT "DataImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;