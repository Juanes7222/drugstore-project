-- Normalize TechProviderConfig.environment to the DIAN TipoAmbiente wire
-- literals ("1" producción, "2" habilitación). The fiscal engine now rejects
-- any other value (DIAN_ENVIRONMENT_INVALID) instead of silently falling back
-- to habilitación, so legacy word values written by earlier DTO versions
-- must be migrated or every transmission would fail fast.
UPDATE "TechProviderConfig" SET "environment" = '1' WHERE "environment" = 'PRODUCCION';
UPDATE "TechProviderConfig" SET "environment" = '2' WHERE "environment" = 'HABILITACION';
