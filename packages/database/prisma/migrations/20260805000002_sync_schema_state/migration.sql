-- Schema-state sync: captures changes that existed only in schema-source
-- fragments (applied to live DBs via `prisma db push`, never recorded as
-- migrations): InvoiceAdjustmentType enum + InvoiceLocalAdjustment reshape,
-- three SyncOperationType values, SubscriptionPendingPayment table,
-- Product.sourceOperationUuid, dropped FKs/columns, JSONB conversions.
-- Generated with `prisma migrate diff --from-migrations ... --to-schema`.
-- Databases created before this migration already carry this state; mark it
-- applied without running (prisma migrate resolve / record in
-- _prisma_migrations) rather than executing it twice.

-- CreateEnum
CREATE TYPE "InvoiceAdjustmentType" AS ENUM ('PAYMENT_METHOD_CHANGE', 'PAYMENT_SPLIT_CHANGE', 'INTERNAL_NOTE', 'CONTACT_UPDATE', 'CLIENT_CHANGE', 'DELIVERY_INFO', 'TAG_ADD', 'TAG_REMOVE', 'CUSTOM_FIELD_SET', 'CUSTOM_FIELD_CLEAR', 'REVERSAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyncOperationType" ADD VALUE 'PURCHASE_ORDER_CONFIRMATION';
ALTER TYPE "SyncOperationType" ADD VALUE 'PURCHASE_RECEPTION_CONFIRMATION';
ALTER TYPE "SyncOperationType" ADD VALUE 'SUPPLIER_RETURN_CONFIRMATION';

-- DropForeignKey
ALTER TABLE "FiscalDocument" DROP CONSTRAINT "FiscalDocument_purchaseReceptionId_fkey";

-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_currentCostId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_annulledById_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_confirmedById_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_createdById_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseReception" DROP CONSTRAINT "PurchaseReception_annulledById_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseReception" DROP CONSTRAINT "PurchaseReception_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SupplierReturn" DROP CONSTRAINT "SupplierReturn_annulledById_fkey";

-- DropForeignKey
ALTER TABLE "SupplierReturn" DROP CONSTRAINT "SupplierReturn_createdById_fkey";

-- DropIndex
DROP INDEX "InvoiceLocalAdjustment_createdAt_idx";

-- DropIndex
DROP INDEX "InvoiceLocalAdjustment_invoiceId_idx";

-- DropIndex
DROP INDEX "InvoiceLocalAdjustment_workstationId_idx";

-- AlterTable
ALTER TABLE "InvoiceLocalAdjustment" DROP COLUMN "adjustmentType",
ADD COLUMN     "adjustmentType" "InvoiceAdjustmentType" NOT NULL;

-- AlterTable
ALTER TABLE "NamedPreset" ALTER COLUMN "purchases" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sourceOperationUuid" TEXT;

-- AlterTable
ALTER TABLE "TenantConfig" ALTER COLUMN "purchases" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordMustChangeNextLogin";

-- CreateTable
CREATE TABLE "SubscriptionPendingPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "wompiTransactionId" TEXT NOT NULL,
    "wompiReference" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "customerTaxId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "newSubscriptionData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPendingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPendingPayment_wompiTransactionId_key" ON "SubscriptionPendingPayment"("wompiTransactionId");

-- CreateIndex
CREATE INDEX "SubscriptionPendingPayment_wompiTransactionId_idx" ON "SubscriptionPendingPayment"("wompiTransactionId");

-- CreateIndex
CREATE INDEX "SubscriptionPendingPayment_subscriptionId_idx" ON "SubscriptionPendingPayment"("subscriptionId");

-- CreateIndex
CREATE INDEX "SubscriptionPendingPayment_status_idx" ON "SubscriptionPendingPayment"("status");

-- CreateIndex
CREATE INDEX "InvoiceLocalAdjustment_invoiceId_createdAt_idx" ON "InvoiceLocalAdjustment"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceLocalAdjustment_adjustmentType_idx" ON "InvoiceLocalAdjustment"("adjustmentType");

-- CreateIndex
CREATE INDEX "InvoiceLocalAdjustment_reversalOfAdjustmentId_idx" ON "InvoiceLocalAdjustment"("reversalOfAdjustmentId");

-- CreateIndex
CREATE INDEX "InvoiceLocalAdjustment_replacedByAdjustmentId_idx" ON "InvoiceLocalAdjustment"("replacedByAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sourceOperationUuid_key" ON "Product"("sourceOperationUuid");



