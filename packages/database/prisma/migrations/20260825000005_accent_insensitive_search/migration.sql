-- Accent-insensitive text search ("Dolex" finds "Dólex").
--
-- unaccent() itself is STABLE, not IMMUTABLE, so it cannot back an index
-- directly; f_unaccent is the standard immutable wrapper. The GIN trigram
-- expression indexes replace the plain-column ones from
-- 20260825000000: a predicate on f_unaccent(col) can only be served by the
-- matching expression index, so keeping both would double the write cost
-- of every product/client/supplier upsert for an unusable index.
--
-- Callers route searches through searchIdsIgnoringAccents
-- (src/common/text/accent-insensitive-search.ts), which emits exactly this
-- shape: f_unaccent(col) ILIKE f_unaccent('%term%').
--
-- Apply as the table-owning role; statements are idempotent because
-- migrations here are not wrapped in a transaction.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $fn$
  SELECT public.unaccent('public.unaccent', $1)
$fn$;

DROP INDEX IF EXISTS "Product_commercialName_trgm_idx";
DROP INDEX IF EXISTS "Product_internalCode_trgm_idx";
DROP INDEX IF EXISTS "Client_fullName_trgm_idx";
DROP INDEX IF EXISTS "Supplier_businessName_trgm_idx";
DROP INDEX IF EXISTS "Supplier_identificationNumber_trgm_idx";

CREATE INDEX IF NOT EXISTS "Product_commercialName_unaccent_trgm_idx"
  ON "Product" USING GIN (f_unaccent("commercialName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_internalCode_unaccent_trgm_idx"
  ON "Product" USING GIN (f_unaccent("internalCode") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Client_fullName_unaccent_trgm_idx"
  ON "Client" USING GIN (f_unaccent("fullName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Supplier_businessName_unaccent_trgm_idx"
  ON "Supplier" USING GIN (f_unaccent("businessName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Supplier_identificationNumber_unaccent_trgm_idx"
  ON "Supplier" USING GIN (f_unaccent("identificationNumber") gin_trgm_ops);
