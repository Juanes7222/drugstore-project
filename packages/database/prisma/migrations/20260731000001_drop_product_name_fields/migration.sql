-- AlterTable: drop the generic-name and active-principle name fields from
-- Product. Commercial name is now the only product name field (offline-first
-- POS data simplification).
ALTER TABLE "Product" DROP COLUMN IF EXISTS "genericName";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "activePrinciple";

-- SaleItem.productGenericNameSnapshot becomes nullable: new sales no longer
-- carry a generic name (the Product field is gone), but historical rows keep
-- their value for already-issued fiscal documents.
ALTER TABLE "SaleItem" ALTER COLUMN "productGenericNameSnapshot" DROP NOT NULL;
