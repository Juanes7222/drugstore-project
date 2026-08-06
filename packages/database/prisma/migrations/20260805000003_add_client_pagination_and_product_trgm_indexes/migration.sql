-- FIX-001 + FIX-014 (docs/db-query-fixes.md)
--
-- FIX-001: keyset pagination index for ClientsService.findAll (updatedAt, id).
-- FIX-014: GIN trigram index so ILIKE %term% searches on Product.commercialName
-- use the index instead of a seq scan. Requires the pg_trgm extension, which
-- no earlier migration created (live DBs got it via `prisma db push`).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Client_updatedAt_id_idx" ON "Client"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Product_commercialName_trgm_idx" ON "Product" USING GIN ("commercialName" gin_trgm_ops);
