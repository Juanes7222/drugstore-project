-- Store-credit abonos: partial payments toward a client's credit debt.
-- A ClientCreditPayment reduces the client's credit debt (debt is computed
-- as credit sales − credit returns − credit payments). The POS records it
-- locally and replays it server-side via the CLIENT_CREDIT_PAYMENT sync op.

ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'CLIENT_CREDIT_PAYMENT';

CREATE TABLE "ClientCreditPayment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sequentialNumber" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "cashShiftId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceOperationUuid" TEXT,
    "sourceWorkstationId" TEXT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3),

    CONSTRAINT "ClientCreditPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientCreditPayment_subscriptionId_idx" ON "ClientCreditPayment"("subscriptionId");
CREATE INDEX "ClientCreditPayment_clientId_createdAt_idx" ON "ClientCreditPayment"("clientId", "createdAt");
CREATE INDEX "ClientCreditPayment_cashShiftId_idx" ON "ClientCreditPayment"("cashShiftId");
CREATE UNIQUE INDEX "ClientCreditPayment_sourceOperationUuid_key" ON "ClientCreditPayment"("sourceOperationUuid");
-- sequentialNumber is informational only (per-workstation counter); no
-- unique constraint so two workstations can replay abonos without conflicts.

-- RLS: tenant-scoped like every other subscriptionId table.
ALTER TABLE "ClientCreditPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientCreditPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClientCreditPayment"
  USING ("subscriptionId" = app.current_tenant())
  WITH CHECK ("subscriptionId" = app.current_tenant());
