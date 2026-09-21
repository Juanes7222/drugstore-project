/**
 * POS ↔ Server integration — CLIENT_RETURN end-to-end over the sync.
 *
 * Real-code harness (same as the other integration specs): real PGlite POS,
 * real NestJS AppModule, real HTTP, real cron.
 *
 * The flow under test (every step is production code, no synthetic payloads):
 *
 *   1. POS opens a local shift (global shift model) and confirms a sale →
 *      the local outbox holds SHIFT_OPEN + SALE_CONFIRMATION.
 *   2. The push delivers the batch over real HTTP; the cron replays the
 *      sale server-side (stock consumed, invoice created, local ids
 *      adopted for the sale items).
 *   3. The external fiscal engine would later VALIDATE the invoice — the
 *      test applies the same state transition the engine applies so the
 *      credit-note precondition holds.
 *   4. The POS registers a client return against the local sale (real
 *      ReturnsService: create + confirm, stock reversed locally) → the
 *      outbox holds a CLIENT_RETURN operation whose items reference the
 *      LOCAL saleItemId/lotId.
 *   5. Push + cron replay the return server-side. The dispatcher must
 *      resolve the local sale id (and item ids) against the server sale —
 *      this is the regression the spec pins: a naive replay that trusts
 *      the payload ids verbatim fails with SaleNotFoundException because
 *      the server sale replay generates its own ids.
 *
 * Server-side verification after the return replay:
 *   - ClientReturn row exists with the LOCAL return id (idempotency key),
 *     state CONFIRMED, tied to the SERVER sale id.
 *   - Return items reference the SERVER saleItem ids.
 *   - The lot stock was credited back server-side.
 *   - A CREDIT_NOTE fiscal document was created referencing the invoice.
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
// The workspace hoists the server's dependencies into .pnpm/node_modules;
// vitest resolves these paths relative to this file.
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

// POS side (real domain code)
import {
  SalesPosService,
  createSalesPosService,
} from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import { ReturnsService } from "../returns/returns.service";
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

const SERVER_WS_ID = uuidFrom("pos-int-return-server-ws");
const SERVER_USER_ID = "pos-int-return-server-user-id";
const USERNAME = "pos-integration-return@pos.test";
const PASSWORD = "PosIntegration123!";
const SERVER_PRODUCT_ID = uuidFrom("pos-int-return-server-product");
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-return-server-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-return-server-pm-cash");
const SERVER_LOT_ID = uuidFrom("pos-int-return-server-lot");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-return-server-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-return-server-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom(
  "pos-int-return-server-reception-item",
);
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-return-server-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-return-server-allocation");
// Credit notes consume their own documentType resolution (DIAN separates
// INVOICE and CREDIT_NOTE numbering).
const SERVER_CN_RESOLUTION_ID = uuidFrom("pos-int-return-server-cn-resolution");
const SERVER_CN_ALLOCATION_ID = uuidFrom("pos-int-return-server-cn-allocation");

const PRODUCT_ID = SERVER_PRODUCT_ID; // established catalog: local id == server id
const PM_CASH_ID = SERVER_PM_CASH_ID;
const POS_WS_ID = "pos-int-return-ws-0001";
const POS_USER_ID = SERVER_USER_ID;

const UNIT_PRICE = 15000;
const SALE_QTY = 2;
const RETURN_QTY = 1;
const SALE_TOTAL = 35700; // 2 × 15000 × 1.19
// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — CLIENT_RETURN over the sync", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let salesPos: SalesPosService;

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.clientReturnItemLot.deleteMany({
      where: { clientReturnItem: { clientReturn: { subscriptionId } } },
    });
    await serverPrisma.clientReturnItem.deleteMany({
      where: { clientReturn: { subscriptionId } },
    });
    await serverPrisma.clientReturn.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
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
    await serverPrisma.shiftCashCount.deleteMany({
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
    await serverPrisma.supplier.deleteMany({ where: { id: SERVER_SUPPLIER_ID } });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: {
        id: { in: [SERVER_RESOLUTION_ID, SERVER_CN_RESOLUTION_ID] },
      },
    });
    await serverPrisma.productCostHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productBarcode.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.product.deleteMany({
      where: { id: SERVER_PRODUCT_ID },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    await serverPrisma.clientReturnItemLot.deleteMany({
      where: { clientReturnItem: { clientReturn: { subscriptionId } } },
    });
    await serverPrisma.clientReturnItem.deleteMany({
      where: { clientReturn: { subscriptionId } },
    });
    await serverPrisma.clientReturn.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.client.deleteMany({
      where: { id: "00000000-0000-0000-0000-000000000001" },
    });
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

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-return");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Return Integration Workstation",
        code: "WS-POS-RET-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Return Integration Cashier",
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
        code: "POS-RET-IVA19",
        name: "POS Return Integration IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-RET-001",
        commercialName: "POS Return Integration Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-return-server-price-hist"),
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const taxHistory = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-return-server-tax-hist"),
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
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });

    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "POS-RET-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 50,
        version: 0,
        productId: SERVER_PRODUCT_ID,
      },
    });

    // FIFO costing needs a real purchase reception behind the lot.
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-9",
        businessName: "POS Return Integration Supplier",
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
        receivedQuantity: 50,
        lotNumber: "POS-RET-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("8000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    // DIAN invoice numbering (INVOICE + CREDIT_NOTE documents share the
    // workstation allocation namespace per documentType — one resolution
    // per type, both seeded as a real deployment would).
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000999888",
        documentType: "INVOICE",
        prefix: "POS-RET",
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
    // Credit-note numbering for the same workstation.
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_CN_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000999889",
        documentType: "CREDIT_NOTE",
        prefix: "POS-RET-NC",
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
        id: SERVER_CN_ALLOCATION_ID,
        subscriptionId,
        resolutionId: SERVER_CN_RESOLUTION_ID,
        workstationId: SERVER_WS_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date("2026-01-01"),
        allocatedByUserId: SERVER_USER_ID,
      },
    });

    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-RET-CASH",
        name: "POS Return Integration Cash",
        category: "CASH",
        isCash: true,
      },
    });

    // The generic (consumidor final) client exists on both sides in a real
    // deployment — the sale replay resolves it server-side, and the return
    // copies the sale's clientId (NOT NULL on the server).
    await serverPrisma.client.create({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "222222222222",
        fullName: "Cliente Genérico",
        isActive: true,
        createdById: SERVER_USER_ID,
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
        createdById: POS_USER_ID,
      },
    });
    await localPrisma.product.create({
      data: {
        id: PRODUCT_ID,
        internalCode: "POS-RET-001",
        commercialName: "POS Return Integration Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: POS_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });
    await localPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-return-local-price-hist"),
        productId: PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: POS_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.taxScheme.create({
      data: {
        id: uuidFrom("pos-int-return-local-tax-scheme"),
        code: "IVA-19",
        name: "IVA 19",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: POS_USER_ID,
      },
    });
    await localPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("pos-int-return-local-tax-hist"),
        productId: PRODUCT_ID,
        taxSchemeId: uuidFrom("pos-int-return-local-tax-scheme"),
        effectiveFrom: now,
        changedById: POS_USER_ID,
        changedAt: now,
      },
    });
    // Local lot mirrors the server lot with the SAME id (the pull leaves
    // identical ids on both sides — that identity is what the return's
    // lot assignments rely on).
    await localPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        batchNumber: "POS-RET-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: now,
        state: "ACTIVE",
        currentStock: 50,
        productId: PRODUCT_ID,
      },
    });
    await localPrisma.paymentMethod.create({
      data: {
        id: PM_CASH_ID,
        internalCode: "POS-RET-CASH",
        name: "POS Return Integration Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    useLocalSessionStore.getState().setSession({
      userId: POS_USER_ID,
      username: USERNAME,
      fullName: "POS Return Integration Cashier",
      displayName: "POS Return Integration Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-ret",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-ret-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    salesPos = createSalesPosService(
      localPrisma,
      { requireRole: () => useLocalSessionStore.getState().session! } as any,
      createInventoryLotsService(localPrisma),
    );
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

  it("carries a POS client return from local PGlite to the server database", async () => {
    // ── Step 1: POS opens its local shift and confirms a sale ──────────
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    const localShift = await cashShift.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });

    const sale = (await salesPos.create({
      items: [{ productId: PRODUCT_ID, quantity: SALE_QTY }],
    })) as { id: string; localNumber: bigint };
    const saleId = sale.id;

    await salesPos.confirm(saleId, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: SALE_TOTAL }],
    });

    const localSale = await localPrisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { items: true },
    });
    expect(localSale.operationalState).toBe("CONFIRMED");
    expect(localSale.items).toHaveLength(1);
    const localSaleItemId = localSale.items[0]!.id;

    // ── Step 2: Push + cron → the sale is replayed server-side ─────────
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const salePush = await push.pushPending();
    expect(salePush.pushed).toBe(2); // SHIFT_OPEN + SALE_CONFIRMATION
    expect(salePush.accepted).toBe(2);

    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 8; i++) {
      await job.processPendingOperations();
      const done = await serverPrisma.syncQueue.findFirst({
        where: { operationType: "SALE_CONFIRMATION", subscriptionId },
        select: { status: true, lastErrorMessage: true },
      });
      if (done?.status === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_ID },
      include: { items: true },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    const serverSaleItemId = serverSale.items[0]!.id;
    // The server replay adopted the LOCAL sale item id (regression pin for
    // the return remap — without it the return items can never resolve).
    expect(serverSaleItemId).toBe(localSaleItemId);

    // The sale invoice exists but is PENDING_GENERATION until the external
    // fiscal engine transmits and validates it. Simulate that engine's
    // state transition (the exact write the engine applies on DIAN
    // acceptance) so the credit-note precondition holds.
    const invoice = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: { saleId: serverSale.id, documentType: "INVOICE" },
    });
    await serverPrisma.fiscalDocument.update({
      where: { id: invoice.id },
      data: { fiscalState: "VALIDATED", cufeCude: `TEST-CUFE-${invoice.id}` },
    });

    // ── Step 3: POS registers + confirms the return (real code path) ───
    const returns = new ReturnsService(
      localPrisma,
      { requireRole: () => useLocalSessionStore.getState().session! } as any,
    );
    const draft = (await returns.create({
      saleId,
      clientId: localSale.clientId!,
      refundMethodId: PM_CASH_ID,
      reason: "Producto defectuoso",
      items: [{ saleItemId: localSaleItemId, quantity: RETURN_QTY }],
    })) as { id: string; state: string; refundAmount: Prisma.Decimal };
    expect(draft.state).toBe("DRAFT");

    const confirmed = (await returns.confirm(draft.id)) as {
      updatedReturn: { id: string; state: string };
    };
    expect(confirmed.updatedReturn.state).toBe("CONFIRMED");

    // Local stock was reversed by the confirm (50 − 2 + 1 = 49).
    const localLot = await localPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(localLot.currentStock).toBe(50 - SALE_QTY + RETURN_QTY);

    // The local outbox now holds the CLIENT_RETURN operation.
    const returnQueue = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "CLIENT_RETURN" },
    });
    expect(returnQueue.status).toBe("PENDING");

    // ── Step 4: Push + cron → the return is replayed server-side ───────
    const returnPush = await push.pushPending();
    expect(returnPush.pushed).toBe(1);
    expect(returnPush.accepted).toBe(1);

    for (let i = 0; i < 8; i++) {
      await job.processPendingOperations();
      const done = await serverPrisma.syncQueue.findUnique({
        where: { operationUuid: returnQueue.operationUuid },
        select: { status: true, lastErrorMessage: true },
      });
      if (done?.status === "COMPLETED") break;
      if (done?.status === "PERMANENT_FAILURE") {
        throw new Error(
          `CLIENT_RETURN replay failed permanently: ${done.lastErrorMessage}`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const returnEntry = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: returnQueue.operationUuid },
    });
    expect(returnEntry.status).toBe("COMPLETED");

    // ── Step 5: Verify the server database state ────────────────────────
    // The return row exists with the LOCAL id (idempotency key), CONFIRMED.
    const serverReturn = await serverPrisma.clientReturn.findUniqueOrThrow({
      where: { id: draft.id },
      include: { items: { include: { lots: true } } },
    });
    expect(serverReturn.state).toBe("CONFIRMED");
    expect(serverReturn.saleId).toBe(serverSale.id); // server sale id, not local
    expect(serverReturn.workstationId).toBe(SERVER_WS_ID);
    expect(serverReturn.reason).toBe("Producto defectuoso");
    // Items reference the SERVER sale item ids (identical here because the
    // replay adopted the local ids — the remap contract).
    expect(serverReturn.items).toHaveLength(1);
    expect(serverReturn.items[0]!.saleItemId).toBe(serverSaleItemId);
    expect(serverReturn.items[0]!.quantity).toBe(RETURN_QTY);
    // The lot assignment survived the wire and points at the shared lot id.
    expect(serverReturn.items[0]!.lots).toHaveLength(1);
    expect(serverReturn.items[0]!.lots[0]!.lotId).toBe(SERVER_LOT_ID);
    expect(serverReturn.items[0]!.lots[0]!.quantity).toBe(RETURN_QTY);

    // The server credited the stock back: 50 − 2 + 1 = 49.
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(50 - SALE_QTY + RETURN_QTY);

    // A CLIENT_RETURN inventory movement was recorded server-side.
    const movement = await serverPrisma.inventoryMovement.findFirstOrThrow({
      where: { lotId: SERVER_LOT_ID, movementType: "CLIENT_RETURN" },
    });
    expect(movement.quantity).toBe(RETURN_QTY);

    // A CREDIT_NOTE fiscal document was created referencing the invoice.
    const creditNote = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: { clientReturnId: draft.id, documentType: "CREDIT_NOTE" },
    });
    expect(creditNote.referenceDocumentId).toBe(invoice.id);
  }, 120000);
});
