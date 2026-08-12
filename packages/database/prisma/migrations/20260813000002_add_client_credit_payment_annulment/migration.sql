-- Credit-payment (abono) annulment: an ADMIN can annul a recorded abono
-- with a mandatory reason. The annulment is recorded locally on the POS and
-- replayed server-side via the CLIENT_CREDIT_PAYMENT_ANNULMENT sync op so
-- the client's credit debt stays consistent across workstations. Annulled
-- payments are excluded from debt computation and cash-shift reconciliation.

ALTER TYPE "SyncOperationType" ADD VALUE IF NOT EXISTS 'CLIENT_CREDIT_PAYMENT_ANNULMENT';

ALTER TABLE "ClientCreditPayment"
    ADD COLUMN "annulledAt" TIMESTAMP(3),
    ADD COLUMN "annulledById" TEXT,
    ADD COLUMN "annulmentReason" TEXT;

CREATE INDEX "ClientCreditPayment_clientId_annulledAt_idx" ON "ClientCreditPayment"("clientId", "annulledAt");
