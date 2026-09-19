-- OfflineSessionBlessing rows could never be inserted: workstationId was
-- NOT NULL with a FK to Workstation, but the only writer stamped ''
-- (a sentinel that violates the constraint), and the service swallowed
-- the error. The workstation is only known after fingerprint validation
-- (Step 7), so late rejections have no workstation — the column becomes
-- nullable with ON DELETE SET NULL so the audit trail survives deletion.
-- "workstationId = ''" rows cannot exist (FK), so the NOT NULL drop is safe.

ALTER TABLE "OfflineSessionBlessing" ALTER COLUMN "workstationId" DROP NOT NULL;

ALTER TABLE "OfflineSessionBlessing" DROP CONSTRAINT "OfflineSessionBlessing_workstationId_fkey";

ALTER TABLE "OfflineSessionBlessing" ADD CONSTRAINT "OfflineSessionBlessing_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
