-- Compound keyset indexes for cursor pagination on append-heavy ledgers.
--
-- AuditLog and InventoryMovement list endpoints now walk (createdAt, id)
-- cursors; the compound index serves the seek directly. The old single-column
-- InventoryMovement_createdAt_idx is replaced by the compound one (its leading
-- column is fully covered), avoiding a redundant index on a hot-write table.
--
-- Declared in the Prisma schema sources (@@index([createdAt, id])).
-- Apply as the table-owning role; statements are idempotent because
-- migrations here are not wrapped in a transaction.

DROP INDEX IF EXISTS "InventoryMovement_createdAt_idx";

CREATE INDEX IF NOT EXISTS "InventoryMovement_createdAt_id_idx"
  ON "InventoryMovement"("createdAt", "id");

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_id_idx"
  ON "AuditLog"("createdAt", "id");
