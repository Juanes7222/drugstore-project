-- AlterTable: add sourceProductId for POS product ID mapping
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sourceProductId" TEXT;
