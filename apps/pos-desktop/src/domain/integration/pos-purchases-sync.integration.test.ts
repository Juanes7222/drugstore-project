/**
 * POS ↔ Server integration — PURCHASES + INVOICE_ADJUSTMENT operations.
 *
 * Three dispatcher operation types had no full-flow coverage. This spec
 * drives the REAL POS purchase services (PGlite) over real HTTP into the
 * real NestJS dispatcher and asserts the server-side money/stock effects:
 *
 *   1. PURCHASE_ORDER_CONFIRMATION — an offline-created and confirmed PO
 *      replays server-side with its sequentialNumber and items; re-delivery
 *      is idempotent (no duplicate order).
 *   2. SUPPLIER_RETURN_CONFIRMATION — the return leaves the SERVER lot
 *      (stock + InventoryMovement of type SUPPLIER_RETURN) and a re-delivery
 *      must not decrement twice.
 *   3. INVOICE_ADJUSTMENT — an operational (non-DIAN) adjustment replays
 *      with the POS-local id and is idempotent. Driven over the wire in the
 *      exact POS payload shape; the POS-side enqueue path is unit-covered.
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
import { createPurchaseOrdersService } from "../purchases/purchase-orders.service";
import { createSupplierReturnsService } from "../purchases/supplier-returns.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-purch-server-ws");
const SERVER_USER_ID = "pos-int-purch-server-user-id";
const USERNAME = "pos-integration-purch@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-purch-tax-scheme");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-purch-supplier");
const SERVER_PRODUCT_ID = uuidFrom("pos-int-purch-product");
const SERVER_LOT_ID = uuidFrom("pos-int-purch-lot");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-purch-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-purch-reception-item");

const POS_WS_ID = "pos-int-purch-ws-0001";

const UNIT_PRICE = 9000;
const LOT_INITIAL_STOCK = 50;
const RETURN_QTY = 3;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — purchases + invoice adjustment", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let purchaseOrders: ReturnType<typeof createPurchaseOrdersService>;
  let supplierReturns: ReturnType<typeof createSupplierReturnsService>;

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

  const pushAndDrain = async (): Promise<void> => {
    await push().pushPending();
    await drainServerQueue();
  };

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.invoiceLocalAdjustment.deleteMany({
      where: { subscriptionId },
    });
    // Supplier returns + their movements (dynamic ids per run).
    const staleReturns = await serverPrisma.supplierReturn.findMany({
      where: {
        subscriptionId,
        supplierId: { in: [SERVER_SUPPLIER_ID] },
      },
      select: { id: true },
    });
    if (staleReturns.length > 0) {
      const ids = staleReturns.map((r) => r.id);
      await serverPrisma.inventoryMovement.deleteMany({
        where: { supplierReturnId: { in: ids } },
      });
      await serverPrisma.supplierReturnItem.deleteMany({
        where: { supplierReturnId: { in: ids } },
      });
      await serverPrisma.supplierReturn.deleteMany({ where: { id: { in: ids } } });
    }
    const staleOrders = await serverPrisma.purchaseOrder.findMany({
      where: { subscriptionId, supplierId: SERVER_SUPPLIER_ID },
      select: { id: true },
    });
    if (staleOrders.length > 0) {
      const ids = staleOrders.map((o) => o.id);
      await serverPrisma.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: { in: ids } },
      });
      await serverPrisma.purchaseOrder.deleteMany({ where: { id: { in: ids } } });
    }
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { id: SERVER_RECEPTION_ITEM_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { id: SERVER_RECEPTION_ID },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.product.deleteMany({ where: { id: SERVER_PRODUCT_ID } });
    await serverPrisma.supplier.deleteMany({ where: { id: SERVER_SUPPLIER_ID } });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
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
    await serverPrisma.userSession.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });
  };

  /** Re-arms the last pending entry of a type so a re-delivery can be tested. */
  const rearmLocalEntry = async (operationType: string): Promise<void> => {
    await localPrisma.syncQueue.updateMany({
      where: { operationType: operationType as any },
      data: { status: "PENDING", nextRetryAt: null },
    });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-purch");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Purch Workstation",
        code: "WS-POS-PURCH-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Purch Buyer",
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
        code: "POS-PURCH-IVA19",
        name: "POS Purch IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900333222-9",
        businessName: "POS Purch Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-PURCH-001",
        commercialName: "POS Purch Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const price = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-purch-price"),
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
        id: uuidFrom("pos-int-purch-tax-hist"),
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
        receivedQuantity: LOT_INITIAL_STOCK,
        lotNumber: "PURCH-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("4000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "PURCH-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: LOT_INITIAL_STOCK,
        version: 0,
        productId: SERVER_PRODUCT_ID,
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

    // ── POS: PGlite with the mirrored supplier/product/lot/reception ────
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    const now = new Date();
    await localPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        identificationType: "NIT",
        identificationNumber: "900333222-9",
        businessName: "POS Purch Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });
    await localPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        internalCode: "POS-PURCH-001",
        commercialName: "POS Purch Product",
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
        id: uuidFrom("pos-int-purch-local-price"),
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        code: "POS-PURCH-IVA19",
        name: "POS Purch IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: SERVER_USER_ID,
      },
    });
    await localPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-purch-local-tax-hist"),
        productId: SERVER_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        batchNumber: "PURCH-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: now,
        state: "ACTIVE",
        currentStock: LOT_INITIAL_STOCK,
        productId: SERVER_PRODUCT_ID,
      },
    });
    // Local reception item: the return's unit cost comes from it.
    await localPrisma.purchaseReception.create({
      data: {
        id: SERVER_RECEPTION_ID,
        sequentialNumber: 1,
        state: "CONFIRMED",
        receivedAt: new Date("2026-01-02"),
        createdById: SERVER_USER_ID,
        supplierId: SERVER_SUPPLIER_ID,
      },
    });
    await localPrisma.purchaseReceptionItem.create({
      data: {
        id: SERVER_RECEPTION_ITEM_ID,
        purchaseReceptionId: SERVER_RECEPTION_ID,
        productId: SERVER_PRODUCT_ID,
        lotId: SERVER_LOT_ID,
        receivedQuantity: LOT_INITIAL_STOCK,
        lotNumber: "PURCH-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("4000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS Purch Buyer",
      displayName: "POS Purch Buyer",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-purch",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-purch-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    purchaseOrders = createPurchaseOrdersService(localPrisma, auth);
    supplierReturns = createSupplierReturnsService(localPrisma, auth);
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
  // Tests
  // -------------------------------------------------------------------------

  it("PURCHASE_ORDER_CONFIRMATION: the offline order replays once, idempotently", async () => {
    const order = (await purchaseOrders.createOrder({
      supplierId: SERVER_SUPPLIER_ID,
      notes: "Pedido offline",
      items: [
        {
          productId: SERVER_PRODUCT_ID,
          requestedQuantity: 12,
          expectedUnitCost: 4000,
        },
      ],
    })) as { id: string; sequentialNumber: number };
    await purchaseOrders.confirmOrder(order.id);

    const entry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "PURCHASE_ORDER_CONFIRMATION", status: "PENDING" },
    });

    await pushAndDrain();

    const serverOrder = await serverPrisma.purchaseOrder.findFirstOrThrow({
      where: { supplierId: SERVER_SUPPLIER_ID },
      include: { items: true },
    });
    expect(serverOrder.sequentialNumber).toBe(1);
    expect(serverOrder.items).toHaveLength(1);
    expect(serverOrder.items[0]!.productId).toBe(SERVER_PRODUCT_ID);
    expect(serverOrder.items[0]!.requestedQuantity).toBe(12);

    const localEntry = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(localEntry.status).toBe("COMPLETED");

    // Re-delivery: the (sequentialNumber, supplierId) idempotency fallback
    // must keep exactly ONE order.
    await rearmLocalEntry("PURCHASE_ORDER_CONFIRMATION");
    await pushAndDrain();
    const orderCount = await serverPrisma.purchaseOrder.count({
      where: { supplierId: SERVER_SUPPLIER_ID },
    });
    expect(orderCount).toBe(1);

    // The server row is keyed by operationUuid (the local row id is not
    // shared across the wire).
    const redelivered = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: entry.operationUuid },
    });
    expect(["COMPLETED", "PERMANENT_FAILURE"]).toContain(redelivered.status);
  }, 180000);

  it("SUPPLIER_RETURN_CONFIRMATION: stock leaves the server lot exactly once", async () => {
    const supplierReturn = (await supplierReturns.createReturn({
      supplierId: SERVER_SUPPLIER_ID,
      purchaseReceptionId: SERVER_RECEPTION_ID,
      reason: "Producto vencido",
      items: [
        {
          productId: SERVER_PRODUCT_ID,
          lotId: SERVER_LOT_ID,
          quantity: RETURN_QTY,
        },
      ],
    })) as { id: string };
    await supplierReturns.confirmReturn(supplierReturn.id);

    const entry = await localPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "SUPPLIER_RETURN_CONFIRMATION",
        status: "PENDING",
      },
    });
    await pushAndDrain();

    // Server return row exists with its item.
    const serverReturn = await serverPrisma.supplierReturn.findFirstOrThrow({
      where: { supplierId: SERVER_SUPPLIER_ID },
      include: { items: true },
    });
    expect(serverReturn.items).toHaveLength(1);
    expect(serverReturn.items[0]!.quantity).toBe(RETURN_QTY);

    // Stock left the server lot exactly once.
    const lotAfter = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(lotAfter.currentStock).toBe(LOT_INITIAL_STOCK - RETURN_QTY);

    const returnMovements = await serverPrisma.inventoryMovement.count({
      where: { lotId: SERVER_LOT_ID, movementType: "SUPPLIER_RETURN" },
    });
    expect(returnMovements).toBe(1);

    const localEntry = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(localEntry.status).toBe("COMPLETED");

    // Re-delivery: idempotent — no second decrement, no duplicate return.
    await rearmLocalEntry("SUPPLIER_RETURN_CONFIRMATION");
    await pushAndDrain();
    const lotAfterRedelivery = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(lotAfterRedelivery.currentStock).toBe(LOT_INITIAL_STOCK - RETURN_QTY);
    const returnCount = await serverPrisma.supplierReturn.count({
      where: { supplierId: SERVER_SUPPLIER_ID },
    });
    expect(returnCount).toBe(1);
  }, 180000);

  it("INVOICE_ADJUSTMENT: an operational adjustment replays with its local id, idempotently", async () => {
    const adjustmentId = crypto.randomUUID();
    const payload = {
      adjustmentId,
      invoiceId: uuidFrom("pos-int-purch-invoice"),
      invoiceNumber: "POS-PURCH-1",
      adjustmentType: "INTERNAL_NOTE",
      previousValue: null,
      newValue: { note: "Ajuste operativo offline" },
      reason: "Nota interna del cajero",
      version: 1,
      reversalOfAdjustmentId: null,
      replacedByAdjustmentId: null,
      createdByUserId: SERVER_USER_ID,
      createdByUserName: "POS Purch Buyer",
      workstationId: POS_WS_ID,
      createdAt: new Date().toISOString(),
    };
    const opUuid = crypto.randomUUID();
    const op = {
      operationType: "INVOICE_ADJUSTMENT",
      operationUuid: opUuid,
      payload,
      payloadHash: crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence: 700,
      source: "DIRECT",
    };

    await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${serverToken}`)
      .send([op])
      .expect(202);
    await drainServerQueue();

    const stored = await serverPrisma.invoiceLocalAdjustment.findUniqueOrThrow({
      where: { id: adjustmentId },
    });
    expect(stored.invoiceNumber).toBe("POS-PURCH-1");
    expect(stored.adjustmentType).toBe("INTERNAL_NOTE");
    expect(stored.reason).toBe("Nota interna del cajero");

    // Re-delivery of the SAME operation (new queue row, same uuid is
    // rejected as duplicate — so replay with a fresh uuid but the same
    // adjustmentId, exactly like a retried POS entry whose ACK was lost).
    const retryPayloadHash = op.payloadHash;
    await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${serverToken}`)
      .send([
        {
          ...op,
          operationUuid: crypto.randomUUID(),
          payloadHash: retryPayloadHash,
          clientSequence: 701,
        },
      ])
      .expect(202);
    await drainServerQueue();

    const count = await serverPrisma.invoiceLocalAdjustment.count({
      where: { id: adjustmentId },
    });
    expect(count).toBe(1);
  }, 180000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
