/**
 * POS ↔ Server integration — CROSS-TENANT ISOLATION over the sync surfaces.
 *
 * Two subscriptions (two pharmacy tenants) live in the same test database.
 * Both run the full real stack: real NestJS AppModule, real HTTP, real cron,
 * and — critically — the server connects through the real app role
 * (pharmacy_app) so every query in the request path hits the RLS policies
 * exactly as production does (superuser is only used for direct seeding
 * from the test).
 *
 * What is verified, per tenant pair:
 *
 *  1. Push: tenant B's workstation CANNOT ingest operations attributed to
 *     tenant A's workstation id (forged sourceWorkstationId) — the server
 *     must reject or attribute them under B, never write under A.
 *  2. Push: tenant B's operations land in SyncQueue under B, and the cron
 *     (which iterates tenant by tenant) applies them ONLY under B.
 *  3. Read path: the catalog pull endpoint returns only tenant-local
 *     products — B never sees A's catalog.
 *  4. RLS direct check: with the app role and a tenant set, a write whose
 *     subscriptionId belongs to ANOTHER tenant is rejected by the WITH
 *     CHECK clause of the policy.
 *
 * A leak on any of these paths means one pharmacy reading or writing
 * another pharmacy's data — the highest-severity class of bug this
 * codebase can have.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import {
  PrismaClient as LocalPrismaClient,
  Prisma,
} from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
} from "../../../../../node_modules/.pnpm/node_modules/@nestjs/common";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
import { createRequire } from "node:module";
const serverRequire = createRequire(import.meta.url);
const { PrismaClient: ServerPrismaClient } = serverRequire(
  "../../../../server/test/generated/database-cjs/database.cjs",
) as {
  PrismaClient: new (args: Record<string, unknown>) => ServerPrismaClientType;
};
type ServerPrismaClientType = import("@pharmacy/database").PrismaClient;
const { PrismaPg } = serverRequire(
  "../../../../../node_modules/.pnpm/node_modules/@prisma/adapter-pg",
) as { PrismaPg: new (args: Record<string, unknown>) => unknown };
import * as crypto from "node:crypto";

const setServerEnv = (): void => {
  process.env.DATABASE_URL ??=
    "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";
  // The APP url is the whole point of this spec: the server must run as
  // pharmacy_app so RLS applies to every request-path query.
  process.env.APP_DATABASE_URL ??=
    "postgresql://pharmacy_app:pharmacy_app@localhost:5433/pharmacy_test_db";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-key-32-chars-minimum!!";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-key-32-chars-minimum";
  process.env.JWT_ACCESS_TTL_SECONDS ??= "900";
  process.env.JWT_REFRESH_TTL_SECONDS ??= "604800";
  process.env.PORT ??= "3001";
  process.env.NODE_ENV = "test";
  process.env.REDIS_URL ??= "redis://localhost:6380";
};
setServerEnv();

const { AppModule } = await import("../../../../server/src/app.module");
const { HttpExceptionFilter } =
  await import("../../../../server/src/common/filters/http-exception.filter");
const { TenantContextInterceptor } =
  await import("../../../../server/src/modules/tenant/tenant-context.interceptor");
const { SyncProcessingJob } =
  await import("../../../../server/src/modules/sync/jobs/sync-processing.job");
const { seedSubscription } =
  await import("../../../../server/test/helpers/subscription-seed");

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

const uuidFrom = (seed: string): string => {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
};

// Tenant A (pharmacy north)
const SUB_A_SUFFIX = "pos-xt-a";
const WS_A_ID = uuidFrom("pos-xt-a-ws");
const USER_A_ID = "pos-xt-a-user-id";
const USERNAME_A = "pos-xt-a@pos.test";
const PRODUCT_A_ID = uuidFrom("pos-xt-a-product");
const PM_A_ID = uuidFrom("pos-xt-a-pm");
const TAX_A_ID = uuidFrom("pos-xt-a-tax");

// Tenant B (pharmacy south)
const SUB_B_SUFFIX = "pos-xt-b";
const WS_B_ID = uuidFrom("pos-xt-b-ws");
const USER_B_ID = "pos-xt-b-user-id";
const USERNAME_B = "pos-xt-b@pos.test";
const PRODUCT_B_ID = uuidFrom("pos-xt-b-product");
const PM_B_ID = uuidFrom("pos-xt-b-pm");
const TAX_B_ID = uuidFrom("pos-xt-b-tax");

// Tenant B's workstation id is ALSO a valid-looking workstation under B.
// The forged-operation test attributes an operation to tenant A's
// workstation while authenticated as tenant B.
const POS_WS_ID_B = "pos-xt-b-ws-0001";

const UNIT_PRICE = 15000;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — cross-tenant isolation (RLS)", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subAId = "";
  let subBId = "";
  let tokenA = "";
  let tokenB = "";

  const wireHash = (payload: unknown): string =>
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  const seedTenant = async (
    suffix: string,
    wsId: string,
    wsCode: string,
    userId: string,
    username: string,
    productId: string,
    pmId: string,
    taxId: string,
    taxCode: string,
    productCode: string,
  ): Promise<string> => {
    const subscriptionId = await seedSubscription(serverPrisma, suffix);

    await serverPrisma.workstation.upsert({
      where: { id: wsId },
      update: {},
      create: {
        id: wsId,
        name: `POS XT Workstation ${suffix}`,
        code: wsCode,
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash("PosIntegration123!");
    await serverPrisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        username,
        fullName: `POS XT Cashier ${suffix}`,
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId,
        isActive: true,
      },
    });

    await serverPrisma.taxScheme.upsert({
      where: { id: taxId },
      update: {},
      create: {
        id: taxId,
        subscriptionId,
        code: taxCode,
        name: `IVA 19 ${suffix}`,
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: userId,
      },
    });

    await serverPrisma.product.upsert({
      where: { id: productId },
      update: {},
      create: {
        id: productId,
        subscriptionId,
        internalCode: productCode,
        commercialName: `XT Product ${suffix}`,
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: userId,
      },
    });
    const priceHistory = await serverPrisma.productPriceHistory.upsert({
      where: { id: uuidFrom(`pos-xt-price-${suffix}`) },
      update: {},
      create: {
        id: uuidFrom(`pos-xt-price-${suffix}`),
        subscriptionId,
        productId,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: userId,
        changedAt: new Date(),
      },
    });
    const taxHistory = await serverPrisma.productTaxHistory.upsert({
      where: { id: uuidFrom(`pos-xt-taxhist-${suffix}`) },
      update: {},
      create: {
        id: uuidFrom(`pos-xt-taxhist-${suffix}`),
        subscriptionId,
        productId,
        taxSchemeId: taxId,
        effectiveFrom: new Date(),
        changedById: userId,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: productId },
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });

    await serverPrisma.paymentMethod.upsert({
      where: { id: pmId },
      update: {},
      create: {
        subscriptionId,
        id: pmId,
        internalCode: `XT-${suffix}-CASH`,
        name: `XT Cash ${suffix}`,
        category: "CASH",
        isCash: true,
      },
    });

    return subscriptionId;
  };

  const cleanTenant = async (
    suffix: string,
    wsId: string,
    userId: string,
  ): Promise<void> => {
    const subscriptionId = `e2e-sub-${suffix}`;
    // Probe rows from an interrupted prior run (written via the superuser,
    // which bypasses RLS) would otherwise poison the WITH CHECK assertion.
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "XT-CROSS" } },
    });
    // Clients created by a previous run of the cron test: the sync-created
    // rows carry the deterministic local ids, and a leftover row makes the
    // replay take the P2002 conflict path instead of a clean create.
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "B-CC-" } },
    });
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.saleItemLot.deleteMany({
      where: { saleItem: { sale: { cashShift: { workstationId: wsId } } } },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: wsId } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: wsId } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: wsId } },
    });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: wsId } },
    });
    await serverPrisma.cashShift.deleteMany({ where: { workstationId: wsId } });
    await serverPrisma.auditLog.deleteMany({ where: { userId } });
    await serverPrisma.auditLog.deleteMany({ where: { workstationId: wsId } });
    await serverPrisma.userSession.deleteMany({ where: { userId } });
    await serverPrisma.user.deleteMany({ where: { id: userId } });
    await serverPrisma.workstation.deleteMany({ where: { id: wsId } });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: { contains: suffix } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.product.deleteMany({ where: { subscriptionId } });
    await serverPrisma.taxScheme.deleteMany({ where: { subscriptionId } });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subAId = await seedTenant(
      SUB_A_SUFFIX,
      WS_A_ID,
      "WS-POS-XT-A-001",
      USER_A_ID,
      USERNAME_A,
      PRODUCT_A_ID,
      PM_A_ID,
      TAX_A_ID,
      "XT-A-IVA19",
      "XT-A-001",
    );
    subBId = await seedTenant(
      SUB_B_SUFFIX,
      WS_B_ID,
      "WS-POS-XT-B-001",
      USER_B_ID,
      USERNAME_B,
      PRODUCT_B_ID,
      PM_B_ID,
      TAX_B_ID,
      "XT-B-IVA19",
      "XT-B-001",
    );

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    serverApp = moduleFixture.createNestApplication();
    serverApp.useGlobalFilters(new HttpExceptionFilter());
    serverApp.useGlobalInterceptors(serverApp.get(TenantContextInterceptor));
    serverApp.useGlobalPipes(new ValidationPipe({ transform: true }));
    await serverApp.listen(0);
    serverPort = serverApp.getHttpServer().address().port;

    const loginA = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: USERNAME_A,
        secret: "PosIntegration123!",
        sessionType: "PASSWORD",
        workstationId: WS_A_ID,
      })
      .expect(200);
    tokenA = loginA.body.accessToken as string;

    const loginB = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: USERNAME_B,
        secret: "PosIntegration123!",
        sessionType: "PASSWORD",
        workstationId: WS_B_ID,
      })
      .expect(200);
    tokenB = loginB.body.accessToken as string;
  }, 180000);

  afterAll(async () => {
    if (serverPrisma) {
      await cleanTenant(SUB_A_SUFFIX, WS_A_ID, USER_A_ID);
      await cleanTenant(SUB_B_SUFFIX, WS_B_ID, USER_B_ID);
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  /** Builds a CLIENT_CREATION operation in the exact POS wire format. */
  const buildClientCreation = (
    operationUuid: string,
    clientSequence: number,
    localClientId: string,
    identificationNumber: string,
    workstationId: string,
  ): Record<string, unknown> => {
    const payload = {
      userId: workstationId === WS_A_ID ? USER_A_ID : USER_B_ID,
      createClientDto: {
        identificationType: "CC",
        identificationNumber,
        fullName: `XT Client ${identificationNumber}`,
        isActive: true,
      },
      metadata: {
        localClientId,
        workstationId,
        createdAt: new Date().toISOString(),
      },
    };
    return {
      operationType: "CLIENT_CREATION",
      operationUuid,
      payload,
      payloadHash: wireHash(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence,
      source: "DIRECT",
    };
  };

  it("push lands the operations under the authenticated tenant — never under another", async () => {
    // Tenant B pushes two CLIENT_CREATIONs. One references its OWN
    // workstation; the other forges tenant A's workstation id in the
    // metadata. The server must derive tenant scope from the AUTHENTICATED
    // principal (B), so:
    //   - the honest operation is queued under B
    //   - the forged one must NOT create a row under A (no tenant-A row may
    //     ever appear from a B-authenticated request)
    const opHonestUuid = crypto.randomUUID();
    const opForgedUuid = crypto.randomUUID();
    const honestClientId = uuidFrom("pos-xt-b-client-honest");
    const forgedClientId = uuidFrom("pos-xt-b-client-forged");

    const honest = buildClientCreation(
      opHonestUuid,
      1,
      honestClientId,
      "B-CC-0001",
      WS_B_ID,
    );
    const forged = buildClientCreation(
      opForgedUuid,
      2,
      forgedClientId,
      "B-CC-0002",
      WS_A_ID,
    );

    const res = await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${tokenB}`)
      .send([honest, forged])
      .expect(202);

    const results = res.body as Array<{ status: string }>;
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("ACCEPTED");
    }

    // The honest operation exists under tenant B…
    const queuedB = await serverPrisma.syncQueue.findUnique({
      where: { operationUuid: opHonestUuid },
    });
    expect(queuedB).toBeTruthy();
    expect(queuedB!.subscriptionId).toBe(subBId);
    expect(queuedB!.sourceWorkstationId).toBe(WS_B_ID);

    // …and the forged one is either rejected or scoped under B — but never
    // written under tenant A. THIS is the cross-tenant leak the spec pins.
    const forgedRow = await serverPrisma.syncQueue.findUnique({
      where: { operationUuid: opForgedUuid },
    });
    if (forgedRow) {
      expect(forgedRow.subscriptionId).toBe(subBId);
    }
    const anyRowUnderA = await serverPrisma.syncQueue.findFirst({
      where: { subscriptionId: subAId },
    });
    expect(anyRowUnderA).toBeNull();
  }, 120000);

  it("the cron applies tenant B's queue only under tenant B", async () => {
    // Drain the queue seeded by the previous test through the real cron.
    // It iterates every subscription; a tenant-scoping bug would apply B's
    // operations under A (or vice versa). After the drain:
    //   - clients exist under B with the same ids the POS recorded
    //   - tenant A has NO new clients
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 8; i++) {
      await job.processPendingOperations();
      const pending = await serverPrisma.syncQueue.count({
        where: {
          subscriptionId: subBId,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });
      if (pending === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const doneB = await serverPrisma.syncQueue.findMany({
      where: { subscriptionId: subBId, operationType: "CLIENT_CREATION" },
      select: { status: true, lastErrorMessage: true },
    });
    expect(
      doneB.map((e) => `${e.status}: ${e.lastErrorMessage ?? "ok"}`),
    ).toEqual(["COMPLETED: ok", "COMPLETED: ok"]);

    // Both clients materialized under B.
    const honestClientId = uuidFrom("pos-xt-b-client-honest");
    const forgedClientId = uuidFrom("pos-xt-b-client-forged");
    const clientHonest = await serverPrisma.client.findFirst({
      where: { subscriptionId: subBId, id: honestClientId },
    });
    const clientForged = await serverPrisma.client.findFirst({
      where: { subscriptionId: subBId, id: forgedClientId },
    });
    expect(clientHonest).toBeTruthy();
    expect(clientForged).toBeTruthy();

    // Tenant A remained untouched: zero rows anywhere A-scoped.
    const clientsA = await serverPrisma.client.count({
      where: { subscriptionId: subAId },
    });
    expect(clientsA).toBe(0);
    const queueA = await serverPrisma.syncQueue.count({
      where: { subscriptionId: subAId },
    });
    expect(queueA).toBe(0);
  }, 120000);

  it("the catalog pull never crosses the tenant boundary", async () => {
    // Both tenants pull the full catalog. Each response must contain ONLY
    // its own product — B must never see A's XT-A-001 and vice versa.
    const pullA = await request(serverApp.getHttpServer())
      .get("/catalog/products/sync")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    const itemsA = (pullA.body as { items: Array<{ id: string }> }).items;
    expect(itemsA.map((i) => i.id)).toContain(PRODUCT_A_ID);
    expect(itemsA.map((i) => i.id)).not.toContain(PRODUCT_B_ID);

    const pullB = await request(serverApp.getHttpServer())
      .get("/catalog/products/sync")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    const itemsB = (pullB.body as { items: Array<{ id: string }> }).items;
    expect(itemsB.map((i) => i.id)).toContain(PRODUCT_B_ID);
    expect(itemsB.map((i) => i.id)).not.toContain(PRODUCT_A_ID);
  }, 120000);

  it("RLS WITH CHECK rejects a cross-tenant write at the database level", async () => {
    // Direct proof of the policy: as the app role (pharmacy_app — the same
    // connection the whole request path uses), with tenant B set, an INSERT
    // whose subscriptionId belongs to tenant A must be rejected by the
    // WITH CHECK clause — the last line of defense even if every
    // service-layer guard were broken. The app's PrismaService is used
    // because serverPrisma connects as the migration superuser, which
    // bypasses RLS by design.
    const { PrismaService } =
      await import("../../../../server/src/infrastructure/prisma/prisma.service");
    const appPrisma = serverApp.get(PrismaService) as unknown as {
      withTenant: (sub: string, fn: () => Promise<unknown>) => Promise<unknown>;
      client: {
        create: (args: unknown) => Promise<unknown>;
      };
    };

    await expect(
      appPrisma.withTenant(subBId, () =>
        appPrisma.client.create({
          data: {
            id: uuidFrom("pos-xt-cross-tenant-probe"),
            subscriptionId: subAId,
            identificationType: "CC",
            identificationNumber: "XT-CROSS-1",
            fullName: "Cross Tenant Probe",
            isActive: true,
            createdById: USER_B_ID,
          },
        }),
      ),
    ).rejects.toThrow();

    // The probe row must not exist anywhere afterwards.
    const leaked = await serverPrisma.client.findFirst({
      where: { identificationNumber: "XT-CROSS-1" },
    });
    expect(leaked).toBeNull();
  }, 120000);
});
