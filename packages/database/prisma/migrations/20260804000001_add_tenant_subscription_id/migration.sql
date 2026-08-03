-- DropIndex
DROP INDEX IF EXISTS "Category_name_key";

-- DropIndex
DROP INDEX IF EXISTS "Client_identificationType_identificationNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "ClientClassification_type_key";

-- DropIndex
DROP INDEX IF EXISTS "ClientReturn_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "FiscalDocument_fullNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "FiscalIssuerConfig_nit_key";

-- DropIndex
DROP INDEX IF EXISTS "FiscalResolution_resolutionNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "InventoryAdjustmentDocument_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "PaymentMethod_internalCode_key";

-- DropIndex
DROP INDEX IF EXISTS "PharmaceuticalForm_name_key";

-- DropIndex
DROP INDEX IF EXISTS "PhysicalCount_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "Product_internalCode_key";

-- DropIndex
DROP INDEX IF EXISTS "ProductBarcode_barcode_key";

-- DropIndex
DROP INDEX IF EXISTS "PurchaseOrder_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "PurchaseReception_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "Sale_internalNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "Supplier_identificationType_identificationNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "SupplierReturn_sequentialNumber_key";

-- DropIndex
DROP INDEX IF EXISTS "TaxScheme_code_rate_idx";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "AutoExpirationJob" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ClientClassification" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ClientReturn" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ClientReturnItem" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ClientReturnItemLot" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FiscalDocument" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FiscalIssuerConfig" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FiscalResolution" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "FiscalResolutionAllocation" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "InventoryAdjustmentCounter" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InventoryAdjustmentDocument" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "InvoiceLocalAdjustment" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PharmaceuticalForm" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PhysicalCount" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProductBarcode" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProductCostHistory" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProductPriceHistory" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProductTaxHistory" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PurchaseReception" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PurchaseReceptionItem" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SaleItemLot" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SalePayment" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ShiftCashCount" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SupplierReturn" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SupplierReturnItem" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SyncInvoiceResult" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SyncOperationOutcome" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SyncQueue" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SystemConfig" DROP CONSTRAINT IF EXISTS "SystemConfig_pkey",
ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("subscriptionId", "key");

-- AlterTable
ALTER TABLE "TaxScheme" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "TechProviderConfig" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "sourceWorkstationId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SyncEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflictLog" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "winningWorkstationId" TEXT NOT NULL,
    "losingWorkstationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "winningOperationUuid" TEXT NOT NULL,
    "losingOperationUuid" TEXT NOT NULL,
    "details" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),

    CONSTRAINT "SyncConflictLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkstationHeartbeat" (
    "id" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "friendlyName" TEXT,
    "appVersion" TEXT,
    "queueDepth" INTEGER NOT NULL DEFAULT 0,
    "oldestPendingAt" TIMESTAMP(3),
    "permanentFailures" INTEGER NOT NULL DEFAULT 0,
    "diskSpaceMb" INTEGER,
    "lastLanSyncAt" TIMESTAMP(3),
    "reportedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkstationHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DROP INDEX IF EXISTS "SyncEvent_subscriptionId_idx";
CREATE INDEX "SyncEvent_subscriptionId_idx" ON "SyncEvent"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncEvent_createdAt_idx";
CREATE INDEX "SyncEvent_createdAt_idx" ON "SyncEvent"("createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "SyncEvent_sourceWorkstationId_acknowledgedAt_idx";
CREATE INDEX "SyncEvent_sourceWorkstationId_acknowledgedAt_idx" ON "SyncEvent"("sourceWorkstationId", "acknowledgedAt");

-- CreateIndex
DROP INDEX IF EXISTS "SyncEvent_eventType_createdAt_idx";
CREATE INDEX "SyncEvent_eventType_createdAt_idx" ON "SyncEvent"("eventType", "createdAt");

-- CreateIndex
DROP INDEX IF EXISTS "SyncEvent_expiresAt_idx";
CREATE INDEX "SyncEvent_expiresAt_idx" ON "SyncEvent"("expiresAt");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_localId_key";
CREATE UNIQUE INDEX "SyncConflictLog_localId_key" ON "SyncConflictLog"("localId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_subscriptionId_idx";
CREATE INDEX "SyncConflictLog_subscriptionId_idx" ON "SyncConflictLog"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_resolvedAt_idx";
CREATE INDEX "SyncConflictLog_resolvedAt_idx" ON "SyncConflictLog"("resolvedAt");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_winningWorkstationId_idx";
CREATE INDEX "SyncConflictLog_winningWorkstationId_idx" ON "SyncConflictLog"("winningWorkstationId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_entityType_entityId_idx";
CREATE INDEX "SyncConflictLog_entityType_entityId_idx" ON "SyncConflictLog"("entityType", "entityId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncConflictLog_uploadedAt_idx";
CREATE INDEX "SyncConflictLog_uploadedAt_idx" ON "SyncConflictLog"("uploadedAt");

-- CreateIndex
DROP INDEX IF EXISTS "WorkstationHeartbeat_workstationId_receivedAt_idx";
CREATE INDEX "WorkstationHeartbeat_workstationId_receivedAt_idx" ON "WorkstationHeartbeat"("workstationId", "receivedAt");

-- CreateIndex
DROP INDEX IF EXISTS "WorkstationHeartbeat_receivedAt_idx";
CREATE INDEX "WorkstationHeartbeat_receivedAt_idx" ON "WorkstationHeartbeat"("receivedAt");

-- CreateIndex
DROP INDEX IF EXISTS "WorkstationHeartbeat_reportedBy_receivedAt_idx";
CREATE INDEX "WorkstationHeartbeat_reportedBy_receivedAt_idx" ON "WorkstationHeartbeat"("reportedBy", "receivedAt");

-- CreateIndex
DROP INDEX IF EXISTS "AuditLog_subscriptionId_idx";
CREATE INDEX "AuditLog_subscriptionId_idx" ON "AuditLog"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "AutoExpirationJob_subscriptionId_idx";
CREATE INDEX "AutoExpirationJob_subscriptionId_idx" ON "AutoExpirationJob"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "CashShift_subscriptionId_idx";
CREATE INDEX "CashShift_subscriptionId_idx" ON "CashShift"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Category_subscriptionId_idx";
CREATE INDEX "Category_subscriptionId_idx" ON "Category"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Category_subscriptionId_name_key";
CREATE UNIQUE INDEX "Category_subscriptionId_name_key" ON "Category"("subscriptionId", "name");

-- CreateIndex
DROP INDEX IF EXISTS "Client_subscriptionId_idx";
CREATE INDEX "Client_subscriptionId_idx" ON "Client"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Client_subscriptionId_identificationType_identificationNumb_key";
CREATE UNIQUE INDEX "Client_subscriptionId_identificationType_identificationNumb_key" ON "Client"("subscriptionId", "identificationType", "identificationNumber");

-- CreateIndex
DROP INDEX IF EXISTS "ClientClassification_subscriptionId_idx";
CREATE INDEX "ClientClassification_subscriptionId_idx" ON "ClientClassification"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ClientClassification_subscriptionId_type_key";
CREATE UNIQUE INDEX "ClientClassification_subscriptionId_type_key" ON "ClientClassification"("subscriptionId", "type");

-- CreateIndex
DROP INDEX IF EXISTS "ClientReturn_subscriptionId_idx";
CREATE INDEX "ClientReturn_subscriptionId_idx" ON "ClientReturn"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ClientReturn_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "ClientReturn_subscriptionId_sequentialNumber_key" ON "ClientReturn"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "ClientReturnItem_subscriptionId_idx";
CREATE INDEX "ClientReturnItem_subscriptionId_idx" ON "ClientReturnItem"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ClientReturnItemLot_subscriptionId_idx";
CREATE INDEX "ClientReturnItemLot_subscriptionId_idx" ON "ClientReturnItemLot"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalDocument_subscriptionId_idx";
CREATE INDEX "FiscalDocument_subscriptionId_idx" ON "FiscalDocument"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalDocument_subscriptionId_fullNumber_key";
CREATE UNIQUE INDEX "FiscalDocument_subscriptionId_fullNumber_key" ON "FiscalDocument"("subscriptionId", "fullNumber");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalIssuerConfig_subscriptionId_idx";
CREATE INDEX "FiscalIssuerConfig_subscriptionId_idx" ON "FiscalIssuerConfig"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalIssuerConfig_subscriptionId_nit_key";
CREATE UNIQUE INDEX "FiscalIssuerConfig_subscriptionId_nit_key" ON "FiscalIssuerConfig"("subscriptionId", "nit");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalResolution_subscriptionId_idx";
CREATE INDEX "FiscalResolution_subscriptionId_idx" ON "FiscalResolution"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalResolution_subscriptionId_resolutionNumber_key";
CREATE UNIQUE INDEX "FiscalResolution_subscriptionId_resolutionNumber_key" ON "FiscalResolution"("subscriptionId", "resolutionNumber");

-- CreateIndex
DROP INDEX IF EXISTS "FiscalResolutionAllocation_subscriptionId_idx";
CREATE INDEX "FiscalResolutionAllocation_subscriptionId_idx" ON "FiscalResolutionAllocation"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "InventoryAdjustmentDocument_subscriptionId_idx";
CREATE INDEX "InventoryAdjustmentDocument_subscriptionId_idx" ON "InventoryAdjustmentDocument"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "InventoryAdjustmentDocument_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "InventoryAdjustmentDocument_subscriptionId_sequentialNumber_key" ON "InventoryAdjustmentDocument"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "InventoryMovement_subscriptionId_idx";
CREATE INDEX "InventoryMovement_subscriptionId_idx" ON "InventoryMovement"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "InvoiceLocalAdjustment_subscriptionId_idx";
CREATE INDEX "InvoiceLocalAdjustment_subscriptionId_idx" ON "InvoiceLocalAdjustment"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Lot_subscriptionId_idx";
CREATE INDEX "Lot_subscriptionId_idx" ON "Lot"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Lot_updatedAt_id_idx";
CREATE INDEX "Lot_updatedAt_id_idx" ON "Lot"("updatedAt", "id");

-- CreateIndex
DROP INDEX IF EXISTS "PaymentMethod_subscriptionId_idx";
CREATE INDEX "PaymentMethod_subscriptionId_idx" ON "PaymentMethod"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PaymentMethod_subscriptionId_internalCode_key";
CREATE UNIQUE INDEX "PaymentMethod_subscriptionId_internalCode_key" ON "PaymentMethod"("subscriptionId", "internalCode");

-- CreateIndex
DROP INDEX IF EXISTS "PharmaceuticalForm_subscriptionId_idx";
CREATE INDEX "PharmaceuticalForm_subscriptionId_idx" ON "PharmaceuticalForm"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PharmaceuticalForm_subscriptionId_name_key";
CREATE UNIQUE INDEX "PharmaceuticalForm_subscriptionId_name_key" ON "PharmaceuticalForm"("subscriptionId", "name");

-- CreateIndex
DROP INDEX IF EXISTS "PhysicalCount_subscriptionId_idx";
CREATE INDEX "PhysicalCount_subscriptionId_idx" ON "PhysicalCount"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PhysicalCount_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "PhysicalCount_subscriptionId_sequentialNumber_key" ON "PhysicalCount"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "Prescription_subscriptionId_idx";
CREATE INDEX "Prescription_subscriptionId_idx" ON "Prescription"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Product_subscriptionId_idx";
CREATE INDEX "Product_subscriptionId_idx" ON "Product"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Product_updatedAt_id_idx";
CREATE INDEX "Product_updatedAt_id_idx" ON "Product"("updatedAt", "id");

-- CreateIndex
DROP INDEX IF EXISTS "Product_subscriptionId_internalCode_key";
CREATE UNIQUE INDEX "Product_subscriptionId_internalCode_key" ON "Product"("subscriptionId", "internalCode");

-- CreateIndex
DROP INDEX IF EXISTS "ProductBarcode_subscriptionId_idx";
CREATE INDEX "ProductBarcode_subscriptionId_idx" ON "ProductBarcode"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ProductBarcode_subscriptionId_barcode_key";
CREATE UNIQUE INDEX "ProductBarcode_subscriptionId_barcode_key" ON "ProductBarcode"("subscriptionId", "barcode");

-- CreateIndex
DROP INDEX IF EXISTS "ProductCostHistory_subscriptionId_idx";
CREATE INDEX "ProductCostHistory_subscriptionId_idx" ON "ProductCostHistory"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ProductPriceHistory_subscriptionId_idx";
CREATE INDEX "ProductPriceHistory_subscriptionId_idx" ON "ProductPriceHistory"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ProductTaxHistory_subscriptionId_idx";
CREATE INDEX "ProductTaxHistory_subscriptionId_idx" ON "ProductTaxHistory"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseOrder_subscriptionId_idx";
CREATE INDEX "PurchaseOrder_subscriptionId_idx" ON "PurchaseOrder"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseOrder_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "PurchaseOrder_subscriptionId_sequentialNumber_key" ON "PurchaseOrder"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseOrderItem_subscriptionId_idx";
CREATE INDEX "PurchaseOrderItem_subscriptionId_idx" ON "PurchaseOrderItem"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseReception_subscriptionId_idx";
CREATE INDEX "PurchaseReception_subscriptionId_idx" ON "PurchaseReception"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseReception_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "PurchaseReception_subscriptionId_sequentialNumber_key" ON "PurchaseReception"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "PurchaseReceptionItem_subscriptionId_idx";
CREATE INDEX "PurchaseReceptionItem_subscriptionId_idx" ON "PurchaseReceptionItem"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Sale_subscriptionId_idx";
CREATE INDEX "Sale_subscriptionId_idx" ON "Sale"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Sale_subscriptionId_internalNumber_key";
CREATE UNIQUE INDEX "Sale_subscriptionId_internalNumber_key" ON "Sale"("subscriptionId", "internalNumber");

-- CreateIndex
DROP INDEX IF EXISTS "SaleItem_subscriptionId_idx";
CREATE INDEX "SaleItem_subscriptionId_idx" ON "SaleItem"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SaleItemLot_subscriptionId_idx";
CREATE INDEX "SaleItemLot_subscriptionId_idx" ON "SaleItemLot"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SalePayment_subscriptionId_idx";
CREATE INDEX "SalePayment_subscriptionId_idx" ON "SalePayment"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "ShiftCashCount_subscriptionId_idx";
CREATE INDEX "ShiftCashCount_subscriptionId_idx" ON "ShiftCashCount"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Supplier_subscriptionId_idx";
CREATE INDEX "Supplier_subscriptionId_idx" ON "Supplier"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "Supplier_subscriptionId_identificationType_identificationNu_key";
CREATE UNIQUE INDEX "Supplier_subscriptionId_identificationType_identificationNu_key" ON "Supplier"("subscriptionId", "identificationType", "identificationNumber");

-- CreateIndex
DROP INDEX IF EXISTS "SupplierReturn_subscriptionId_idx";
CREATE INDEX "SupplierReturn_subscriptionId_idx" ON "SupplierReturn"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SupplierReturn_subscriptionId_sequentialNumber_key";
CREATE UNIQUE INDEX "SupplierReturn_subscriptionId_sequentialNumber_key" ON "SupplierReturn"("subscriptionId", "sequentialNumber");

-- CreateIndex
DROP INDEX IF EXISTS "SupplierReturnItem_subscriptionId_idx";
CREATE INDEX "SupplierReturnItem_subscriptionId_idx" ON "SupplierReturnItem"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncInvoiceResult_subscriptionId_idx";
CREATE INDEX "SyncInvoiceResult_subscriptionId_idx" ON "SyncInvoiceResult"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncOperationOutcome_subscriptionId_idx";
CREATE INDEX "SyncOperationOutcome_subscriptionId_idx" ON "SyncOperationOutcome"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "SyncQueue_subscriptionId_idx";
CREATE INDEX "SyncQueue_subscriptionId_idx" ON "SyncQueue"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "TaxScheme_subscriptionId_idx";
CREATE INDEX "TaxScheme_subscriptionId_idx" ON "TaxScheme"("subscriptionId");

-- CreateIndex
DROP INDEX IF EXISTS "TaxScheme_subscriptionId_code_rate_idx";
CREATE INDEX "TaxScheme_subscriptionId_code_rate_idx" ON "TaxScheme"("subscriptionId", "code", "rate");

-- CreateIndex
DROP INDEX IF EXISTS "TechProviderConfig_subscriptionId_idx";
CREATE INDEX "TechProviderConfig_subscriptionId_idx" ON "TechProviderConfig"("subscriptionId");

-- Drop the placeholder defaults: every new row must stamp a real
-- subscriptionId (fail-fast on omission). Rows backfilled with '' stay
-- forever invisible to every tenant under RLS — the correct fate for
-- pre-tenant data. Rows in NEW tables (SyncEvent etc.) never had the
-- default, so they are not touched.
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'subscriptionId'
      AND c.column_default IS NOT NULL
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "subscriptionId" DROP DEFAULT', tbl.table_name);
  END LOOP;
END $$;
