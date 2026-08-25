-- PostgreSQL optimization indexes.
--
-- MUST be applied as the table-owning role (pharmacy_dev in dev/prod deploys):
-- CREATE INDEX requires table ownership and pharmacy_app (runtime/RLS user)
-- is not the owner. Running this via the server's runtime DATABASE_URL fails
-- with SQLSTATE 42501 "must be owner of table".
--
-- InventoryMovement_saleId_idx is declared in the Prisma schema
-- (@@index([saleId])): reverse lookup "movements of this sale" previously
-- seq-scanned this append-heavy table.
--
-- The remaining indexes are intentionally NOT declared in the Prisma schema:
-- partial and GIN trigram indexes are not expressible in schema.prisma. They
-- follow the FIX-014 precedent (20260805000003_add_client_pagination_and_
-- product_trgm_indexes). Because `prisma migrate dev` diffs the full index
-- set, a future generated migration may emit DROP INDEX for these — re-add
-- them if that happens, or run `migrate deploy` in this repo's flow.
--
-- Every statement is idempotent (IF NOT EXISTS / IF NOT EXISTS extension):
-- migrations in this setup apply statement-by-statement without a wrapping
-- transaction, so a mid-migration failure leaves earlier statements applied
-- and the retry must tolerate them existing.

CREATE INDEX IF NOT EXISTS "InventoryMovement_saleId_idx" ON "InventoryMovement"("saleId");

-- ILIKE '%term%' searches (products.service, catalog.service, clients.service,
-- suppliers.service) cannot use B-tree indexes; gin_trgm_ops serves them via
-- trigram matching. pg_trgm already exists from the FIX-014 migration; the
-- IF NOT EXISTS keeps this migration idempotent against DBs provisioned by
-- `prisma db push`.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_internalCode_trgm_idx"
  ON "Product" USING GIN ("internalCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_fullName_trgm_idx"
  ON "Client" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Supplier_businessName_trgm_idx"
  ON "Supplier" USING GIN ("businessName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Supplier_identificationNumber_trgm_idx"
  ON "Supplier" USING GIN ("identificationNumber" gin_trgm_ops);

-- Sync retry poller only reads PENDING rows and FAILED rows whose nextRetryAt
-- has elapsed (sync-processing.job.ts). A partial index keeps that scan tiny
-- as COMPLETED/PERMANENT_FAILURE rows accumulate forever in the queue table.
CREATE INDEX IF NOT EXISTS "SyncQueue_pending_failed_retry_idx"
  ON "SyncQueue"("nextRetryAt")
  WHERE status IN ('PENDING', 'FAILED');
