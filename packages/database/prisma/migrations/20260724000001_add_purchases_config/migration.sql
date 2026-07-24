-- Add purchases Json column to TenantConfig and NamedPreset

ALTER TABLE "TenantConfig" ADD COLUMN IF NOT EXISTS "purchases" Json NOT NULL DEFAULT '{}';
ALTER TABLE "NamedPreset" ADD COLUMN IF NOT EXISTS "purchases" Json NOT NULL DEFAULT '{}';
