/**
 * POS ↔ Server integration — AUTO dependency requeue (offline ordering gap).
 *
 * The production story this spec exercises: the network dies mid-shift, the
 * cashier keeps selling. When the connection returns the POS pushes its
 * outbox and the operations arrive OUT OF ORDER server-side (the outbox
 * serialises per-workstation, but a batch boundary, a retry storm or a
 * second device can land a SALE_CONFIRMATION before its CLIENT_CREATION /
 * PRODUCT_CREATION / PURCHASE_RECEPTION). The dispatcher correctly marks
 * the sale PERMANENT_FAILURE (a "not found" is non-transient by design) —
 * and SyncDependencyRequeueService is the ONLY thing standing between that
 * row and a silently lost sale.
 *
 * Unlike pos-sync-resilience (where an ADMIN manually requeues and the
 * dependency is hand-inserted server-side), this spec runs the REAL
 * automatic path end to end:
 *
 *   1. Sale pushed referencing a POS-local client uuid that does not exist
 *      server-side → PERMANENT_FAILURE.
 *   2. The CLIENT_CREATION arrives as a REAL pushed operation (POS-local
 *      service → wire → dispatcher). Its handler must call
 *      requeueDependentsOf(localClientId) and flip the dead sale back to
 *      PENDING.
 *   3. The next cron tick replays the sale successfully — no human in the
 *      loop. Sale CONFIRMED in the server DB, stock converged, local
 *      outbox clean after the POS pushes again.
 *
 * A second test covers the lot/product dependency: the sale references a
 * product whose PRODUCT_CREATION (with metadata.productId = local uuid)
 * arrives after the sale. The dispatcher's product handler must revive the
 * sale by product id, and the sale replay must resolve the local product
 * uuid → server product (sourceProductId remap).
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
import { createProductService } from "../catalog/product.service";
import { createPurchaseReceptionsService } from "../purchases/purchase-receptions.service";

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

const SERVER_WS_ID = uuidFrom("pos-int-depreq-server-ws");
const SERVER_USER_ID = "pos-int-depreq-server-user-id";
const USERNAME = "pos-integration-depreq@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-depreq-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-depreq-pm-cash");
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-depreq-fiscal-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-depreq-fiscal-allocation");

// Existing catalog: product A pulled in a previous sync WITH its lot.
const SERVER_PRODUCT_A_ID = uuidFrom("pos-int-depreq-product-a");
const SERVER_LOT_A_ID = uuidFrom("pos-int-depreq-lot-a");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-depreq-supplier");
// The new-product reception references a DIFFERENT supplier: the dispatcher's
// idempotency fallback matches receptions on (sequentialNumber, supplierId)
// and both the seed and the local outbox restart at sequence 1 — a shared
// supplier would make the seeded reception absorb the replayed one and its
// lot would never be materialized.
const SERVER_SUPPLIER_2_ID = uuidFrom("pos-int-depreq-supplier-2");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-depreq-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-depreq-reception-item");

const POS_WS_ID = "pos-int-depreq-ws-0001";
const UNIT_PRICE = 13000;
const SALE_TOTAL = 15470; // 1 × 13000 × 1.19
const LOT_INITIAL_STOCK = 40;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — automatic dependency requeue", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;

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
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId: subscriptionId! },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { subscriptionId },
    });
    // Dependency-requeue products: by name (local ids are dynamic).
    for (const name of [
      "Cliente Deudor Requeue",
      "Producto Requeue Auto",
    ]) {
      await serverPrisma.inventoryMovement.deleteMany({
        where: { lot: { product: { commercialName: name } } },
      });
      await serverPrisma.lot.deleteMany({
        where: { product: { commercialName: name } },
      });
      await serverPrisma.productCostHistory.deleteMany({
        where: { product: { commercialName: name } },
      });
      await serverPrisma.productPriceHistory.deleteMany({
        where: { product: { commercialName: name } },
      });
      await serverPrisma.productTaxHistory.deleteMany({
        where: { product: { commercialName: name } },
      });
      await serverPrisma.productBarcode.deleteMany({
        where: { product: { commercialName: name } },
      });
      await serverPrisma.product.deleteMany({
        where: { commercialName: name },
      });
    }
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: { in: [SERVER_LOT_A_ID] } },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_A_ID } });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { id: SERVER_RECEPTION_ITEM_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { id: SERVER_RECEPTION_ID },
    });
    // Receptions the sync replay created for the DETERMINISTIC suppliers in
    // previous runs (dynamic ids): the dispatcher's idempotency fallback
    // matches on (sequentialNumber, supplierId) and the local sequence
    // restarts at 1 every run — without this cleanup a stale reception
    // absorbs the replay and its lot is never materialized.
    const staleReceptions = await serverPrisma.purchaseReception.findMany({
      where: { supplierId: { in: [SERVER_SUPPLIER_ID, SERVER_SUPPLIER_2_ID] } },
      select: { id: true },
    });
    if (staleReceptions.length > 0) {
      const staleIds = staleReceptions.map((r) => r.id);
      await serverPrisma.inventoryMovement.deleteMany({
        where: { purchaseReceptionId: { in: staleIds } },
      });
      await serverPrisma.purchaseReceptionItem.deleteMany({
        where: { purchaseReceptionId: { in: staleIds } },
      });
      await serverPrisma.purchaseReception.deleteMany({
        where: { id: { in: staleIds } },
      });
    }
    await serverPrisma.supplier.deleteMany({
      where: { id: { in: [SERVER_SUPPLIER_ID, SERVER_SUPPLIER_2_ID] } },
    });
    // The CLIENT_CREATION created a server client (dynamic id) — by name.
    await serverPrisma.sale.updateMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
      data: { clientId: null },
    });
    await serverPrisma.client.deleteMany({
      where: { fullName: "Cliente Requeue Auto" },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_A_ID },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { productId: SERVER_PRODUCT_A_ID },
    });
    await serverPrisma.product.deleteMany({
      where: { id: SERVER_PRODUCT_A_ID },
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

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-depreq");
    await cleanServerRows();

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS DepRequeue Workstation",
        code: "WS-POS-DEPREQ-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS DepRequeue Cashier",
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
        code: "POS-DEPREQ-IVA19",
        name: "POS DepRequeue IVA 19%",
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
        internalCode: "POS-DEPREQ-CASH",
        name: "POS DepRequeue Cash",
        category: "CASH",
        isCash: true,
      },
    });

    // Product A: known server-side WITH its lot + reception (FIFO costing).
    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_A_ID,
        subscriptionId,
        internalCode: "POS-DEPREQ-001",
        commercialName: "POS DepRequeue Product A",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const priceA = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("depreq-server-price-a"),
        subscriptionId,
        productId: SERVER_PRODUCT_A_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    const taxA = await serverPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("depreq-server-tax-a"),
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
        currentPriceId: priceA.id,
        currentTaxHistoryId: taxA.id,
      },
    });
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-8",
        businessName: "POS DepRequeue Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_2_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900987654-1",
        businessName: "POS DepRequeue Supplier 2",
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
        productId: SERVER_PRODUCT_A_ID,
        lotId: SERVER_LOT_A_ID,
        receivedQuantity: LOT_INITIAL_STOCK,
        lotNumber: "DEPREQ-BATCH-A",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("6000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_A_ID,
        subscriptionId,
        batchNumber: "DEPREQ-BATCH-A",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: LOT_INITIAL_STOCK,
        version: 0,
        productId: SERVER_PRODUCT_A_ID,
      },
    });

    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000987677",
        documentType: "INVOICE",
        prefix: "POS-DEPREQ",
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
        code: "POS-DEPREQ-IVA19",
        name: "POS DepRequeue IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: SERVER_USER_ID,
      },
    });
    await localPrisma.paymentMethod.create({
      data: {
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-DEPREQ-CASH",
        name: "POS DepRequeue Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    });
    await localPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_A_ID,
        internalCode: "POS-DEPREQ-001",
        commercialName: "POS DepRequeue Product A",
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
        id: uuidFrom("depreq-local-price-a"),
        productId: SERVER_PRODUCT_A_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.productTaxHistory.create({
      data: {
        id: uuidFrom("depreq-local-tax-a"),
        productId: SERVER_PRODUCT_A_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: now,
        changedById: SERVER_USER_ID,
        changedAt: now,
      },
    });
    await localPrisma.lot.create({
      data: {
        id: uuidFrom("depreq-local-lot-a"),
        batchNumber: "DEPREQ-LOCAL-A",
        expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
        entryDate: now,
        state: "ACTIVE",
        currentStock: 100,
        productId: SERVER_PRODUCT_A_ID,
      },
    });
    // The supplier the product-chain reception references (exists on both
    // sides, as after a catalog pull).
    await localPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        identificationType: "NIT",
        identificationNumber: "900123456-8",
        businessName: "POS DepRequeue Supplier",
        isActive: true,
        createdById: SERVER_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });
    await localPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_2_ID,
        identificationType: "NIT",
        identificationNumber: "900987654-1",
        businessName: "POS DepRequeue Supplier 2",
        isActive: true,
        createdById: SERVER_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });

    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS DepRequeue Cashier",
      displayName: "POS DepRequeue Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-depreq",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-depreq-session-1",
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

  const makeServices = (): {
    salesPos: SalesPosService;
    cashShift: CashShiftService;
  } => {
    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;
    return {
      salesPos: createSalesPosService(
        localPrisma,
        auth,
        createInventoryLotsService(localPrisma),
      ),
      cashShift: createCashShiftService(localPrisma, auth),
    };
  };

  const push = (): ReturnType<typeof createSyncPushService> =>
    createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });

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

  /**
   * Server-side global OPEN shift for sale replays (the documented global
   * shift model — sales attach to the store-wide shift).
   */
  const ensureServerOpenShift = async (shiftId: string): Promise<void> => {
    const existing = await serverPrisma.cashShift.findUnique({
      where: { id: shiftId },
    });
    if (!existing) {
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
    }
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("auto-revives a sale that arrived before its CLIENT_CREATION (no human requeue)", async () => {
    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;
    const clients = createClientsService(localPrisma, auth);
    const { salesPos, cashShift } = makeServices();
    const shiftId = uuidFrom("depreq-shift-client");

    // ── 1. Offline sequence: the cashier opens the LOCAL shift (global
    // shift model — one store-wide shift), creates a NEW client (a credit
    // customer) and immediately sells to them. Nothing has been pushed. ──
    await cashShift.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    const newClient = await clients.create({
      fullName: "Cliente Requeue Auto",
      identificationType: "CC",
      // Unique per run: the server upserts CLIENT_CREATION by the
      // (subscriptionId, identificationType, identificationNumber) key, so a
      // fixed id would collide with rows from previous runs against the
      // persistent test DB and the local client uuid would never exist
      // server-side.
      identificationNumber: `1023456789-${Date.now()}`,
    });

    await ensureServerOpenShift(shiftId);
    const sale = (await salesPos.create({
      items: [{ productId: SERVER_PRODUCT_A_ID, quantity: 1 }],
      clientId: newClient.id,
    })) as { id: string };
    await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: SERVER_PM_CASH_ID, amount: SALE_TOTAL }],
    });

    const outbox = await localPrisma.syncQueue.findMany({
      where: { status: "PENDING" },
      orderBy: { clientSequence: "asc" },
    });
    const saleEntry = outbox.find((e) => e.operationType === "SALE_CONFIRMATION");
    const clientEntry = outbox.find((e) => e.operationType === "CLIENT_CREATION");
    expect(saleEntry).toBeDefined();
    expect(clientEntry).toBeDefined();

    // ── 2. The out-of-order delivery: ONLY the sale reaches the server
    // first (the client entry "is still in flight" — simulate by pushing
    // the sale entry alone through the real wire). ────────────────────────
    const pushSvc = push();
    await localPrisma.syncQueue.update({
      where: { id: clientEntry!.id },
      data: { status: "PROCESSING" }, // not selectable by fetchPendingEntries
    });
    const result = await pushSvc.pushPending();
    expect(result.accepted).toBe(1);

    // First cron tick: the sale's client does not exist server-side. The
    // sale replay does NOT fail: salesService.create silently degrades the
    // unknown client to NULL snapshots + clientId NULL (the documented
    // "offline-first degrade" in getClientSnapshot) and the sale is
    // created IN_PROGRESS → CONFIRMED with NO buyer. This is the silent
    // data-loss variant of the ordering gap: the sale survives, but the
    // client attribution is lost unless the CLIENT_CREATION lands and a
    // later dispatch patches the orphan.
    await drainServerQueue();
    const orphanSale = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: saleEntry!.operationUuid },
    });
    expect(orphanSale.operationalState).toBe("CONFIRMED");
    expect(orphanSale.clientId).toBeNull();
    expect(orphanSale.clientNameSnapshot).toBeNull();

    // The CLIENT_CREATION entry must have been accepted and completed too
    // (it arrived second but was never pushed until now).
    expect(
      await serverPrisma.syncQueue.count({
        where: { operationUuid: clientEntry!.operationUuid },
      }),
    ).toBe(0);

    // ── 3. The CLIENT_CREATION lands as a REAL pushed operation. The
    // dispatcher creates the server client (preserving the local uuid via
    // localClientId) and requeueDependentsOf is a no-op here (nothing is
    // in PERMANENT_FAILURE), but the sale needs a RE-delivery of its own
    // entry for the idempotent-confirm path to patch the orphan. ───────
    await localPrisma.syncQueue.update({
      where: { id: clientEntry!.id },
      data: { status: "PENDING" },
    });
    const clientPush = await pushSvc.pushPending();
    expect(clientPush.accepted).toBe(1);

    // CLIENT_CREATION is NOT an immediate-dispatch type — only the cron
    // (SyncProcessingJob) replays it. Drain until the client row exists.
    await drainServerQueue();

    const serverClient = await serverPrisma.client.findUniqueOrThrow({
      where: { id: newClient.id },
    });
    expect(serverClient.fullName).toBe("Cliente Requeue Auto");

    // Re-push the sale entry (what the real POS does: its local row went
    // COMPLETED only after a successful push — with the client entry still
    // in flight the POS would re-send the batch on the next window; here we
    // replay the sale entry through the idempotency guard).
    await localPrisma.syncQueue.update({
      where: { id: saleEntry!.id },
      data: { status: "PENDING" },
    });
    await pushSvc.pushPending();
    await drainServerQueue();

    // ── 4. The orphan was patched: the sale now references the server
    // client created by the CLIENT_CREATION replay — NO human action. ──
    const patchedSale = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: saleEntry!.operationUuid },
    });
    expect(patchedSale.clientId).toBe(newClient.id);
    expect(patchedSale.clientNameSnapshot).toBe("Cliente Requeue Auto");

    // Stock converged: the shared lot absorbed the sale.
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_A_ID },
    });
    expect(serverLot.currentStock).toBe(LOT_INITIAL_STOCK - 1);

    // ── 5. The POS drains: the sale entry is COMPLETED locally. ────────
    const localSaleEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationUuid: saleEntry!.operationUuid },
    });
    expect(localSaleEntry.status).toBe("COMPLETED");
    const pendingLeft = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pendingLeft).toBe(0);
  }, 120000);

  it("auto-revives a sale that arrived before its PRODUCT_CREATION (local uuid → server remap)", async () => {
    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;
    const products = createProductService(localPrisma, auth);
    const { salesPos, cashShift } = makeServices();
    const shiftId = uuidFrom("depreq-shift-product");

    // ── 1. Offline: a NEW product is created locally (OFFLINE- code,
    // PRODUCT_CREATION queued) and immediately sold. The GLOBAL shift from
    // the previous test is still open (one OPEN shift per tenant) — reuse
    // it, both locally and server-side.
    const newProduct = (await products.createProduct({
      commercialName: "Producto Requeue Auto",
      laboratory: "E2E Lab",
      saleType: "FREE_SALE",
      price: { price: UNIT_PRICE },
      tax: { taxSchemeId: SERVER_TAX_SCHEME_ID },
      barcodes: [
        {
          barcode: "7709998000015",
          barcodeType: "EAN13",
          isPrimary: true,
        },
      ],
    })) as { id: string; internalCode: string };
    expect(newProduct.internalCode.startsWith("OFFLINE-")).toBe(true);

    // Give the local product a sellable lot (the reception that would have
    // happened in-store; the sale replay needs stock server-side later —
    // the PRODUCT_CREATION replay does NOT create lots, so the test
    // provides the server lot when the product materializes, exactly like
    // the store's real PURCHASE_RECEPTION would).
    await localPrisma.lot.create({
      data: {
        id: uuidFrom("depreq-local-lot-newprod"),
        batchNumber: "DEPREQ-NEWPROD-BATCH",
        expirationDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        entryDate: new Date(),
        state: "ACTIVE",
        currentStock: 20,
        productId: newProduct.id,
      },
    });

    const sale = (await salesPos.create({
      items: [{ productId: newProduct.id, quantity: 1 }],
    })) as { id: string };
    await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: SERVER_PM_CASH_ID, amount: SALE_TOTAL }],
    });

    const outbox = await localPrisma.syncQueue.findMany({
      where: { status: "PENDING" },
      orderBy: { clientSequence: "asc" },
    });
    const saleEntry = outbox.find((e) => e.operationType === "SALE_CONFIRMATION");
    const productEntry = outbox.find(
      (e) => e.operationType === "PRODUCT_CREATION",
    );
    expect(saleEntry).toBeDefined();
    expect(productEntry).toBeDefined();

    // ── 2. Out-of-order: ONLY the sale is delivered. The PRODUCT path is
    // different from the client path: buildSaleItemFromRequest DOES throw
    // ProductNotFoundException for the unknown local uuid → the entry dies
    // as PERMANENT_FAILURE (this is the row the requeue service saves). ─
    const pushSvc = push();
    await localPrisma.syncQueue.update({
      where: { id: productEntry!.id },
      data: { status: "PROCESSING" },
    });
    await pushSvc.pushPending();
    await drainServerQueue();
    const deadSale = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: saleEntry!.operationUuid },
    });
    expect(deadSale.status).toBe("PERMANENT_FAILURE");
    expect(deadSale.lastErrorMessage).toContain("not found");

    // ── 3. The PRODUCT_CREATION lands. Its payload carries
    // metadata.productId = the LOCAL uuid; the dispatcher must create the
    // server product AND requeueDependentsOf(localProductId). ───────────
    await localPrisma.syncQueue.update({
      where: { id: productEntry!.id },
      data: { status: "PENDING" },
    });
    await pushSvc.pushPending();
    await drainServerQueue();

    // The requeue DID fire: the sale was flipped back to PENDING and
    // re-dispatched in this same drain — but no lot exists yet, so the
    // replay died AGAIN as PERMANENT_FAILURE (InsufficientStock path).
    // This is exactly the production chain: only the reception revives
    // it for good.
    const revived = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: saleEntry!.operationUuid },
    });
    expect(revived.status).toBe("PERMANENT_FAILURE");
    // The product WAS found this time (the requeue + remap worked) — the
    // replay died for the NEXT missing dependency: no lot/stock yet.
    expect(revived.lastErrorMessage).toContain("Insufficient stock");

    // The server product exists with the OFFLINE- code normalized to a
    // sequential P-code, and carries sourceProductId = local uuid so the
    // sale replay can remap.
    const serverProduct = await serverPrisma.product.findFirstOrThrow({
      where: { sourceProductId: newProduct.id },
    });
    expect(serverProduct.commercialName).toBe("Producto Requeue Auto");
    expect(serverProduct.internalCode).toMatch(/^P\d+$/);

    // ── 4. The replay needs saleable stock: the store's REAL purchase
    // reception of the new product. The chain in production is: the sale
    // re-fails inside the same drain (PRODUCT_CREATION revived it before
    // any lot existed) → PURCHASE_RECEPTION_CONFIRMATION (a REAL POS
    // operation) materializes the lot server-side AND its handler calls
    // requeueDependentsOf(lotId, productId) → the sale completes. Nothing
    // is inserted by hand server-side. ─────────────────────────────────
    const revivedAgain = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: saleEntry!.operationUuid },
    });
    expect(revivedAgain.status).toBe("PERMANENT_FAILURE");
    expect(revivedAgain.lastErrorMessage).toContain("Insufficient stock");

    const receptions = createPurchaseReceptionsService(localPrisma, auth);
    const reception = (await receptions.createReception({
      supplierId: SERVER_SUPPLIER_2_ID,
      items: [
        {
          productId: newProduct.id,
          receivedQuantity: 20,
          lotNumber: "DEPREQ-NEWPROD-BATCH",
          expirationDate: "2027-12-31",
          realUnitCost: 6000,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          taxRate: 19,
        },
      ],
    })) as { id: string };
    await receptions.confirmReception(reception.id);

    // The reception's PURCHASE_RECEPTION_CONFIRMATION must be in the local
    // outbox alongside whatever else is pending (the re-failed sale entry
    // locally went COMPLETED after its push — the POS only knows the server
    // accepted it; the requeue chain is purely server-side).
    const receptionEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "PURCHASE_RECEPTION_CONFIRMATION" },
    });
    expect(receptionEntry.status).toBe("PENDING");
    await pushSvc.pushPending();
    await drainServerQueue();

    const completed = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: saleEntry!.operationUuid },
    });
    expect(completed.status).toBe("COMPLETED");

    const serverSale = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: saleEntry!.operationUuid },
      include: { items: true },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    // The sale item's productId was remapped to the SERVER product id.
    expect(serverSale.items[0]?.productId).toBe(serverProduct.id);

    // The lot was created by the REAL PURCHASE_RECEPTION_CONFIRMATION
    // replay (not by the test) — stock converged: 20 received − 1 sold.
    const serverLot = await serverPrisma.lot.findFirstOrThrow({
      where: {
        productId: serverProduct.id,
        batchNumber: "DEPREQ-NEWPROD-BATCH",
      },
    });
    expect(serverLot.currentStock).toBe(19);
  }, 120000);

  it("leaves no pending operation in the local outbox", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
