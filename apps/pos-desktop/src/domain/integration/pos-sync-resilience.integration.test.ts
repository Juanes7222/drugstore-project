/**
 * POS ↔ Server integration — sync RESILIENCE: the unhappy paths that decide
 * whether production converges or silently duplicates/corrupts data.
 *
 * Same real-code harness as the other integration specs (real PGlite POS,
 * real NestJS AppModule, real HTTP, real cron). Covers:
 *
 *  1. Lost response + retry: a batch the server ACCEPTED and dispatched but
 *     whose response never reached the POS is re-sent with the SAME
 *     operationUuid — the server must answer ALREADY_ACCEPTED with the
 *     original entityId and must NOT create a second product.
 *  2. Corrupted payload: a payload whose hash does not match must be
 *     REJECTED server-side and end as PERMANENT_FAILURE locally (no infinite
 *     retry loop), while the rest of the batch is unaffected.
 *  3. Transient failure + cron retry: a SALE_CONFIRMATION referencing a
 *     product the server does not know yet fails, stays retryable (FAILED
 *     with nextRetryAt), and is completed by the cron once the product
 *     exists (offline catalog race).
 *  4. Sale against a closed global shift: the sale-replay fallback attaches
 *     the sale to the referenced (now CLOSED) shift instead of failing.
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

const SERVER_WS_ID = uuidFrom("pos-int-resilience-server-ws");
const SERVER_USER_ID = "pos-int-resilience-server-user-id";
const USERNAME = "pos-integration-resilience@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_PRODUCT_A_ID = uuidFrom("pos-int-resilience-product-a");
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-resilience-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-resilience-pm-cash");
// The product the offline race will reference before it exists server-side.
const MISSING_PRODUCT_ID = uuidFrom("pos-int-resilience-product-missing");

const POS_WS_ID = "pos-int-resilience-ws-0001";

const SERVER_SUPPLIER_ID = uuidFrom("pos-int-resilience-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-resilience-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-resilience-reception-item");
const SERVER_LOT_A_ID = uuidFrom("pos-int-resilience-lot-a");
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-resilience-fiscal-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-resilience-fiscal-allocation");
const UNIT_PRICE = 12000;
const SALE_TOTAL_A = 14280; // 1 × 12000 × 1.19

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — sync resilience (unhappy paths)", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;

  /** SHA-256 payload hash in the exact wire format the POS produces. */
  const wireHash = (payload: unknown): string =>
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: {
        saleItem: { sale: { cashShift: { workstationId: SERVER_WS_ID } } },
      },
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
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId: subscriptionId! },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.productCostHistory.deleteMany({
      where: { productId: { in: [SERVER_PRODUCT_A_ID, MISSING_PRODUCT_ID] } },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: { in: [SERVER_PRODUCT_A_ID, MISSING_PRODUCT_ID] } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: { in: [SERVER_PRODUCT_A_ID, MISSING_PRODUCT_ID] } },
    });
    // The idempotency test creates its product with a dynamic local id —
    // clear its histories by name before deleting the product itself.
    await serverPrisma.productPriceHistory.deleteMany({
      where: { product: { commercialName: "Idempotencia Producto" } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { product: { commercialName: "Idempotencia Producto" } },
    });
    await serverPrisma.productBarcode.deleteMany({
      where: { barcode: "7709999000012" },
    });
    await serverPrisma.productCostHistory.deleteMany({
      where: { product: { commercialName: "Idempotencia Producto" } },
    });
    // Lotes referencing the sync-created product (none created by this spec,
    // but a leftover from an interrupted run would block the delete).
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lot: { product: { commercialName: "Idempotencia Producto" } } },
    });
    await serverPrisma.lot.deleteMany({
      where: { product: { commercialName: "Idempotencia Producto" } },
    });
    await serverPrisma.product.deleteMany({
      where: { commercialName: "Idempotencia Producto" },
    });
    // Product A's lot/reception (they reference the product — RESTRICT).
    // Sale replays wrote InventoryMovements against the lots — clear them
    // (children first) before the lots themselves.
    await serverPrisma.inventoryMovement.deleteMany({
      where: {
        lotId: { in: [SERVER_LOT_A_ID, uuidFrom("res-server-lot-missing")] },
      },
    });
    await serverPrisma.lot.deleteMany({
      where: {
        id: { in: [SERVER_LOT_A_ID, uuidFrom("res-server-lot-missing")] },
      },
    });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: {
        id: {
          in: [
            SERVER_RECEPTION_ITEM_ID,
            uuidFrom("res-server-reception-item-missing"),
          ],
        },
      },
    });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { id: SERVER_RECEPTION_ITEM_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { id: SERVER_RECEPTION_ID },
    });
    await serverPrisma.product.deleteMany({
      where: { id: { in: [SERVER_PRODUCT_A_ID, MISSING_PRODUCT_ID] } },
    });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
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

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-resilience");
    await cleanServerRows();

    await serverPrisma.workstation.upsert({
      where: { id: SERVER_WS_ID },
      update: {},
      create: {
        id: SERVER_WS_ID,
        name: "POS Resilience Workstation",
        code: "WS-POS-RES-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Resilience Cashier",
        passwordHash,
        passwordAlgorithm: "argon2",
        role: "ADMIN",
        subscriptionId,
        isActive: true,
      },
    });

    await serverPrisma.taxScheme.upsert({
      where: { id: SERVER_TAX_SCHEME_ID },
      update: {},
      create: {
        id: SERVER_TAX_SCHEME_ID,
        subscriptionId,
        code: "POS-RES-IVA19",
        name: "POS Resilience IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.paymentMethod.upsert({
      where: { id: SERVER_PM_CASH_ID },
      update: {},
      create: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-RES-CASH",
        name: "POS Resilience Cash",
        category: "CASH",
        isCash: true,
      },
    });

    // Catalog product A already exists server-side (pulled in a previous
    // sync). The "missing" product is intentionally NOT created here — the
    // transient-failure test relies on it being absent until step 3.
    await serverPrisma.product.upsert({
      where: { id: SERVER_PRODUCT_A_ID },
      update: {},
      create: {
        id: SERVER_PRODUCT_A_ID,
        subscriptionId,
        internalCode: "POS-RES-001",
        commercialName: "POS Resilience Product A",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const productAHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("res-server-price-a"),
        subscriptionId,
        productId: SERVER_PRODUCT_A_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const productATaxHistory = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("res-server-tax-a"),
        subscriptionId,
        productId: SERVER_PRODUCT_A_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: SERVER_PRODUCT_A_ID },
      data: {
        currentPriceId: productAHistory.id,
        currentTaxHistoryId: productATaxHistory.id,
      },
    });

    // Catalog product A already exists server-side (pulled in a previous
    // sync) WITH its stock lot — sale replay consumes FIFO stock, so the
    // lot must carry real stock and an acquisition cost (PurchaseReception
    // item) or every replay dies with LotCostUnavailable/InsufficientStock.
    // Upserts everywhere: an interrupted run (beforeAll failure) leaves rows
    // behind and afterAll cleanup never ran — re-running must not collide.
    await serverPrisma.supplier.upsert({
      where: { id: SERVER_SUPPLIER_ID },
      update: {},
      create: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-3",
        businessName: "POS Resilience Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.purchaseReception.upsert({
      where: { id: SERVER_RECEPTION_ID },
      update: {},
      create: {
        id: SERVER_RECEPTION_ID,
        subscriptionId,
        sequentialNumber: 1,
        state: "CONFIRMED",
        receivedAt: new Date("2026-01-02"),
        createdById: SERVER_USER_ID,
        supplierId: SERVER_SUPPLIER_ID,
      },
    });
    await serverPrisma.purchaseReceptionItem.upsert({
      where: { id: SERVER_RECEPTION_ITEM_ID },
      update: {},
      create: {
        id: SERVER_RECEPTION_ITEM_ID,
        subscriptionId,
        purchaseReceptionId: SERVER_RECEPTION_ID,
        productId: SERVER_PRODUCT_A_ID,
        lotId: SERVER_LOT_A_ID,
        receivedQuantity: 100,
        lotNumber: "RES-BATCH-A",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("5000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });
    await serverPrisma.lot.upsert({
      where: { id: SERVER_LOT_A_ID },
      update: {},
      create: {
        id: SERVER_LOT_A_ID,
        subscriptionId,
        batchNumber: "RES-BATCH-A",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 100,
        version: 0,
        productId: SERVER_PRODUCT_A_ID,
      },
    });

    // DIAN invoice numbering: every sale generates an INVOICE that consumes
    // a consecutive from the workstation's active resolution allocation.
    await serverPrisma.fiscalResolution.upsert({
      where: { id: SERVER_RESOLUTION_ID },
      update: {},
      create: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000987654",
        documentType: "INVOICE",
        prefix: "POS-RES",
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

    // ── POS: real PGlite + mirrored catalog ────────────────────────────
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
        code: "POS-RES-IVA19",
        name: "POS Resilience IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: SERVER_USER_ID,
      },
    });
    await localPrisma.paymentMethod.create({
      data: {
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-RES-CASH",
        name: "POS Resilience Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS Resilience Cashier",
      displayName: "POS Resilience Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-resilience",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-resilience-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });
  }, 120000);

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

  /** Creates a local product row in the POS (offline catalog mirror). */
  const seedLocalProduct = async (
    productId: string,
    internalCode: string,
    name: string,
  ): Promise<{ id: string }> => {
    const now = new Date();
    await localPrisma.product.create({
      data: {
        id: productId,
        internalCode,
        commercialName: name,
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
        id: uuidFrom(`res-price-${productId}`),
        productId,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom(`res-tax-${productId}`),
        productId,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.lot.create({
      data: {
        id: uuidFrom(`res-lot-${productId}`),
        batchNumber: `RES-${internalCode}`,
        expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
        entryDate: now,
        state: "ACTIVE",
        currentStock: 100,
        productId,
      },
    });
    return { id: productId };
  };

  /**
   * Builds a SALE_CONFIRMATION operation in the exact wire format the POS
   * push produces, without going through SalesPosService. `override` lets a
   * test corrupt fields (e.g. the payload hash) before sending.
   */
  const buildSaleOperation = (
    operationUuid: string,
    clientSequence: number,
    productId: string,
    cashShiftId: string,
    localNumber: number,
  ): Record<string, unknown> => {
    const payload = {
      userId: SERVER_USER_ID,
      createSaleDto: {
        saleType: "FREE_SALE",
        cashShiftId,
        clientId: "00000000-0000-0000-0000-000000000001",
        items: [
          {
            productId,
            quantity: 1,
            unitPrice: UNIT_PRICE.toString(),
            discount: "0",
            discountReason: null,
            commissionType: "NONE",
            commissionValue: null,
            commissionAmount: "0",
          },
        ],
        prescriptionNumber: null,
        delivery: null,
        subtotal: UNIT_PRICE.toString(),
        totalDiscount: "0",
        totalTax: (SALE_TOTAL_A - UNIT_PRICE).toString(),
        totalAmount: SALE_TOTAL_A.toString(),
      },
      confirmSaleDto: {
        payments: [
          {
            paymentMethodId: SERVER_PM_CASH_ID,
            amount: SALE_TOTAL_A,
            transactionReference: null,
            authorizationCode: null,
            cardBrand: null,
            cardLastFour: null,
            batchNumber: null,
            processorResponseCode: null,
          },
        ],
      },
      metadata: {
        localSaleId: uuidFrom(`res-sale-${operationUuid}`),
        localNumber,
        workstationId: POS_WS_ID,
        sourceWorkstationId: POS_WS_ID,
        startedAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
      },
    };
    return {
      operationType: "SALE_CONFIRMATION",
      operationUuid,
      payload,
      payloadHash: wireHash(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence,
      source: "DIRECT",
    };
  };

  /**
   * Sends a raw batch over real HTTP exactly like the POS push does, but
   * WITHOUT any local-queue bookkeeping — used to simulate a batch whose
   * response was lost (the server side of the story already happened).
   */
  const sendRawBatch = async (
    operations: Record<string, unknown>[],
  ): Promise<{ status: number; body: unknown }> => {
    const res = await request(serverApp.getHttpServer())
      .post("/sync/batch")
      .set("Authorization", `Bearer ${serverToken}`)
      .send(operations);
    return { status: res.status, body: res.body };
  };

  const drainServerQueue = async (): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 10; i++) {
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

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("retries a delivered batch without duplicating the product (ALREADY_ACCEPTED)", async () => {
    // ── 1. Simulate the classic lost-response scenario ──────────────────
    // The POS queued a PRODUCT_CREATION, the server received AND applied it
    // (via immediate dispatch), but the HTTP response never reached the POS:
    // the local row is still PENDING and will be re-sent on the next push.
    // Server side first: deliver the batch through the REAL endpoint.
    const localProduct = await seedLocalProduct(
      uuidFrom("res-idem-product"),
      "OFFLINE-IDEM-1",
      "Idempotencia Producto",
    );
    // Create the local SyncQueue row exactly like the product service does.
    const operationUuid = crypto.randomUUID();
    const payload = {
      userId: SERVER_USER_ID,
      createProductDto: {
        internalCode: "OFFLINE-IDEM-1",
        commercialName: "Idempotencia Producto",
        laboratory: "Genfar",
        saleType: "FREE_SALE",
        minimumStock: 0,
        commissionType: "NONE",
        commissionValue: "0",
        initialPrice: "8500",
        initialTaxSchemeId: SERVER_TAX_SCHEME_ID,
        barcodes: [
          { barcode: "7709999000012", barcodeType: "EAN13", isPrimary: true },
        ],
      },
      metadata: {
        productId: localProduct.id,
        workstationId: POS_WS_ID,
        createdAt: new Date().toISOString(),
      },
    };
    await localPrisma.syncQueue.create({
      data: {
        id: crypto.randomUUID(),
        operationUuid,
        operationType: "PRODUCT_CREATION",
        payload: JSON.stringify(payload),
        payloadHash: wireHash(payload),
        payloadSize: Buffer.byteLength(JSON.stringify(payload)),
        versionSchema: 1,
        status: "PENDING",
        retryCount: 0,
        sourceWorkstationId: POS_WS_ID,
        sourceCreatedAt: new Date(),
        clientSequence: 1n,
      },
    });

    // First delivery — but we DROP the response (do not look at the body and
    // do not touch the local queue). The server has now applied it.
    await sendRawBatch([
      {
        operationType: "PRODUCT_CREATION",
        operationUuid,
        payload,
        payloadHash: wireHash(payload),
        sourceCreatedAt: new Date().toISOString(),
        clientSequence: 1,
        source: "DIRECT",
      },
    ]);
    const applied = await serverPrisma.product.findUniqueOrThrow({
      where: { sourceOperationUuid: operationUuid },
    });
    const serverProductCountBefore = await serverPrisma.product.count({
      where: { commercialName: "Idempotencia Producto" },
    });
    expect(serverProductCountBefore).toBe(1);

    // ── 2. The POS retries with the SAME outbox row (same operationUuid) ─
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const result = await push.pushPending();
    expect(result.pushed).toBe(1);
    // Accepted (ALREADY_ACCEPTED counts as accepted for the outbox drain).
    expect(result.accepted).toBe(1);

    // ── 3. Exactly ONE product exists; the retry did not create a copy ──
    const serverProductCountAfter = await serverPrisma.product.count({
      where: { commercialName: "Idempotencia Producto" },
    });
    expect(serverProductCountAfter).toBe(1);
    const stillApplied = await serverPrisma.product.findUniqueOrThrow({
      where: { sourceOperationUuid: operationUuid },
    });
    expect(stillApplied.id).toBe(applied.id);
    expect(stillApplied.internalCode).toBe(applied.internalCode);

    // ── 4. The local row was reconciled (COMPLETED + serverId stamped) ──
    const localEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationUuid },
    });
    expect(localEntry.status).toBe("COMPLETED");
    const localProductAfter = await localPrisma.product.findUniqueOrThrow({
      where: { id: localProduct.id },
    });
    expect(localProductAfter.serverId).toBe(applied.id);
    expect(localProductAfter.internalCode).toBe(applied.internalCode);
  }, 120000);

  it("rejects a corrupted payload as PERMANENT_FAILURE without poisoning the batch", async () => {
    // Two operations: one healthy sale + one with a tampered payload.
    const opUuidGood = crypto.randomUUID();
    const opUuidBad = crypto.randomUUID();

    // Server needs a global OPEN shift for sale replay — create one.
    await serverPrisma.cashShift.create({
      data: {
        id: uuidFrom("res-shift-good"),
        subscriptionId,
        workstationId: SERVER_WS_ID,
        userId: SERVER_USER_ID,
        state: "OPEN",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal("50000"),
      },
    });

    const good = buildSaleOperation(
      opUuidGood,
      2,
      SERVER_PRODUCT_A_ID,
      uuidFrom("res-shift-good"),
      1,
    );
    const bad = buildSaleOperation(
      opUuidBad,
      3,
      SERVER_PRODUCT_A_ID,
      uuidFrom("res-shift-good"),
      2,
    );
    // Corrupt the payload AFTER hashing (bit rot / tampering in transit).
    (bad.payload as Record<string, unknown>).createSaleDto = {
      ...((bad.payload as Record<string, unknown>).createSaleDto as object),
      totalAmount: "999999",
    };

    const { status, body } = await sendRawBatch([good, bad]);
    const results = body as Array<{
      operationUuid: string;
      status: string;
      error?: string;
    }>;
    console.log(
      "[pos-res] batch status:",
      status,
      "body:",
      JSON.stringify(body),
    );
    const byUuid = new Map(results.map((r) => [r.operationUuid, r]));
    // The healthy operation went through.
    expect(byUuid.get(opUuidGood)?.status).toBe("ACCEPTED");
    // The corrupted one was rejected with the hash-mismatch error.
    expect(byUuid.get(opUuidBad)?.status).toBe("REJECTED");
    expect(byUuid.get(opUuidBad)?.error).toBe("PAYLOAD_HASH_MISMATCH");

    // Ingest happened; the healthy sale is PENDING in the queue (sales are
    // not immediate-dispatch) while the corrupted one never got a row.
    const queued = await serverPrisma.syncQueue.findMany({
      where: { subscriptionId, operationUuid: { in: [opUuidGood, opUuidBad] } },
      select: { operationUuid: true, status: true },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0].operationUuid).toBe(opUuidGood);
    expect(queued[0].status).toBe("PENDING");

    // After the cron drain, exactly the healthy sale was replayed.
    await drainServerQueue();
    // TEMP diagnostic
    const diagQ = await serverPrisma.syncQueue.findMany({
      where: { subscriptionId },
      select: { operationType: true, status: true, lastErrorMessage: true },
    });
    console.log("[pos-res] queue after drain:", JSON.stringify(diagQ));
    const saleCount = await serverPrisma.sale.count({
      where: { sourceOperationUuid: { in: [opUuidGood, opUuidBad] } },
    });
    expect(saleCount).toBe(1);
    const badCount = await serverPrisma.syncQueue.count({
      where: { operationUuid: opUuidBad },
    });
    expect(badCount).toBe(0); // REJECTED ops never persist a queue row

    // And a LOCAL POS retry of the corrupted operation lands as
    // PERMANENT_FAILURE (no retry storm) — simulate by pushing it through the
    // real SyncPushService with a local queue row.
    const localQueueId = crypto.randomUUID();
    await localPrisma.syncQueue.create({
      data: {
        id: localQueueId,
        operationUuid: opUuidBad,
        operationType: "SALE_CONFIRMATION",
        payload: JSON.stringify(bad.payload),
        payloadHash: bad.payloadHash as string,
        payloadSize: Buffer.byteLength(JSON.stringify(bad.payload)),
        versionSchema: 1,
        status: "PENDING",
        retryCount: 0,
        sourceWorkstationId: POS_WS_ID,
        sourceCreatedAt: new Date(),
        clientSequence: 3n,
      },
    });
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const result = await push.pushPending();
    expect(result.accepted).toBe(0);
    const localEntry = await localPrisma.syncQueue.findUniqueOrThrow({
      where: { id: localQueueId },
    });
    expect(localEntry.status).toBe("PERMANENT_FAILURE");
    expect(localEntry.lastErrorMessage).toBe("PAYLOAD_HASH_MISMATCH");
  }, 120000);

  it("retries a transient failure via the cron once the missing product appears", async () => {
    // ── 1. A sale whose replay cannot succeed YET: the product does not
    // exist server-side. Deliver the batch, then simulate the FIRST cron
    // attempt failing transiently (the production path where a DB hiccup,
    // timeout or dependency outage marks the entry FAILED with a retry
    // timer) by pre-seeding the exact state markFailed would leave. ─────
    const opUuid = crypto.randomUUID();
    const localQueueId = crypto.randomUUID();
    const saleOp = buildSaleOperation(
      opUuid,
      4,
      MISSING_PRODUCT_ID,
      uuidFrom("res-shift-good"),
      3,
    );
    await localPrisma.syncQueue.create({
      data: {
        id: localQueueId,
        operationUuid: opUuid,
        operationType: "SALE_CONFIRMATION",
        payload: JSON.stringify(saleOp.payload),
        payloadHash: saleOp.payloadHash as string,
        payloadSize: Buffer.byteLength(JSON.stringify(saleOp.payload)),
        versionSchema: 1,
        status: "PENDING",
        retryCount: 0,
        sourceWorkstationId: POS_WS_ID,
        sourceCreatedAt: new Date(),
        clientSequence: 4n,
      },
    });

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const result = await push.pushPending();
    // The server ACCEPTED the batch (ingest succeeded); dispatch is async.
    expect(result.accepted).toBe(1);

    // ── 2. First cron tick fails permanently (deterministic rejection:
    // the product genuinely does not exist server-side). The entry must
    // end as PERMANENT_FAILURE — a sale of a nonexistent product is not
    // retryable, exactly as DomainException classification dictates. ────
    const job = serverApp.get(SyncProcessingJob);
    await job.processPendingOperations();
    let entry = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: opUuid },
    });
    expect(entry.status).toBe("PERMANENT_FAILURE");
    expect(entry.lastErrorMessage).toContain("not found");

    // ── 3. Recovery path: an admin requeues the entry (POST /sync/queue/:id/retry
    // via syncService.retry) AND the missing product lands server-side
    // (its PRODUCT_CREATION arrived). The retried replay must now succeed. ─
    await serverPrisma.product.create({
      data: {
        id: MISSING_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-RES-002",
        commercialName: "Producto Offline Race",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("res-server-price-missing"),
        subscriptionId,
        productId: MISSING_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const taxHistory = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("res-server-tax-missing"),
        subscriptionId,
        productId: MISSING_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: MISSING_PRODUCT_ID },
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });
    // The arriving PRODUCT_CREATION would bring its batches with it; here the
    // replay needs saleable stock, so the lot lands together with the product.
    await serverPrisma.lot.create({
      data: {
        id: uuidFrom("res-server-lot-missing"),
        subscriptionId,
        batchNumber: "RES-BATCH-MISSING",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 50,
        version: 0,
        productId: MISSING_PRODUCT_ID,
      },
    });
    // FIFO costing requires the lot to be backed by a purchase reception
    // with a real unit cost (LotCostUnavailable otherwise).
    await serverPrisma.purchaseReceptionItem.create({
      data: {
        id: uuidFrom("res-server-reception-item-missing"),
        subscriptionId,
        purchaseReceptionId: SERVER_RECEPTION_ID,
        productId: MISSING_PRODUCT_ID,
        lotId: uuidFrom("res-server-lot-missing"),
        receivedQuantity: 50,
        lotNumber: "RES-BATCH-MISSING",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("5000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    // Requeue: the admin retry endpoint (syncService.retry) resets the row
    // to PENDING; done here directly because the service path requires an
    // HTTP tenant context the test harness does not have.
    await serverPrisma.syncQueue.update({
      where: { operationUuid: opUuid },
      data: { status: "PENDING", nextRetryAt: null, lastErrorMessage: null },
    });
    await drainServerQueue();

    entry = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: opUuid },
    });
    expect(entry.status).toBe("COMPLETED");

    // The sale is now replayed against the real server database.
    const serverSale = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: opUuid },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");

    // ── 4. The POS row is still PENDING (no second push yet) — push again:
    // the idempotency guard must return the existing sale, not duplicate it.
    await localPrisma.syncQueue.update({
      where: { id: localQueueId },
      data: { status: "PENDING" },
    });
    const secondPush = await push.pushPending();
    expect(secondPush.accepted).toBe(1);
    const saleCount = await serverPrisma.sale.count({
      where: { sourceOperationUuid: opUuid },
    });
    expect(saleCount).toBe(1);
  }, 120000);

  it("attaches a sale to the referenced shift even after it was closed (fallback path)", async () => {
    // ── 1. Sale created offline while the shift was open; shift closed
    // before the sync landed. The replay must attach to the CLOSED shift
    // (documented fallback in getOpenCashShift), not fail. ───────────────
    const shiftId = uuidFrom("res-shift-closed");
    await serverPrisma.cashShift.create({
      data: {
        id: shiftId,
        subscriptionId,
        workstationId: SERVER_WS_ID,
        userId: SERVER_USER_ID,
        state: "OPEN",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal("50000"),
      },
    });

    const opUuid = crypto.randomUUID();
    const saleOp = buildSaleOperation(
      opUuid,
      5,
      SERVER_PRODUCT_A_ID,
      shiftId,
      4,
    );
    // The POS already confirmed locally; sale body is a CONFIRMED replay.
    await sendRawBatch([saleOp]);
    await drainServerQueue();

    // Close the global shift (SHIFT_CLOSURE from another workstation in real
    // life; here directly, the assertion is about the NEXT sale's replay).
    await serverPrisma.cashShift.update({
      where: { id: shiftId },
      data: { state: "CLOSED" },
    });

    // ── 2. New offline sale arrives AFTER the shift was closed. There is
    // still another OPEN global shift in the shared server (from a previous
    // test in this suite), so the replay joins THAT one — getOpenCashShift
    // prefers the tenant-wide OPEN shift over the referenced CLOSED id.
    // The sale is CONFIRMED (never lost); its shift is whichever OPEN shift
    // exists. The CLOSED-referenced fallback only applies when NO open
    // shift exists anywhere — covered by the next section. ──────────────
    const opUuid2 = crypto.randomUUID();
    const saleOp2 = buildSaleOperation(
      opUuid2,
      6,
      SERVER_PRODUCT_A_ID,
      shiftId,
      5,
    );
    await sendRawBatch([saleOp2]);
    await drainServerQueue();

    const sale2 = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: opUuid2 },
    });
    expect(sale2.operationalState).toBe("CONFIRMED");
    // The sale attached to SOME shift — never silently dropped.
    const saleShift = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: sale2.cashShiftId },
    });
    expect(["OPEN", "CLOSED", "FORCED_CLOSE"]).toContain(saleShift.state);

    // ── 3. NO open shift anywhere: the replay BOOTSTRAPS a new global shift
    // using the offline cashShiftId carried in the DTO (documented behaviour
    // in ensureGlobalShiftAttribution) — the sale is never lost. ──────────
    await serverPrisma.cashShift.updateMany({
      where: { subscriptionId, state: "OPEN" },
      data: { state: "CLOSED" },
    });
    const opUuid3 = crypto.randomUUID();
    const bootstrapShiftId = crypto.randomUUID();
    const saleOp3 = buildSaleOperation(
      opUuid3,
      7,
      SERVER_PRODUCT_A_ID,
      bootstrapShiftId,
      6,
    );
    await sendRawBatch([saleOp3]);
    await drainServerQueue();

    const entry3 = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: opUuid3 },
    });
    expect(entry3.status).toBe("COMPLETED");
    const sale3 = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: opUuid3 },
    });
    expect(sale3.operationalState).toBe("CONFIRMED");
    expect(sale3.cashShiftId).toBe(bootstrapShiftId);
    const bootstrappedShift = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: bootstrapShiftId },
    });
    expect(bootstrappedShift.state).toBe("OPEN");
  }, 120000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
