-- Restore relations the application code includes but the schema had lost.
--
-- SalesService.findAll includes workstation; ClientReturnsService.findAll
-- includes sale and client. Those relations no longer existed on the models
-- (only their bare scalar FK columns did), so both list endpoints failed
-- Prisma's runtime validation. The scalars were fully consistent (zero
-- orphan rows on the dev dataset), so this only adds the missing relation
-- wiring: three FK constraints plus the ClientReturn.clientId lookup index.
-- Prisma names constraints with its own <Table>_<column>_fkey convention.
--
-- Declared in schema-source (ClientReturn.sale/.client, Sale.workstation,
-- and the Sale[]/ClientReturn[] back-relations). Apply as the table-owning
-- role; statements are idempotent because migrations here are not wrapped
-- in a transaction.

CREATE INDEX IF NOT EXISTS "ClientReturn_clientId_idx"
  ON "ClientReturn"("clientId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientReturn_saleId_fkey') THEN
    ALTER TABLE "ClientReturn"
      ADD CONSTRAINT "ClientReturn_saleId_fkey"
      FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClientReturn_clientId_fkey') THEN
    ALTER TABLE "ClientReturn"
      ADD CONSTRAINT "ClientReturn_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Sale_workstationId_fkey') THEN
    ALTER TABLE "Sale"
      ADD CONSTRAINT "Sale_workstationId_fkey"
      FOREIGN KEY ("workstationId") REFERENCES "Workstation"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
