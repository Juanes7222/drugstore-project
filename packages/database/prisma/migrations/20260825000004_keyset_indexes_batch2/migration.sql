-- Compound keyset indexes for the second cursor-pagination batch (sales,
-- returns, fiscal documents, purchases, adjustments, counts, imports,
-- offline revocations). Single-column time indexes that a compound
-- (time, id) index fully covers are dropped to avoid redundant writes on
-- hot tables; the rest are additive.
--
-- Declared in schema-source (@@index entries). Apply as the table-owning
-- role; statements are idempotent because migrations here are not wrapped
-- in a transaction.

DROP INDEX IF EXISTS "FiscalDocument_issueDate_idx";
CREATE INDEX IF NOT EXISTS "FiscalDocument_issueDate_id_idx"
  ON "FiscalDocument"("issueDate", "id");

DROP INDEX IF EXISTS "PurchaseOrder_createdAt_idx";
CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdAt_id_idx"
  ON "PurchaseOrder"("createdAt", "id");

DROP INDEX IF EXISTS "OfflineTokenRevocation_revokedAt_idx";
CREATE INDEX IF NOT EXISTS "OfflineTokenRevocation_revokedAt_id_idx"
  ON "OfflineTokenRevocation"("revokedAt", "id");

CREATE INDEX IF NOT EXISTS "Sale_startedAt_id_idx"
  ON "Sale"("startedAt", "id");

CREATE INDEX IF NOT EXISTS "ClientReturn_createdAt_id_idx"
  ON "ClientReturn"("createdAt", "id");

CREATE INDEX IF NOT EXISTS "FiscalResolutionAllocation_allocatedAt_id_idx"
  ON "FiscalResolutionAllocation"("allocatedAt", "id");

CREATE INDEX IF NOT EXISTS "InventoryAdjustmentDocument_createdAt_id_idx"
  ON "InventoryAdjustmentDocument"("createdAt", "id");

CREATE INDEX IF NOT EXISTS "PhysicalCount_createdAt_id_idx"
  ON "PhysicalCount"("createdAt", "id");

CREATE INDEX IF NOT EXISTS "PurchaseReception_createdAt_id_idx"
  ON "PurchaseReception"("createdAt", "id");

CREATE INDEX IF NOT EXISTS "SupplierReturn_createdAt_id_idx"
  ON "SupplierReturn"("createdAt", "id");
