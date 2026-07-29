-- Seed generic client (CONSUMIDOR FINAL) for DIAN-compliant sales
-- without an identified customer. The well-known UUID is referenced by
-- the server code when clientId is not provided during sale creation.
--
-- DIAN requires every electronic invoice to identify the buyer. For sales
-- to unnamed consumers, the standard is NIT 222222222222 / CONSUMIDOR FINAL.
-- This record is seeded here so both the direct HTTP API and the offline
-- sync replay path populate the Sale.clientNameSnapshot and related
-- snapshot fields instead of storing null.

INSERT INTO "Client" (
  "id",
  "identificationType",
  "identificationNumber",
  "fullName",
  "isActive",
  "createdById",
  "createdAt",
  "updatedAt"
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'NIT',
  '222222222222',
  'CONSUMIDOR FINAL',
  true,
  (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1),
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- SystemConfig entry so the server can retrieve the generic client UUID
-- without hardcoding it in every caller.  Also serves as documentation
-- of which client record is the designated generic consumer.
INSERT INTO "SystemConfig" (
  "key",
  "value",
  "valueType",
  "module",
  "description",
  "isSensitive",
  "updatedAt"
)
VALUES (
  'GENERIC_CLIENT_ID',
  '"00000000-0000-0000-0000-000000000001"',
  'STRING',
  'CLIENTS',
  'UUID of the generic consumer (CONSUMIDOR FINAL) record used for DIAN-compliant sales without an identified customer',
  false,
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
