-- Per-workstation acknowledgement of SyncEvents.
--
-- SyncEvent carried a single acknowledgedAt column, and the pending query
-- filtered on it, so the FIRST workstation that acknowledged a broadcast event
-- removed it for every other terminal. A branch with a hub plus peer
-- workstations therefore only ever applied a critical event (PRICE_UPDATE,
-- PRODUCT_DEACTIVATED, FORCED_SYNC) on one machine.
--
-- Acknowledgement now lives in one row per workstation. No backfill is
-- performed: an event older than its TTL is never delivered again because the
-- pending query filters on expiresAt, so only acknowledgements made in the
-- last TTL window (60 minutes by default) can briefly reappear — and those
-- handlers are idempotent. The previous rows cannot be attributed to a
-- workstation anyway: acknowledgedById recorded the USER, not the terminal.

-- CreateTable
CREATE TABLE "SyncEventAcknowledgment" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEventAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncEventAcknowledgment_subscriptionId_idx" ON "SyncEventAcknowledgment"("subscriptionId");

-- CreateIndex
CREATE INDEX "SyncEventAcknowledgment_workstationId_acknowledgedAt_idx" ON "SyncEventAcknowledgment"("workstationId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEventAcknowledgment_eventId_workstationId_key" ON "SyncEventAcknowledgment"("eventId", "workstationId");

-- AddForeignKey
ALTER TABLE "SyncEventAcknowledgment" ADD CONSTRAINT "SyncEventAcknowledgment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SyncEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX IF EXISTS "SyncEvent_sourceWorkstationId_acknowledgedAt_idx";

-- CreateIndex
-- Replaces the dropped composite index: routing by source workstation no
-- longer has an acknowledgement column to pair with.
CREATE INDEX "SyncEvent_sourceWorkstationId_idx" ON "SyncEvent"("sourceWorkstationId");

-- AlterTable
ALTER TABLE "SyncEvent" DROP COLUMN "acknowledgedAt",
DROP COLUMN "acknowledgedById";

-- The app connects as pharmacy_app (never as the migration role, which would
-- bypass row level security). Default privileges cover tables created by the
-- migration role, but GRANTs are idempotent and keep this table reachable on
-- databases migrated before that default was declared.
GRANT SELECT, INSERT, UPDATE, DELETE ON "SyncEventAcknowledgment" TO pharmacy_app;
