/**
 * POS ↔ Server real integration test.
 *
 * This is NOT a mock-level test: both sides run their real code.
 *
 * POS side (client of the sync contract):
 *   - Real PGlite in memory with the real local schema (LOCAL_SCHEMA_SQL).
 *   - Real PrismaClient (@pharmacy/database/local) over the
 *     pglite-prisma-adapter — the same stack as the shipped app.
 *   - Real SalesPosService (create + confirm sale), which writes the local
 *     Sale/SaleItem rows and enqueues the SALE_CONFIRMATION SyncQueue row
 *     with the exact production payload shape.
 *   - Real SyncPushService, which reads the local outbox and POSTs it to
 *     the server over real HTTP.
 *
 * Server side:
 *   - Real NestJS application (AppModule) listening on a real port, against
 *     the real Postgres test database (migrated, RLS on, app role), the same
 *     environment the e2e suite uses.
 *
 * The two sides share no code paths for the data exchange: the only bridge
 * is the HTTP wire contract. If either side drifts (payload shape, hash
 * algorithm, auth headers, RLS policy), this test fails.
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
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema"; // The workspace hoists the server's dependencies into .pnpm/node_modules;
// vitest resolves these paths relative to this file.
const SERVER_MODULES = "../../../../../node_modules/.pnpm/node_modules";
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
// Server side (real AppModule)
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
} from "../../../../../node_modules/.pnpm/node_modules/@nestjs/common";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
// The raw @prisma/client in the pnpm store needs a resolution path that only
// jest's e2e config provides. Use the same prebuilt CJS bundle of
// packages/database (with the full generated client) the server e2e suite
// uses — same real Prisma client, loadable from anywhere.
import { createRequire } from "node:module";
const serverRequire = createRequire(import.meta.url);
const { PrismaClient: ServerPrismaClient } = serverRequire(
  "../../../../server/test/generated/database-cjs/database.cjs",
) as {
  PrismaClient: new (args: Record<string, unknown>) => ServerPrismaClientType;
};
type ServerPrismaClientType = import("@pharmacy/database").PrismaClient;
// The pg driver adapter loads standalone from the hoisted pnpm store.
const { PrismaPg } = serverRequire(
  "../../../../../node_modules/.pnpm/node_modules/@prisma/adapter-pg",
) as { PrismaPg: new (args: Record<string, unknown>) => unknown };
import * as crypto from "node:crypto";

// Server env must be set BEFORE the AppModule (and its ConfigModule) loads.
// Mirrors apps/server/test/set-env.ts: DATABASE_URL is the owner role used for
// seeding; APP_DATABASE_URL is what the Nest app connects with (RLS applies).
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

// Dynamic import: AppModule (and everything it pulls in) must evaluate AFTER
// setServerEnv() has run.
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

const SERVER_WS_ID = uuidFrom("pos-int-sale-server-ws");
const SERVER_USER_ID = "pos-int-sale-server-user-id";
const USERNAME = "pos-integration@pos.test";
const PASSWORD = "PosIntegration123!";
const SERVER_PRODUCT_ID = uuidFrom("pos-int-server-product");
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-server-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-server-pm-cash");
const SERVER_LOT_ID = uuidFrom("pos-int-server-lot");
// The lot must carry a real acquisition cost or the server-side sale replay
// rejects it (LotCostUnavailableException): the cost is resolved through the
// PurchaseReceptionItem that received the lot.
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-server-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-server-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-server-reception-item");
const LOT_UNIT_COST = new Prisma.Decimal("8000");
// Every sale produces a DIAN INVOICE, which consumes a consecutive from the
// workstation's active FiscalResolutionAllocation — seed a real one.
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-server-fiscal-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-server-fiscal-allocation");

// The POS's local product row uses its own UUID; its `serverId` column is
// null until PRODUCT_CREATION sync completes. This test uses a product that
// already exists on the server (pulled during a normal sync), so the local
// id IS the server id — the common case for an established pharmacy.
const PRODUCT_ID = SERVER_PRODUCT_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;
const POS_WS_ID = "pos-int-ws-0001";
const POS_USER_ID = SERVER_USER_ID;

const UNIT_PRICE = 15000;
const SALE_QTY = 2;
const EXPECTED_TOTAL = 35700; // 2 × 15000 × 1.19

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration (real PGlite + real NestJS server)", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let salesPos: SalesPosService;

  beforeAll(async () => {
    // =====================================================================
    // 1. SERVER — real NestJS app on a real port, real Postgres
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-sale");

    // ── Seed the server-side world (workstation, user, catalog, fiscal) ──
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.saleItemLot.deleteMany({
      where: { lotId: SERVER_LOT_ID },
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
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId, resolutionId: SERVER_RESOLUTION_ID },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { id: SERVER_RESOLUTION_ID },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productCostHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.productBarcode.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.product.deleteMany({ where: { id: SERVER_PRODUCT_ID } });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    // AuditLog also references the workstation (device events).
    await serverPrisma.auditLog.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Integration Workstation",
        code: "WS-POS-INT-001",
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
        role: "ADMIN", // ADMIN so the POS session may open the shift
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

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-INT-001",
        commercialName: "POS Integration Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-server-price-hist"),
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
        id: uuidFrom("pos-int-server-tax-hist"),
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
        batchNumber: "POS-INT-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 50,
        version: 0,
        productId: SERVER_PRODUCT_ID,
      },
    });

    // The lot exists because a real purchase received it — that reception
    // item is where the server looks up the lot's unit cost at sale time.
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-1",
        businessName: "POS Integration Supplier",
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
        lotNumber: "POS-INT-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: LOT_UNIT_COST,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    // DIAN authorization: an INVOICE resolution with a consecutive range
    // allocated to this workstation, as a real deployment would configure.
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000123456",
        documentType: "INVOICE",
        prefix: "POS-INT",
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

    // Login through real HTTP to obtain the token the POS would hold.
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

    // Seed the local mirror the way a real sync cycle would have left it:
    // product with price/tax, payment method, catalog version.
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
    await localPrisma.product.create({
      data: {
        id: PRODUCT_ID,
        internalCode: "POS-INT-001",
        commercialName: "POS Integration Product",
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
        id: uuidFrom("pos-int-local-price-hist"),
        productId: PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: POS_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.taxScheme.create({
      data: {
        id: uuidFrom("pos-int-local-tax-scheme"),
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
        id: uuidFrom("pos-int-local-tax-hist"),
        productId: PRODUCT_ID,
        taxSchemeId: uuidFrom("pos-int-local-tax-scheme"),
        effectiveFrom: now,
        changedById: POS_USER_ID,
        changedAt: now,
      },
    });
    // Local stock: an ACTIVE lot with enough current stock for the sale.
    await localPrisma.lot.create({
      data: {
        id: uuidFrom("pos-int-local-lot"),
        batchNumber: "POS-INT-LOT-1",
        expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
        entryDate: now,
        state: "ACTIVE",
        currentStock: 100,
        productId: PRODUCT_ID,
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

    // The session the POS holds after login (the real login flow persists
    // exactly this shape into the local session store).
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

    salesPos = createSalesPosService(
      localPrisma,
      { requireRole: () => useLocalSessionStore.getState().session! } as any,
      createInventoryLotsService(localPrisma),
    );
  }, 120000);

  afterAll(async () => {
    // POS side
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();

    // Server side (children before parents)
    if (serverPrisma) {
      await serverPrisma.syncOperationOutcome.deleteMany({
        where: { subscriptionId },
      });
      await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
      await serverPrisma.saleItemLot.deleteMany({
        where: { lotId: SERVER_LOT_ID },
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
      await serverPrisma.fiscalDocument.deleteMany({
        where: {
          subscriptionId: subscriptionId!,
          resolutionId: SERVER_RESOLUTION_ID,
        },
      });
      await serverPrisma.fiscalResolutionAllocation.deleteMany({
        where: { workstationId: SERVER_WS_ID },
      });
      await serverPrisma.fiscalResolution.deleteMany({
        where: { id: SERVER_RESOLUTION_ID },
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
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  it("carries a POS sale from local PGlite to the server database over real HTTP", async () => {
    const step = (msg: string): void =>
      console.log(`[pos-int] ${new Date().toISOString()} ${msg}`);
    // ── Step 1: POS opens its local shift (admin role session) ─────────
    step("step 1: opening local shift");
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    const localShift = await cashShift.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    expect(localShift.state).toBe("OPEN");

    // ── Step 2: POS creates the sale locally (real code path) ──────────
    // NOTE: SalesPosService.create acquires dbWriteLock internally — the lock
    // is not reentrant, so the test must NOT hold it around service calls.
    step("step 2: creating sale");
    const sale = (await salesPos.create({
      items: [{ productId: PRODUCT_ID, quantity: SALE_QTY }],
    })) as { id: string; localNumber: bigint; totalAmount: Prisma.Decimal };
    const saleId = sale.id;
    expect(Number(sale.totalAmount)).toBe(EXPECTED_TOTAL);

    // ── Step 3: POS confirms the sale (real code path) ─────────────────
    // Confirm consumes local stock, records the payment, and enqueues the
    // SALE_CONFIRMATION SyncQueue row in the same transaction.
    step("step 3: confirming sale");
    await salesPos.confirm(saleId, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: EXPECTED_TOTAL }],
    });

    // Local side must now hold the outbox entry.
    const localQueue = await localPrisma.syncQueue.findFirst({
      where: { operationType: "SALE_CONFIRMATION", status: "PENDING" },
    });
    expect(localQueue).toBeTruthy();
    const localSale = await localPrisma.sale.findUniqueOrThrow({
      where: { id: saleId },
    });
    expect(localSale.operationalState).toBe("CONFIRMED");

    // Server must NOT have the sale yet (nothing pushed).
    const serverSalesBefore = await serverPrisma.sale.count({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    expect(serverSalesBefore).toBe(0);

    // ── Step 4: The push runs (real SyncPushService over real HTTP) ────
    step("step 4: pushing outbox");
    // The local shift-open also queued a SHIFT_OPEN operation with sequence 1;
    // the sale is sequence 2. Both must be delivered in dependency order.
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const pushResult = await push.pushPending();
    expect(pushResult.pushed).toBe(2);
    expect(pushResult.accepted).toBe(2);

    // SHIFT_OPEN is immediately dispatched server-side; the sale replay is
    // queued and applied by the cron. Tick it like the real deployment does.
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 5; i++) {
      await job.processPendingOperations();
      const done = await serverPrisma.syncQueue.findFirst({
        where: {
          operationType: "SALE_CONFIRMATION",
          sourceWorkstationId: SERVER_WS_ID,
        },
        select: { status: true, lastErrorMessage: true },
      });
      if (done?.status === "COMPLETED") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // ── Step 5: Verify the server database state ────────────────────────
    step("step 5: verifying server state");
    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_ID },
      include: { items: { include: { lots: true } }, payments: true },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    expect(serverSale.workstationId).toBe(SERVER_WS_ID);
    expect(Number(serverSale.totalAmount)).toBe(EXPECTED_TOTAL);
    // The server preserved the POS-local sale numbering.
    expect(Number(serverSale.localNumber)).toBe(1);
    expect(serverSale.items).toHaveLength(1);
    expect(serverSale.items[0].productId).toBe(SERVER_PRODUCT_ID);
    expect(serverSale.items[0].lots).toHaveLength(1);

    // Stock consumed on the server lot: 50 − 2.
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(48);

    // The shift opened locally arrived at the server with the SAME id.
    const serverShift = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: localShift.id },
    });
    expect(serverShift.state).toBe("OPEN");
    expect(serverShift.workstationId).toBe(SERVER_WS_ID);

    // The server generated the DIAN INVOICE for the replayed sale, consuming
    // a consecutive from the workstation's allocation (POS-INT-1).
    const invoice = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: { saleId: serverSale.id, documentType: "INVOICE" },
    });
    expect(invoice.fullNumber).toBe("POS-INT1");
    expect(invoice.resolutionId).toBe(SERVER_RESOLUTION_ID);
    expect(invoice.allocationId).toBe(SERVER_ALLOCATION_ID);
    const allocation =
      await serverPrisma.fiscalResolutionAllocation.findUniqueOrThrow({
        where: { id: SERVER_ALLOCATION_ID },
      });
    expect(allocation.currentConsecutive).toBe(1);

    // ── Step 6: Local rows were marked COMPLETED by the push ────────────
    const localQueueAfter = await localPrisma.syncQueue.findMany({
      where: { operationType: { in: ["SALE_CONFIRMATION", "SHIFT_OPEN"] } },
      select: { status: true },
    });
    expect(localQueueAfter.map((r) => r.status).sort()).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);
  }, 120000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
