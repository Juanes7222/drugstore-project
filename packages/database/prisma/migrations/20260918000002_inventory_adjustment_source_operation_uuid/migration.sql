-- Idempotency key for INVENTORY_ADJUSTMENT sync replays.
--
-- The adjustment quantity in the payload is a DELTA: applyMovementToLot sets
-- currentStock = currentStock + quantity. The cron replays an operation whose
-- queue row is still PENDING (a lost status write, a restarted process), and
-- INVENTORY_ADJUSTMENT is not an immediate-dispatch type, so the cron is its
-- only path. Without a key recording which operation produced the document, the
-- replay applies the delta again and the lot is silently off by the adjustment.
--
-- Same pattern as Product.sourceOperationUuid and Sale.sourceOperationUuid,
-- which carry the guards for PRODUCT_CREATION and SALE_CONFIRMATION.
--
-- Nullable on purpose: documents created through the interactive endpoint have
-- no sync operation behind them, and PostgreSQL allows many NULLs in a unique
-- index. No backfill: the link was never recorded, so past rows cannot be
-- attributed to an operation without guessing.

ALTER TABLE "InventoryAdjustmentDocument" ADD COLUMN "sourceOperationUuid" TEXT;

CREATE UNIQUE INDEX "InventoryAdjustmentDocument_sourceOperationUuid_key" ON "InventoryAdjustmentDocument"("sourceOperationUuid");
