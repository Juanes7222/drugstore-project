-- Add INVOICE_ADJUSTMENT to the SyncOperationType enum
ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'INVOICE_ADJUSTMENT';

-- Create InvoiceLocalAdjustment table for operational invoice adjustments synced from POS.
-- Matches the Prisma model name exactly (no @@map, so table = model name).
CREATE TABLE "InvoiceLocalAdjustment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reversalOfAdjustmentId" TEXT,
    "replacedByAdjustmentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByUserName" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLocalAdjustment_pkey" PRIMARY KEY ("id")
);

-- Create indexes for query patterns
CREATE INDEX "InvoiceLocalAdjustment_invoiceId_idx" ON "InvoiceLocalAdjustment"("invoiceId");
CREATE INDEX "InvoiceLocalAdjustment_workstationId_idx" ON "InvoiceLocalAdjustment"("workstationId");
CREATE INDEX "InvoiceLocalAdjustment_createdAt_idx" ON "InvoiceLocalAdjustment"("createdAt");
CREATE INDEX "InvoiceLocalAdjustment_adjustmentType_idx" ON "InvoiceLocalAdjustment"("adjustmentType");
CREATE INDEX "InvoiceLocalAdjustment_createdByUserId_idx" ON "InvoiceLocalAdjustment"("createdByUserId");

-- Unique constraint on (invoiceId, version) for optimistic concurrency
CREATE UNIQUE INDEX "InvoiceLocalAdjustment_invoiceId_version_key" ON "InvoiceLocalAdjustment"("invoiceId", "version");
