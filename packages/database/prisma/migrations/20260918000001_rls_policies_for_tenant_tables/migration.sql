-- RLS coverage gap: 19 tables carry a subscriptionId but were created after
-- 20260804000002_enable_row_level_security, so none of them has a policy and
-- pharmacy_app can read every tenant's rows. This migration closes the gap for
-- the tables whose every read/write path runs with a tenant context.
--
-- Criterion: a table gets a policy only when no code path touches it without a
-- tenant. That is verified per table in apps/server/test/tenant-isolation.e2e-spec.ts,
-- which fails when a new subscriptionId table ships without a policy and keeps
-- the exclusions below under an explicit, reasoned allowlist.
--
-- Enforced here (10): all have a NOT NULL subscriptionId and are reached only
-- through an authenticated request or a scheduler that iterates tenants inside
-- withTenant:
--   * FiscalCertificate   - FiscalCertificateExpirationJob iterates withTenant
--   * FiscalWebhookEvent  - public webhook already wraps writes in withTenant(subscriptionId)
--   * SystemConfig        - pos-settings returns defaults when no tenant is bound
--   * TenantConfig        - tenant-config endpoints only (tenant config lives behind auth)
--   * DataImport          - data-import endpoints only
--   * NamedPreset         - tenant-config endpoints only
--   * SyncEvent           - sync endpoints only; deleteExpired() has no caller
--   * SyncEventAcknowledgment - same as SyncEvent
--   * SyncConflictLog     - no server-side reference; uploaded via the sync batch
--   * Location            - licensing/locations (admin) and generateActivationCode (admin)
--
-- Deliberately NOT enforced (9), documented in the e2e allowlist:
--   * User, AuditLog                              - pre-tenant and platform-admin paths
--   * ActivationCode, WorkstationActivation,      - public onboarding/check-in endpoints,
--     LicenseCheckIn, FraudAlert,                   which run before a tenant is known
--     OfflineSessionBlessing
--   * SubscriptionPaymentHistory,                 - platform billing; a platform admin
--     SubscriptionPendingPayment                    has no subscriptionId at all
-- A naive policy on any of those would not isolate rows, it would break the flow
-- (the JWT strategy resolves the user in the guard phase, before the interceptor
-- binds the tenant), so they need a design that lets the pre-tenant lookup through
-- without opening a cross-tenant read.

ALTER TABLE "FiscalCertificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalCertificate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalCertificate" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "FiscalWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalWebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FiscalWebhookEvent" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "SystemConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SystemConfig" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "TenantConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantConfig" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "DataImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataImport" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "NamedPreset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NamedPreset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NamedPreset" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "SyncEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncEvent" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "SyncEventAcknowledgment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncEventAcknowledgment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncEventAcknowledgment" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "SyncConflictLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncConflictLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SyncConflictLog" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());

ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Location" USING ("subscriptionId" = app.current_tenant()) WITH CHECK ("subscriptionId" = app.current_tenant());
