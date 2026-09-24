/**
 * POS ↔ Server integration — CLIENT CREDIT MONEY FLOWS.
 *
 * Credit sales and abonos move real money and are the least forgiving part
 * of the offline-first model: a lost or duplicated abono silently changes a
 * customer's balance. This spec drives the real POS CreditService (PGlite)
 * over real HTTP into the real NestJS dispatcher and asserts the SERVER
 * rows that back the balance:
 *
 *   1. Credit sale offline → server sale CONFIRMED with a CREDIT payment,
 *      then the abono replays as a ClientCreditPayment row; re-delivering
 *      the same abono is idempotent (upsert on the local id).
 *   2. Overpayment is a POS-side domain rule: the abono is rejected BEFORE
 *      a sync entry is enqueued (the server intentionally does not
 *      re-validate the cap — the POS debt can legitimately be higher during
 *      the sync window).
 *   3. Abono annulment mirrors server-side (annulledAt + reason), is
 *      idempotent on re-delivery, and is terminal locally.
 *   4. Degraded client (see backlog bug #6): a credit sale whose
 *      CLIENT_CREATION lands later gets its client patched, and the abono
 *      for that client still attaches to the client row instead of being
 *      rejected as unknown.
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

import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";
import {
  SalesPosService,
  createSalesPosService,
} from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import {
  CashShiftService,
  createCashShiftService,
} from "../cash-shift/cash-shift.service";
import { createClientsService } from "../clients/clients.service";
import { createCreditService } from "../clients/credit.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-credit-server-ws");
const SERVER_USER_ID = "pos-int-credit-server-user-id";
const USERNAME = "pos-integration-credit@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-credit-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-credit-pm-cash");
const SERVER_PM_CREDIT_ID = uuidFrom("pos-int-credit-pm-credit");

const SERVER_PRODUCT_ID = uuidFrom("pos-int-credit-product");
const SERVER_LOT_ID = uuidFrom("pos-int-credit-lot");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-credit-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-credit-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-credit-reception-item");

const SERVER_RESOLUTION_ID = uuidFrom("pos-int-credit-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-credit-allocation");

const POS_WS_ID = "pos-int-credit-ws-0001";

const UNIT_PRICE = 12000;
const SALE_TOTAL = 14280; // 1 × 12000 × 1.19
const CREDIT_LIMIT = 500000;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — client credit money flows", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let salesPos: SalesPosService;
  let cashShift: CashShiftService;
  let clientsLocal: ReturnType<typeof createClientsService>;
  let credit: ReturnType<typeof createCreditService>;

  /** Local auth stub bound to the shared session store. */
  const auth = {
    requireRole: () => useLocalSessionStore.getState().session!,
  } as any;

  const push = (): ReturnType<typeof createSyncPushService> =>
    createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });

  const drainServerQueue = async (maxTicks = 12): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < maxTicks; i++) {
      await job.processPendingOperations();
      const pending = await serverPrisma.syncQueue.count({
        where: {
          subscriptionId,
          OR: [
            { status: "PENDING" },
            { status: "PROCESSING" },
            { status: "FAILED", nextRetryAt: { not: null } },
          ],
        },
      });
      if (pending === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.clientCreditPayment.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.client.deleteMany({
      where: { identificationNumber: { startsWith: "CREDIT-" } },
    });
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: { saleItem: { sale: { cashShift: { workstationId: SERVER_WS_ID } } } },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: SERVER_WS_ID } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: SERVER_WS_ID } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { id: SERVER_RECEPTION_ITEM_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { id: SERVER_RECEPTION_ID },
    });
    await serverPrisma.supplier.deleteMany({
      where: { id: SERVER_SUPPLIER_ID },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.product.deleteMany({
      where: { id: SERVER_PRODUCT_ID },
    });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: { in: [SERVER_PM_CASH_ID, SERVER_PM_CREDIT_ID] } },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: SERVER_WS_ID },
    });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-credit");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Credit Workstation",
        code: "WS-POS-CREDIT-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Credit Cashier",
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
        code: "POS-CREDIT-IVA19",
        name: "POS Credit IVA 19%",
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
        internalCode: "POS-CREDIT-CASH",
        name: "POS Credit Cash",
        category: "CASH",
        isCash: true,
      },
    });
    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CREDIT_ID,
        internalCode: "POS-CREDIT-CREDIT",
        name: "POS Credit Credit",
        category: "CREDIT",
        isCash: false,
      },
    });

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-CREDIT-001",
        commercialName: "POS Credit Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const price = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-credit-price"),
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const tax = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-credit-tax-hist"),
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: SERVER_PRODUCT_ID },
      data: { currentPriceId: price.id, currentTaxHistoryId: tax.id },
    });

    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900777666-5",
        businessName: "POS Credit Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.purchaseReception.create({
      data: {
        id: SERVER_RECEPTION_ID,
        subscriptionId,
        sequentialNumber: 1,
        state: "CONFIRMED",
        receivedAt: new Date("2026-01-02"),
        createdById: SERVER_USER_ID,
        supplierId: SERVER_SUPPLIER_ID,
      },
    });
    await serverPrisma.purchaseReceptionItem.create({
      data: {
        id: SERVER_RECEPTION_ITEM_ID,
        subscriptionId,
        purchaseReceptionId: SERVER_RECEPTION_ID,
        productId: SERVER_PRODUCT_ID,
        lotId: SERVER_LOT_ID,
        receivedQuantity: 100,
        lotNumber: "CREDIT-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("5000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "CREDIT-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 100,
        version: 0,
        productId: SERVER_PRODUCT_ID,
      },
    });

    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "1876400555666",
        documentType: "INVOICE",
        prefix: "POS-CREDIT",
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2027-12-31"),
        state: "ACTIVE",
        workstationId: SERVER_WS_ID,
      },
    });
    await serverPrisma.fiscalResolutionAllocation.create({
      data: {
        id: SERVER_ALLOCATION_ID,
        subscriptionId,
        resolutionId: SERVER_RESOLUTION_ID,
        workstationId: SERVER_WS_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date("2026-01-01"),
        allocatedByUserId: SERVER_USER_ID,
      },
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    serverApp = moduleFixture.createNestApplication();
    serverApp.useGlobalFilters(new HttpExceptionFilter());
    serverApp.useGlobalInterceptors(serverApp.get(TenantContextInterceptor));
    serverApp.useGlobalPipes(new ValidationPipe({ transform: true }));
    await serverApp.listen(0);
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

    // ── POS: real PGlite with the mirrored catalog ─────────────────────
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    const now = new Date();
    await localPrisma.client.create({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        identificationType: "NIT",
        identificationNumber: "222222222222",
        fullName: "Cliente Genérico",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await localPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        code: "POS-CREDIT-IVA19",
        name: "POS Credit IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: SERVER_USER_ID,
      },
    });
    await localPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        internalCode: "POS-CREDIT-001",
        commercialName: "POS Credit Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });
    await localPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-credit-local-price"),
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-credit-local-tax-hist"),
        productId: SERVER_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.lot.create({
      data: {
        id: uuidFrom("pos-int-credit-local-lot"),
        batchNumber: "CREDIT-LOCAL-BATCH",
        expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
        entryDate: now,
        state: "ACTIVE",
        currentStock: 100,
        productId: SERVER_PRODUCT_ID,
      },
    });
    for (const [id, code, name, category, isCash] of [
      [SERVER_PM_CASH_ID, "POS-CREDIT-CASH", "POS Credit Cash", "CASH", true],
      [
        SERVER_PM_CREDIT_ID,
        "POS-CREDIT-CREDIT",
        "POS Credit Credit",
        "CREDIT",
        false,
      ],
    ] as const) {
      await localPrisma.paymentMethod.create({
        data: {
          id,
          internalCode: code,
          name,
          category,
          isCash,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS Credit Cashier",
      displayName: "POS Credit Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-credit",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-credit-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    salesPos = createSalesPosService(
      localPrisma,
      auth,
      createInventoryLotsService(localPrisma),
    );
    cashShift = createCashShiftService(localPrisma, auth);
    clientsLocal = createClientsService(localPrisma, auth);
    credit = createCreditService(localPrisma, auth);

    // One global local shift, opened and pushed so the server knows the
    // shift the abonos reference (ClientCreditPayment.cashShiftId FK).
    await cashShift.openShift({ openingBalance: new Prisma.Decimal("100000") });
  }, 180000);

  afterAll(async () => {
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();
    if (serverPrisma) {
      await cleanServerRows();
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Pushes everything pending and drains the server-side queue. */
  const pushAndDrain = async (): Promise<void> => {
    await push().pushPending();
    await drainServerQueue();
  };

  /** Creates an offline credit client and returns its local row. */
  const createCreditClient = async (
    label: string,
  ): Promise<{ id: string }> => {
    const client = (await clientsLocal.create({
      fullName: `Credit ${label}`,
      identificationType: "CC",
      identificationNumber: `CREDIT-${label}-${Date.now()}`,
      creditLimit: CREDIT_LIMIT,
    })) as { id: string };
    return client;
  };

  /** Sells one unit on credit to the given local client. */
  const sellOnCredit = async (clientId: string): Promise<string> => {
    const sale = (await salesPos.create({
      clientId,
      items: [{ productId: SERVER_PRODUCT_ID, quantity: 1 }],
    })) as { id: string };
    await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: SERVER_PM_CREDIT_ID, amount: SALE_TOTAL }],
    });
    return sale.id;
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("carries a credit sale and its abono to the server database", async () => {
    const client = await createCreditClient("A");
    await sellOnCredit(client.id);

    // The abono: 10000 COP against a 14280 COP debt.
    const payment = await credit.recordCreditPayment({
      clientId: client.id,
      amountCents: 1000000,
      paymentMethodId: SERVER_PM_CASH_ID,
      notes: "Abono prueba",
    });

    await pushAndDrain();

    // Server sale: CONFIRMED, paid with the CREDIT method.
    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    expect(serverSale.payments).toHaveLength(1);
    expect(serverSale.payments[0]!.paymentMethodId).toBe(SERVER_PM_CREDIT_ID);

    // Server abono: replayed with the POS-local id, exact amount, tied to
    // the client and NOT annulled.
    const serverPayment =
      await serverPrisma.clientCreditPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    expect(serverPayment.clientId).toBe(client.id);
    expect(Number(serverPayment.amount)).toBe(10000);
    expect(serverPayment.annulledAt).toBeNull();
    expect(serverPayment.notes).toBe("Abono prueba");

    // Re-deliver the SAME abono entry: idempotent (no duplicate row).
    await localPrisma.syncQueue.updateMany({
      where: { operationType: "CLIENT_CREDIT_PAYMENT" },
      data: { status: "PENDING" },
    });
    await pushAndDrain();
    const abonoCount = await serverPrisma.clientCreditPayment.count({
      where: { clientId: client.id },
    });
    expect(abonoCount).toBe(1);
  }, 180000);

  it("rejects an overpayment locally before it ever reaches the outbox", async () => {
    const client = await createCreditClient("B");
    await sellOnCredit(client.id);
    await pushAndDrain();

    // Debt is 14280 COP: one cent more must be refused by the POS domain
    // rule (the server deliberately caps nothing — see the service docs).
    const entriesBefore = await localPrisma.syncQueue.count({
      where: { operationType: "CLIENT_CREDIT_PAYMENT" },
    });
    await expect(
      credit.recordCreditPayment({
        clientId: client.id,
        amountCents: 1428001,
        paymentMethodId: SERVER_PM_CASH_ID,
      }),
    ).rejects.toThrow();
    const entriesAfter = await localPrisma.syncQueue.count({
      where: { operationType: "CLIENT_CREDIT_PAYMENT" },
    });
    expect(entriesAfter).toBe(entriesBefore);

    // No server abono was created for the client.
    const serverAbonos = await serverPrisma.clientCreditPayment.count({
      where: { clientId: client.id },
    });
    expect(serverAbonos).toBe(0);

    // The exact remaining debt IS accepted.
    const exact = await credit.recordCreditPayment({
      clientId: client.id,
      amountCents: 1428000,
      paymentMethodId: SERVER_PM_CASH_ID,
    });
    await pushAndDrain();
    const serverPayment =
      await serverPrisma.clientCreditPayment.findUniqueOrThrow({
        where: { id: exact.id },
      });
    expect(Number(serverPayment.amount)).toBe(14280);
  }, 180000);

  it("annuls an abono server-side, idempotently and terminally", async () => {
    const client = await createCreditClient("C");
    await sellOnCredit(client.id);
    const payment = await credit.recordCreditPayment({
      clientId: client.id,
      amountCents: 500000,
      paymentMethodId: SERVER_PM_CASH_ID,
    });
    await pushAndDrain();

    const annulled = await credit.annulCreditPayment(
      payment.id,
      "Registro duplicado",
    );
    expect(annulled.annulledAt).toBeTruthy();
    await pushAndDrain();

    const serverPayment =
      await serverPrisma.clientCreditPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    expect(serverPayment.annulledAt).not.toBeNull();
    expect(serverPayment.annulmentReason).toBe("Registro duplicado");

    // Re-deliver the ANNULMENT: idempotent (already annulled → no-op).
    await localPrisma.syncQueue.updateMany({
      where: { operationType: "CLIENT_CREDIT_PAYMENT_ANNULMENT" },
      data: { status: "PENDING" },
    });
    await pushAndDrain();
    const reRead = await serverPrisma.clientCreditPayment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(reRead.annulmentReason).toBe("Registro duplicado");

    // The local rule is terminal: a second annulment is refused.
    await expect(
      credit.annulCreditPayment(payment.id, "Otra vez"),
    ).rejects.toThrow();
  }, 180000);

  it("revives a credit sale whose CLIENT_CREATION arrived later, and the abono still attaches", async () => {
    const client = await createCreditClient("D");
    await sellOnCredit(client.id);

    // Hold the CLIENT_CREATION back so the SALE lands first. Unlike a CASH
    // sale (which degrades to a NULL client), a CREDIT sale cannot be
    // replayed against an unknown buyer: the replay dies PERMANENT_FAILURE
    // and only the dependency requeue can save it.
    await localPrisma.syncQueue.updateMany({
      where: { operationType: "CLIENT_CREATION", status: "PENDING" },
      data: {
        status: "FAILED",
        nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await push().pushPending();
    await drainServerQueue();

    const deadSaleRow = await serverPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "SALE_CONFIRMATION", subscriptionId },
      orderBy: { receivedAt: "desc" },
    });
    expect(deadSaleRow.status).toBe("PERMANENT_FAILURE");
    expect(
      await serverPrisma.sale.count({
        where: { sourceOperationUuid: deadSaleRow.operationUuid },
      }),
    ).toBe(0);

    // NOW the client creation lands: its handler requeues the dead sale and
    // the next cron tick replays it with the client in place.
    await localPrisma.syncQueue.updateMany({
      where: { operationType: "CLIENT_CREATION" },
      data: { status: "PENDING", nextRetryAt: null },
    });
    await push().pushPending();
    await drainServerQueue();

    const revivedRow = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: deadSaleRow.operationUuid },
    });
    expect(revivedRow.status).toBe("COMPLETED");

    const revivedSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceOperationUuid: deadSaleRow.operationUuid },
    });
    expect(revivedSale.operationalState).toBe("CONFIRMED");
    expect(revivedSale.clientId).toBe(client.id);

    // The abono references the local client uuid, which now EXISTS
    // server-side (CLIENT_CREATION adopts the local id) — the replay must
    // attach it instead of failing on an unknown client.
    const payment = await credit.recordCreditPayment({
      clientId: client.id,
      amountCents: 400000,
      paymentMethodId: SERVER_PM_CASH_ID,
    });
    await pushAndDrain();

    const serverPayment =
      await serverPrisma.clientCreditPayment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    expect(serverPayment.clientId).toBe(client.id);

    // Local outbox fully drained.
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  }, 180000);
});
