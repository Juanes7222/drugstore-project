/**
 * POS ↔ Server integration — non-sale operations (CLIENT_CREATION,
 * PRODUCT_CREATION, SHIFT_OPEN + SHIFT_CLOSURE).
 *
 * Same real-code harness as pos-server-replay.integration.test.ts:
 * real PGlite + real local Prisma + real POS domain services on one side,
 * real NestJS AppModule over real HTTP against the migrated Postgres test
 * database (RLS on) on the other. The only bridge is the wire contract.
 *
 * @vitest-environment node
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import {
  PrismaClient as LocalPrismaClient,
  Prisma,
} from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
// The workspace hoists the server's dependencies into .pnpm/node_modules;
// vitest resolves these paths relative to this file.
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
// Server side (real AppModule)
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
// closeShift mandates a backup, which depends on the Tauri runtime
// (invoke/window). Node has neither, so stub the backup module the same way
// cash-shift.service.prisma-integration.test.ts does.
vi.mock("../backup", () => ({
  createBackupService: () => ({
    createBackup: async () => ({ id: "backup-mock" }),
  }),
  BackupFailedException: class BackupFailedException extends Error {},
}));

// Server env must be set BEFORE the AppModule (and its ConfigModule) loads.
const setServerEnv = (): void => {
  process.env.DATABASE_URL ??=
    "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";
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

// Dynamic imports: AppModule must evaluate AFTER setServerEnv().
const { AppModule } = await import("../../../../server/src/app.module");
const { HttpExceptionFilter } = await import(
  "../../../../server/src/common/filters/http-exception.filter"
);
const { TenantContextInterceptor } = await import(
  "../../../../server/src/modules/tenant/tenant-context.interceptor"
);
const { SyncProcessingJob } = await import(
  "../../../../server/src/modules/sync/jobs/sync-processing.job"
);
const { seedSubscription } = await import(
  "../../../../server/test/helpers/subscription-seed"
);

// POS side (real domain code)
import { createClientsService } from "../clients/clients.service";
import { createProductService } from "../catalog/product.service";
import { createCashShiftService } from "../cash-shift/cash-shift.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-ops-server-ws");
const SERVER_USER_ID = "pos-int-ops-server-user-id";
const USERNAME = "pos-integration-ops@pos.test";
const PASSWORD = "PosIntegration123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-ops-server-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-ops-server-pm-cash");

const PRODUCT_ID = SERVER_TAX_SCHEME_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;
const POS_WS_ID = "pos-int-ws-0001";
const POS_USER_ID = SERVER_USER_ID;

const NEW_CLIENT_ID = uuidFrom("pos-int-new-client");
const NEW_PRODUCT_BARCODE = "7701234000018";
// Exact commercial name used for cleanup matching (the server renames the
// OFFLINE- internal code, so that column cannot identify our rows).
const TEST_PRODUCT_NAME = "Dolex Integración";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — clients, products, cash shift", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let clientsService: ReturnType<typeof createClientsService>;
  let productService: ReturnType<typeof createProductService>;
  let cashShiftService: ReturnType<typeof createCashShiftService>;

  beforeAll(async () => {
    // =====================================================================
    // 1. SERVER — real NestJS app on a real port, real Postgres
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-ops");

    // ── Seed the server-side world ──
    await serverPrisma.syncOperationOutcome.deleteMany({ where: { subscriptionId } });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: SERVER_WS_ID } } });
    await serverPrisma.cashShift.deleteMany({ where: { workstationId: SERVER_WS_ID } });
    await serverPrisma.productTaxHistory.deleteMany({ where: { product: { commercialName: TEST_PRODUCT_NAME } } });
    await serverPrisma.productPriceHistory.deleteMany({ where: { product: { commercialName: TEST_PRODUCT_NAME } } });
    await serverPrisma.productBarcode.deleteMany({ where: { barcode: NEW_PRODUCT_BARCODE } });
    await serverPrisma.product.deleteMany({ where: { commercialName: TEST_PRODUCT_NAME } });
    await serverPrisma.client.deleteMany({
      where: {
        subscriptionId,
        OR: [
          { id: NEW_CLIENT_ID },
          { identificationNumber: { startsWith: "10203040" } },
        ],
      },
    });
    await serverPrisma.taxScheme.deleteMany({ where: { id: SERVER_TAX_SCHEME_ID } });
    await serverPrisma.paymentMethod.deleteMany({ where: { id: SERVER_PM_CASH_ID } });
    await serverPrisma.auditLog.deleteMany({ where: { userId: SERVER_USER_ID } });
    await serverPrisma.userSession.deleteMany({ where: { userId: SERVER_USER_ID } });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Integration Workstation Ops",
        code: "WS-POS-INT-OPS-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Integration Cashier",
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId,
        isActive: true,
      },
    });

    await serverPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        subscriptionId,
        code: "POS-INT-IVA19",
        name: "POS Integration IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-INT-CASH",
        name: "POS Integration Cash",
        category: "CASH",
        isCash: true,
      },
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    serverApp = moduleFixture.createNestApplication();
    serverApp.useGlobalFilters(new HttpExceptionFilter());
    serverApp.useGlobalInterceptors(serverApp.get(TenantContextInterceptor));
    serverApp.useGlobalPipes(new ValidationPipe({ transform: true }));
    await serverApp.listen(0); // real HTTP listener on an ephemeral port

    serverPort = serverApp.getHttpServer().address().port;

    const loginRes = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: "PASSWORD",
        workstationId: SERVER_WS_ID,
      })
      .expect(200);
    serverToken = loginRes.body.accessToken as string;

    // =====================================================================
    // 2. POS — real PGlite + real local Prisma + real domain services
    // =====================================================================
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);

    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    const now = new Date();
    // The generic (consumidor final) client every anonymous sale falls back to.
    await localPrisma.client.create({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        identificationType: "NIT",
        identificationNumber: "222222222222",
        fullName: "Cliente Genérico",
        isActive: true,
        createdById: POS_USER_ID,
      },
    });
    await localPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        code: "POS-INT-IVA19",
        name: "POS Integration IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: POS_USER_ID,
      },
    });
    await localPrisma.paymentMethod.create({
      data: {
        id: PM_CASH_ID,
        internalCode: "POS-INT-CASH",
        name: "POS Integration Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // The session the POS holds after login.
    useLocalSessionStore.getState().setSession({
      userId: POS_USER_ID,
      username: USERNAME,
      fullName: "POS Integration Cashier",
      displayName: "POS Integration Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-int",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-int-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;

    clientsService = createClientsService(localPrisma, auth);
    productService = createProductService(localPrisma, auth);
    cashShiftService = createCashShiftService(localPrisma, auth);
  }, 120000);

  afterAll(async () => {
    // POS side
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();

    // Server side (children before parents)
    if (serverPrisma) {
      await serverPrisma.syncOperationOutcome.deleteMany({ where: { subscriptionId } });
      await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
      await serverPrisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: SERVER_WS_ID } } });
      await serverPrisma.cashShift.deleteMany({ where: { workstationId: SERVER_WS_ID } });
      await serverPrisma.productTaxHistory.deleteMany({ where: { product: { commercialName: TEST_PRODUCT_NAME } } });
      await serverPrisma.productPriceHistory.deleteMany({ where: { product: { commercialName: TEST_PRODUCT_NAME } } });
      await serverPrisma.productBarcode.deleteMany({ where: { barcode: NEW_PRODUCT_BARCODE } });
      await serverPrisma.product.deleteMany({ where: { commercialName: TEST_PRODUCT_NAME } });
      await serverPrisma.client.deleteMany({
        where: {
          subscriptionId,
          OR: [
            { id: NEW_CLIENT_ID },
            { identificationNumber: { startsWith: "10203040" } },
          ],
        },
      });
      await serverPrisma.taxScheme.deleteMany({ where: { id: SERVER_TAX_SCHEME_ID } });
      await serverPrisma.paymentMethod.deleteMany({ where: { id: SERVER_PM_CASH_ID } });
      await serverPrisma.auditLog.deleteMany({ where: { userId: SERVER_USER_ID } });
      await serverPrisma.userSession.deleteMany({ where: { userId: SERVER_USER_ID } });
      await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
      await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Tick the server cron until every queue row for the workstation is done. */
  const drainServerQueue = async (): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 10; i++) {
      await job.processPendingOperations();
      const pending = await serverPrisma.syncQueue.count({
        where: {
          sourceWorkstationId: SERVER_WS_ID,
          status: { in: ["PENDING", "PROCESSING", "FAILED"] },
        },
      });
      if (pending === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  /** Push the whole local outbox over real HTTP, then drain the server cron. */
  const pushAndDrain = async (
    pushService: ReturnType<typeof createSyncPushService>,
  ): Promise<{ pushed: number; accepted: number }> => {
    const result = await pushService.pushPending();
    await drainServerQueue();
    return result;
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("carries a POS-created client to the server database", async () => {
    const created = await clientsService.create({
      fullName: "María Integración",
      identificationType: "CC",
      identificationNumber: "1020304050",
      phone: "3105551234",
      email: "maria@example.com",
    });
    // The POS must preserve the local UUID it generated (metadata.localClientId
    // contract) so the server row lands under the same id.
    expect(created.id).toBeTruthy();

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const { pushed, accepted } = await pushAndDrain(push);
    expect(pushed).toBe(1);
    expect(accepted).toBe(1);

    // Server database: the client row exists with the POS data.
    const serverClient = await serverPrisma.client.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(serverClient.fullName).toBe("María Integración");
    expect(serverClient.identificationType).toBe("CC");
    expect(serverClient.identificationNumber).toBe("1020304050");
    expect(serverClient.isActive).toBe(true);
    expect(serverClient.subscriptionId).toBe(subscriptionId);

    // Local side: the outbox entry is COMPLETED.
    const localEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "CLIENT_CREATION" },
    });
    expect(localEntry.status).toBe("COMPLETED");
  });

  it("carries a POS-created product to the server database", async () => {
    const created = (await productService.createProduct({
      commercialName: TEST_PRODUCT_NAME,
      laboratory: "Genfar",
      saleType: "FREE_SALE",
      price: { price: 8500 },
      tax: { taxSchemeId: SERVER_TAX_SCHEME_ID },
      barcodes: [
        { barcode: NEW_PRODUCT_BARCODE, barcodeType: "EAN13", isPrimary: true },
      ],
    })) as { id: string; internalCode: string };

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const { pushed, accepted } = await pushAndDrain(push);
    expect(pushed).toBe(1);
    expect(accepted).toBe(1);

    // Server database: product exists, OFFLINE- code replaced by a P-code,
    // initial price/tax histories exist, and the barcode survived the wire.
    // NOTE: the server assigns its OWN product id (the POS-local UUID is kept
    // in sourceProductId) — identity on the POS side is reconciled via
    // serverId by the push response handler.
    const serverProduct = await serverPrisma.product.findFirstOrThrow({
      where: { sourceProductId: created.id },
      include: {
        priceHistories: true,
        taxHistories: true,
        barcodes: true,
      },
    });
    expect(serverProduct.commercialName).toBe("Dolex Integración");
    expect(serverProduct.laboratory).toBe("Genfar");
    expect(serverProduct.saleType).toBe("FREE_SALE");
    expect(serverProduct.internalCode).toMatch(/^P\d+$/);
    expect(serverProduct.sourceOperationUuid).toBeTruthy();
    // The POS-local UUID is preserved as a forward reference for sale replay.
    expect(serverProduct.sourceProductId).toBe(created.id);
    expect(serverProduct.priceHistories).toHaveLength(1);
    expect(Number(serverProduct.priceHistories[0].price)).toBe(8500);
    expect(serverProduct.taxHistories).toHaveLength(1);
    expect(serverProduct.taxHistories[0].taxSchemeId).toBe(SERVER_TAX_SCHEME_ID);
    expect(serverProduct.barcodes.map((b) => b.barcode)).toContain(
      NEW_PRODUCT_BARCODE,
    );

    // Local side: the push reconciled serverId + the clean internal code.
    const localProduct = await localPrisma.product.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(localProduct.serverId).toBe(serverProduct.id);
    expect(localProduct.internalCode).toMatch(/^P\d+$/);
  });

  it("carries a full shift open → close cycle to the server database", async () => {
    // Open on the POS: SHIFT_OPEN queued locally.
    const localShift = await cashShiftService.openShift({
      openingBalance: new Prisma.Decimal("200000"),
    });
    expect(localShift.state).toBe("OPEN");

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    let result = await pushAndDrain(push);
    expect(result.accepted).toBeGreaterThanOrEqual(1);

    // Server database: the OPEN shift arrived with the SAME id and the
    // workstation taken from the authenticated session.
    const serverShift = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: localShift.id },
    });
    expect(serverShift.state).toBe("OPEN");
    expect(serverShift.workstationId).toBe(SERVER_WS_ID);
    expect(Number(serverShift.openingBalance)).toBe(200000);

    // Register a closing cash count and close the shift on the POS.
    await cashShiftService.registerCashCount(localShift.id, {
      countType: "CLOSING",
      paymentMethodId: PM_CASH_ID,
      expectedAmount: new Prisma.Decimal("200000"),
      declaredAmount: new Prisma.Decimal("200000"),
    });
    await cashShiftService.closeShift(localShift.id, {
      closingNotes: "Cierre sin novedades",
    });

    // Push the SHIFT_CLOSURE and drain.
    result = await pushAndDrain(push);
    expect(result.accepted).toBeGreaterThanOrEqual(1);

    // Server database: CLOSED with the POS-computed totals and notes.
    const closed = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: localShift.id },
      include: { cashCounts: true },
    });
    expect(closed.state).toBe("CLOSED");
    expect(closed.closingNotes).toBe("Cierre sin novedades");
    expect(Number(closed.expectedClosingAmount)).toBe(200000);
    expect(Number(closed.actualClosingAmount)).toBe(200000);
    expect(Number(closed.closingDifference)).toBe(0);
    expect(closed.cashCounts.length).toBeGreaterThanOrEqual(1);
    expect(
      closed.cashCounts.every((c) => c.countType === "CLOSING"),
    ).toBe(true);

    // Local side: SHIFT_OPEN + SHIFT_CLOSURE entries are COMPLETED.
    const localEntries = await localPrisma.syncQueue.findMany({
      where: { operationType: { in: ["SHIFT_OPEN", "SHIFT_CLOSURE"] } },
      select: { status: true },
    });
    expect(localEntries.map((e) => e.status).sort()).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);
  });

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
