import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'node:crypto';
import { seedSubscription } from './helpers/subscription-seed';

/**
 * Tenant isolation, verified as the role production actually uses.
 *
 * Every other e2e spec connects as the migration superuser, which has
 * BYPASSRLS — so they prove the application's WHERE clauses work, never that
 * the database stops a query which forgets the tenant filter. This spec runs
 * its assertions after `SET ROLE pharmacy_app`, the non-superuser role the
 * server connects as, which is where row level security actually applies.
 *
 * What it protects:
 *   - a request with no tenant bound sees nothing (fail closed),
 *   - a tenant can neither read nor write another tenant's rows by passing a
 *     foreign id explicitly,
 *   - every tenant-scoped table still carries a policy, so a new table cannot
 *     ship unprotected without the ratchet below failing,
 *   - the tables that are still unprotected are an explicit allowlist, each
 *     entry carrying the code path that makes a naive policy impossible.
 */

const uuidFrom = (seed: string): string => {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
};

/** The non-superuser role the NestJS server connects as. */
const APP_ROLE = 'pharmacy_app';

const TENANT_A_PRODUCT_ID = uuidFrom('e2e-rls-product-tenant-a');
const TENANT_B_PRODUCT_ID = uuidFrom('e2e-rls-product-tenant-b');
const TENANT_B_USER_USERNAME = 'e2e-rls-tenant-b@rls.test';
const TENANT_B_SYNC_EVENT_ID = uuidFrom('e2e-rls-sync-event-tenant-b');

/**
 * Tables the policy migration `20260918000001_rls_policies_for_tenant_tables`
 * brings under row level security. Every code path that touches them runs with
 * a tenant context (an authenticated request, or a scheduler that iterates
 * tenants inside withTenant), so a policy isolates rows instead of breaking a
 * flow.
 */
const POLICY_MIGRATION_TABLES = [
  'DataImport',
  'FiscalCertificate',
  'FiscalWebhookEvent',
  'Location',
  'NamedPreset',
  'SyncConflictLog',
  'SyncEvent',
  'SyncEventAcknowledgment',
  'SystemConfig',
  'TenantConfig',
] as const;

/**
 * Tables that carry `subscriptionId` and still have NO policy, each with the
 * reason a policy cannot simply be added. This list is the durable output of
 * the RLS triage: it is deliberately NOT a set of endorsed gaps. An entry may
 * only stay here while its reason holds, and the coverage test below fails
 * when a table joins the list without one.
 */
const KNOWN_UNPROTECTED_TABLES: ReadonlyArray<{
  table: string;
  /** The pre-tenant or platform path that a naive policy would break. */
  reason: string;
}> = [
  {
    table: 'ActivationCode',
    // Review 2026-09-18: still pre-tenant by design. A future policy could
    // use a permissive USING (subscriptionId IS NOT NULL OR code = current)
    // but the WITH CHECK side would still break the activate flow; keep out.
    reason:
      'POST public/licensing/activate looks the code up BY CODE — the subscription is ' +
      'what the flow is resolving, so the tenant cannot be bound beforehand',
  },
  {
    table: 'AuditLog',
    // Review 2026-09-18 (RLS triage round 2): the OFFLINE applier stamps
    // subscriptionId (sync-operation-dispatcher.handleAuditLogBatch) and the
    // tenant backoffice reads are already scoped via BackofficeScopeService,
    // BUT the online writers never stamp it: AuditService.log and the
    // AuditLogInterceptor create rows with subscriptionId NULL (verified in
    // the test DB: 0 of N rows stamped). A WITH CHECK policy would therefore
    // silently drop every online audit row, and a USING-only policy would
    // make them invisible to the tenant backoffice. Policy requires first
    // stamping subscriptionId from TenantContext in both online writers and
    // keeping the saas-admin platform path working (it has no tenant at all).
    reason:
      'online writers (AuditService.log, AuditLogInterceptor) do NOT stamp ' +
      'subscriptionId — a policy would silently drop every online audit row; ' +
      'needs writer-side stamping first, and saas-admin reads it cross-tenant',
  },
  {
    table: 'FraudAlert',
    // Review 2026-09-18: subscriptionId is NOT NULL and the detector write
    // path could be tenant-scoped, so a policy looks possible. Two blockers:
    // (1) saas-admin fraud surface (SaasAdminOverviewService._count via
    // Subscription, SaasAdminFraudService) runs as a platform admin with NO
    // tenant bound — a policy hides every row from it; (2) the legacy
    // admin/licensing/fraud controller (FraudAlertsController) is mounted,
    // gated to RoleType.ADMIN (a TENANT role), and reads fraud alerts of ALL
    // tenants with no filter — under a policy it would silently return only
    // the caller's tenant rows, hiding its current cross-tenant behavior
    // instead of fixing it. Decide its ownership (saas-admin vs tenant)
    // before any policy. NOTE: that controller is also an app-layer
    // isolation gap in its own right — a tenant ADMIN can list another
    // tenant's fraud alerts today.
    reason:
      'saas-admin reads it with no tenant bound (platform admin) and the ' +
      'legacy admin/licensing/fraud controller reads cross-tenant by design; ' +
      'policy would silently change both instead of fixing them',
  },
  {
    table: 'LicenseCheckIn',
    // Review 2026-09-18: rows are always written with the resolved
    // subscriptionId (NOT NULL), but the write happens on the public path
    // before any tenant is bound; getCheckInHistory('admin/...') is read by
    // id and consumed by saas-admin. Stay out until that endpoint is
    // re-homed behind a tenant or platform scope.
    reason:
      'POST public/licensing/check-in runs before a tenant is known; the subscription ' +
      'comes from the activation the request resolves',
  },
  {
    table: 'OfflineSessionBlessing',
    // Review 2026-09-18: subscriptionId is nullable and recordBlessing() does
    // not set it (rows land with NULL) — a WITH CHECK policy would reject
    // every blessing record. Policy requires stamping it from the resolved
    // user and keeping the pre-tenant rejection rows writable (partial policy
    // or column default); no candidate design yet that keeps both.
    reason:
      'recorded from the offline blessing request, which is pre-tenant by nature ' +
      '(it stores workstationId: "" and subscriptionId NULL until resolved); ' +
      'a WITH CHECK policy would reject every blessing row',
  },
  {
    table: 'SubscriptionPaymentHistory',
    reason:
      'platform billing, written from the saas-admin surface — a platform admin has ' +
      'no subscriptionId at all (BackofficeScopeService.requireSubscription throws)',
  },
  {
    table: 'SubscriptionPendingPayment',
    reason:
      'written by webhooks/wompi and public/licensing/checkout; subscriptionId is ' +
      'nullable because a NEW_SUBSCRIPTION checkout has no subscription yet',
  },
  {
    table: 'User',
    reason:
      'auth/login is public AND JwtStrategy.validateActiveSession reads prisma.user in ' +
      'the GUARD phase, before TenantContextInterceptor binds the tenant — a policy ' +
      'would 401 every authenticated request, not just login',
  },
  {
    table: 'WorkstationActivation',
    reason:
      'GET public/licensing/status/:workstationId and the activation write/revoke run ' +
      'on the same public onboarding flow',
  },
];

interface TablePolicyRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  policies: bigint;
}

describe('Tenant isolation (RLS)', () => {
  let prisma: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;

  /**
   * Runs `fn` as the application role, inside one transaction so every
   * statement shares the connection that the role change applies to.
   *
   * SET LOCAL, never plain SET ROLE: the pooled connection is returned to the
   * pool after the transaction, and a session-scoped role change survives that
   * (pg does not reset session state on release). The next query would then be
   * answered by the app role with no tenant bound — silently seeing zero rows
   * and having its writes affect nothing, anywhere in this process.
   */
  const asAppRole = async <T>(
    tenantId: string | null,
    fn: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
      if (tenantId !== null) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      }
      return fn(tx as unknown as PrismaClient);
    });

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    tenantAId = await seedSubscription(prisma, 'rls-a');
    tenantBId = await seedSubscription(prisma, 'rls-b');

    await prisma.product.deleteMany({
      where: { id: { in: [TENANT_A_PRODUCT_ID, TENANT_B_PRODUCT_ID] } },
    });

    // A user row in the OTHER tenant, so the gap assertions below have
    // something to leak. Without it "another tenant's users are invisible"
    // passes because the table is empty, not because isolation holds.
    await prisma.user.deleteMany({
      where: { username: TENANT_B_USER_USERNAME },
    });
    await prisma.user.create({
      data: {
        id: 'e2e-rls-tenant-b-user',
        username: TENANT_B_USER_USERNAME,
        fullName: 'Tenant B User',
        passwordHash: 'not-a-real-hash',
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        subscriptionId: tenantBId,
        isActive: true,
      },
    });

    // A row in a table the policy migration covers, so the enforcement tests
    // below fail on isolation instead of on an empty table.
    await prisma.syncEvent.deleteMany({
      where: { id: TENANT_B_SYNC_EVENT_ID },
    });
    await prisma.syncEvent.create({
      data: {
        id: TENANT_B_SYNC_EVENT_ID,
        subscriptionId: tenantBId,
        eventType: 'PRICE_UPDATE',
        entityType: 'Product',
        entityId: TENANT_B_PRODUCT_ID,
      },
    });

    await prisma.product.createMany({
      data: [
        {
          id: TENANT_A_PRODUCT_ID,
          subscriptionId: tenantAId,
          internalCode: 'RLS-A-001',
          commercialName: 'Tenant A product',
          laboratory: 'Lab A',
          saleType: 'FREE_SALE',
          createdById: 'e2e-rls-user',
        },
        {
          id: TENANT_B_PRODUCT_ID,
          subscriptionId: tenantBId,
          internalCode: 'RLS-B-001',
          commercialName: 'Tenant B product',
          laboratory: 'Lab B',
          saleType: 'FREE_SALE',
          createdById: 'e2e-rls-user',
        },
      ],
    });
  }, 60000);

  afterAll(async () => {
    await prisma.syncEvent.deleteMany({
      where: { id: TENANT_B_SYNC_EVENT_ID },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [TENANT_A_PRODUCT_ID, TENANT_B_PRODUCT_ID] } },
    });
    await prisma.userSession.deleteMany({
      where: { user: { username: TENANT_B_USER_USERNAME } },
    });
    await prisma.auditLog.deleteMany({
      where: { user: { username: TENANT_B_USER_USERNAME } },
    });
    await prisma.user.deleteMany({
      where: { username: TENANT_B_USER_USERNAME },
    });
    await prisma.$disconnect();
  }, 60000);

  it('seeds both tenants so the isolation assertions are meaningful', async () => {
    // Guard against a silently empty fixture: with no rows, "a tenant sees
    // nothing" would pass for the wrong reason.
    const total = await prisma.product.count({
      where: { id: { in: [TENANT_A_PRODUCT_ID, TENANT_B_PRODUCT_ID] } },
    });
    expect(total).toBe(2);
    expect(tenantAId).not.toBe(tenantBId);
  }, 30000);

  it('fails closed: with no tenant bound the application role sees nothing', async () => {
    const [row] = await asAppRole(null, (tx) =>
      tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Product"`,
    );
    expect(Number(row.count)).toBe(0);
  }, 30000);

  it('shows a tenant its own rows and never another tenant rows', async () => {
    const [ownCount] = await asAppRole(
      tenantAId,
      (tx) => tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Product"`,
    );
    expect(Number(ownCount.count)).toBe(1);

    // A foreign row cannot be reached even by passing its primary key.
    const [foreign] = await asAppRole(
      tenantAId,
      (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Product" WHERE id = ${TENANT_B_PRODUCT_ID}`,
    );
    expect(Number(foreign.count)).toBe(0);

    const visible = await asAppRole(
      tenantAId,
      (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Product"`,
    );
    expect(visible.map((r) => r.id)).toEqual([TENANT_A_PRODUCT_ID]);
  }, 30000);

  it('rejects writing a row that belongs to another tenant', async () => {
    await expect(
      asAppRole(tenantAId, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "Product" (id, "subscriptionId", "internalCode", "commercialName", laboratory, "saleType", "createdById", "updatedAt")
           VALUES ('${uuidFrom('e2e-rls-illegal-product')}', '${tenantBId}', 'RLS-X-001', 'Smuggled', 'Lab', 'FREE_SALE', 'e2e-rls-user', now())`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  }, 30000);

  it('blocks a cross-tenant read on a table the policy migration enforced', async () => {
    // Control: the row exists. Read as the superuser, which bypasses RLS —
    // otherwise "tenant A sees nothing" would hold for the wrong reason.
    expect(
      await prisma.syncEvent.count({ where: { id: TENANT_B_SYNC_EVENT_ID } }),
    ).toBe(1);

    const [ownTenant] = await asAppRole(
      tenantBId,
      (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "SyncEvent" WHERE id = ${TENANT_B_SYNC_EVENT_ID}`,
    );
    expect(Number(ownTenant.count)).toBe(1);

    const [foreignTenant] = await asAppRole(
      tenantAId,
      (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "SyncEvent" WHERE id = ${TENANT_B_SYNC_EVENT_ID}`,
    );
    expect(Number(foreignTenant.count)).toBe(0);
  }, 30000);

  it('lets a tenant-scoped write reach its own rows, the contract the cron relies on', async () => {
    // The scheduled jobs iterate subscriptions and then run a bare updateMany
    // inside withTenant (e.g. expiring certificates). Under a policy that is
    // exactly where a silent "0 rows updated" would hide, so assert the row
    // count the job's statement actually reaches.
    expect(
      await asAppRole(
        tenantAId,
        (tx) =>
          tx.$executeRaw`UPDATE "SyncEvent" SET severity = 'WARNING' WHERE id = ${TENANT_B_SYNC_EVENT_ID}`,
      ),
    ).toBe(0);

    expect(
      await asAppRole(
        tenantBId,
        (tx) =>
          tx.$executeRaw`UPDATE "SyncEvent" SET severity = 'WARNING' WHERE id = ${TENANT_B_SYNC_EVENT_ID}`,
      ),
    ).toBe(1);

    const [updated] = await prisma.syncEvent.findMany({
      where: { id: TENANT_B_SYNC_EVENT_ID },
      select: { severity: true },
    });
    expect(updated.severity).toBe('WARNING');
  }, 30000);

  it('fails closed on every table the policy migration enforced', async () => {
    for (const table of POLICY_MIGRATION_TABLES) {
      const [row] = await asAppRole(null, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) FROM "${table}"`,
        ),
      );
      expect({ table, count: Number(row.count) }).toEqual({
        table,
        count: 0,
      });
    }
  }, 60000);

  it('protects every tenant-scoped table with a policy, with no new gaps', async () => {
    const rows = await prisma.$queryRaw<TablePolicyRow[]>`
      SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'subscriptionId'
            AND a.attnum > 0 AND NOT a.attisdropped
        )
      ORDER BY c.relname
    `;

    expect(rows.length).toBeGreaterThan(40);

    const unprotected = rows
      .filter((row) => !row.relrowsecurity || Number(row.policies) === 0)
      .map((row) => row.relname);

    // Any table here that is not on the allowlist is a NEW unprotected tenant
    // table: either give it a policy migration or add it here with a reason.
    expect(unprotected).toEqual(
      KNOWN_UNPROTECTED_TABLES.map((entry) => entry.table).sort(),
    );

    // The allowlist must be reasoned, not just a list of names.
    for (const entry of KNOWN_UNPROTECTED_TABLES) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  }, 30000);

  it('forces row level security on the tables that do have policies', async () => {
    const rows = await prisma.$queryRaw<TablePolicyRow[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      ORDER BY c.relname
    `;

    // FORCE matters: without it the table owner (the migration role) keeps
    // bypassing the policy, which hides isolation bugs from anything that
    // connects as the owner — including every other spec in this suite.
    const missingForce = rows
      .filter((row) => Number(row.policies) > 0 && !row.relforcerowsecurity)
      .map((row) => row.relname);
    expect(missingForce).toEqual([]);
  }, 30000);

  /**
   * Documents the largest entry of the gap list above, on the table where it
   * hurts most: `User` carries `subscriptionId` and has no policy, so tenant
   * A's role can read tenant B's users.
   *
   * The body asserts what the product REQUIRES (a tenant must not see another
   * tenant's users). It is marked `failing` because that requirement is not
   * met today: the suite stays green while the gap exists, and this test turns
   * red the moment someone adds the policy and forgets to re-check the gap
   * list — or, worse, if someone "fixes" this test by asserting the leak away.
   */
  it.failing('keeps another tenant users invisible to the application role', async () => {
    const [seeded] = await asAppRole(
      tenantBId,
      (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "User" WHERE username = ${TENANT_B_USER_USERNAME}`,
    );
    // Control: the row exists and is reachable, so the assertion below fails
    // on isolation rather than on an empty fixture.
    expect(Number(seeded.count)).toBe(1);

    const [leaked] = await asAppRole(
      tenantAId,
      (tx) =>
        tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "User" WHERE "subscriptionId" = ${tenantBId}`,
    );
    expect(Number(leaked.count)).toBe(0);
  }, 30000);
});
