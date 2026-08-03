-- RLS: enforce subscriptionId isolation at the database layer.
-- The NestJS server connects as pharmacy_app and runs
-- SET app.current_tenant '<subscriptionId>' before each request.
-- NULL tenant context fails closed (no rows match).
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')
$$;

-- App role (idempotent; NestJS connects as this role).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmacy_app') THEN
    CREATE ROLE pharmacy_app;
  END IF;
END
$$;

-- The app role is not a superuser (RLS would be bypassed), so it needs
-- explicit privileges. GRANTs are idempotent by nature.
GRANT USAGE ON SCHEMA public, app TO pharmacy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pharmacy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pharmacy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pharmacy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pharmacy_app;

-- Policies per tenant-scoped table (derived from F1).
ALTER TABLE "AutoExpirationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutoExpirationJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutoExpirationJob" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "CashShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashShift" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashShift" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Category" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Client" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ClientClassification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientClassification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientClassification" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ClientReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientReturn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientReturn" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ClientReturnItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientReturnItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientReturnItem" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ClientReturnItemLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientReturnItemLot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientReturnItemLot" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "FiscalDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalDocument" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "FiscalIssuerConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalIssuerConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalIssuerConfig" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "FiscalResolution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalResolution" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalResolution" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "FiscalResolutionAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalResolutionAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalResolutionAllocation" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "InventoryAdjustmentDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryAdjustmentDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InventoryAdjustmentDocument" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InventoryMovement" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "InvoiceLocalAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLocalAdjustment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLocalAdjustment" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Lot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Lot" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PaymentMethod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentMethod" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentMethod" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PharmaceuticalForm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PharmaceuticalForm" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PharmaceuticalForm" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PhysicalCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhysicalCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhysicalCount" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Prescription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prescription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Prescription" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductBarcode" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ProductCostHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductCostHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductCostHistory" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ProductPriceHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPriceHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductPriceHistory" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ProductTaxHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductTaxHistory" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductTaxHistory" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrder" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PurchaseOrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrderItem" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PurchaseReception" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseReception" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseReception" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "PurchaseReceptionItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseReceptionItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseReceptionItem" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Sale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sale" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Sale" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SaleItem" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SaleItemLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItemLot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SaleItemLot" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SalePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalePayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalePayment" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "ShiftCashCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftCashCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShiftCashCount" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SupplierReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierReturn" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierReturn" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SupplierReturnItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierReturnItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierReturnItem" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SyncInvoiceResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncInvoiceResult" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncInvoiceResult" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SyncOperationOutcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncOperationOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncOperationOutcome" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "SyncQueue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncQueue" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncQueue" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "TaxScheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaxScheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TaxScheme" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
ALTER TABLE "TechProviderConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TechProviderConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TechProviderConfig" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

-- 42 tables covered.