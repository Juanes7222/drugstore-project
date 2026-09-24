/**
 * POS ↔ Server integration — CONCURRENT push race (two terminals, one server).
 *
 * All other multi-terminal specs push sequentially. Production does not:
 * two cashiers hit "confirm" within the same second and both outboxes hit
 * POST /sync/batch at the same time. This spec exercises the real race
 * windows with real HTTP concurrency (Promise.all over two authenticated
 * sessions):
 *
 *   1. Last-unit race: lot stock = 1, two 1-unit sales pushed CONCURRENTLY.
 *      Exactly one sale must survive and the lot must never go negative.
 *      Stock depletion uses optimistic locking (Lot.version) — the loser is
 *      either PERMANENT_FAILURE (Insufficient stock) or a transient
 *      ConcurrentStockModification retry that resolves on a later drain,
 *      so assertions are made on the FINAL state after full drains.
 *   2. Stock = 2, two 1-unit sales: both must apply (no lost update) —
 *      lot ends at 0 with exactly two SALE InventoryMovement rows.
 *   3. Same clientSequence from both workstations: sequence identity is
 *      scoped per workstation, never merged.
 *   4. Concurrent SHIFT_OPEN: the global-shift advisory lock must yield
 *      exactly ONE open shift for the store.
 *   5. Concurrent PRODUCT_CREATION with OFFLINE- codes: P2002 on the unique
 *      internalCode makes one entry retry on the next drain; both products
 *      must converge with distinct P-codes (no duplicates).
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

import {
  SalesPosService,
  createSalesPosService,
} from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import {
  CashShiftService,
  createCashShiftService,
} from "../cash-shift/cash-shift.service";
import { createProductService } from "../catalog/product.service";
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

const SERVER_WS_A_ID = uuidFrom("pos-int-concurrent-server-ws-a");
const SERVER_WS_B_ID = uuidFrom("pos-int-concurrent-server-ws-b");
const SERVER_USER_ID = "pos-int-concurrent-server-user-id";
const USERNAME = "pos-integration-concurrent@pos.test";
const PASSWORD = "PosIntegration123!";

const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-concurrent-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-concurrent-pm-cash");
// One INVOICE resolution + allocation per workstation: the sale replay
// numbers each sale from its own DIAN range (missing allocations make every
// replay die PERMANENT_FAILURE with "No active resolution allocation").
const SERVER_RESOLUTION_A_ID = uuidFrom("pos-int-concurrent-resolution-a");
const SERVER_ALLOCATION_A_ID = uuidFrom("pos-int-concurrent-allocation-a");
const SERVER_RESOLUTION_B_ID = uuidFrom("pos-int-concurrent-resolution-b");
const SERVER_ALLOCATION_B_ID = uuidFrom("pos-int-concurrent-allocation-b");

// Product + lot shared by both terminals (the race target).
const SERVER_PRODUCT_ID = uuidFrom("pos-int-concurrent-product");
const SERVER_LOT_ID = uuidFrom("pos-int-concurrent-lot");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-concurrent-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-concurrent-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom("pos-int-concurrent-reception-item");

const POS_WS_A_ID = "pos-int-concurrent-ws-a";
const POS_WS_B_ID = "pos-int-concurrent-ws-b";

const UNIT_PRICE = 12000;
const SALE_TOTAL = 14280; // 1 × 12000 × 1.19

/** Default lot stock for the suite (test 2 consumes it fully). */
const LOT_INITIAL_STOCK = 2;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — concurrent push race (two terminals)", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let tokenA: string;
  let tokenB: string;

  let pgA: PGlite;
  let localPrismaA: LocalPrismaClient;
  let pgB: PGlite;
  let localPrismaB: LocalPrismaClient;

  const cleanServerRows = async (): Promise<void> => {
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
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
      where: { cashShift: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } } },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } },
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
    // Receptions of previous runs for the deterministic supplier (the
    // dispatcher's idempotency fallback matches (sequentialNumber, supplierId)).
    const staleReceptions = await serverPrisma.purchaseReception.findMany({
      where: { supplierId: SERVER_SUPPLIER_ID },
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
      where: { id: SERVER_SUPPLIER_ID },
    });
    // Offline-race products created by previous runs (dynamic P-codes).
    await serverPrisma.productPriceHistory.deleteMany({
      where: { product: { commercialName: "Producto Concurrencia" } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { product: { commercialName: "Producto Concurrencia" } },
    });
    await serverPrisma.productBarcode.deleteMany({
      where: { product: { commercialName: "Producto Concurrencia" } },
    });
    await serverPrisma.product.deleteMany({
      where: { commercialName: "Producto Concurrencia" },
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
      where: { workstationId: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: { in: [SERVER_WS_A_ID, SERVER_WS_B_ID] } },
    });
  };

  beforeAll(async () => {
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-concurrent");
    await cleanServerRows();

    for (const [id, name, code] of [
      [SERVER_WS_A_ID, "POS Concurrent Terminal A", "WS-POS-CONC-A"],
      [SERVER_WS_B_ID, "POS Concurrent Terminal B", "WS-POS-CONC-B"],
    ] as const) {
      await serverPrisma.workstation.create({
        data: {
          id,
          name,
          code,
          isActive: true,
          registeredAt: new Date(),
        },
      });
    }

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Concurrent Cashier",
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
        code: "POS-CONC-IVA19",
        name: "POS Concurrent IVA 19%",
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
        internalCode: "POS-CONC-CASH",
        name: "POS Concurrent Cash",
        category: "CASH",
        isCash: true,
      },
    });

    // Fiscal numbering per workstation (mandatory for the sale replay).
    for (const [wsId, resId, allocId, prefix] of [
      [SERVER_WS_A_ID, SERVER_RESOLUTION_A_ID, SERVER_ALLOCATION_A_ID, "POS-CONCA"],
      [SERVER_WS_B_ID, SERVER_RESOLUTION_B_ID, SERVER_ALLOCATION_B_ID, "POS-CONCB"],
    ] as const) {
      await serverPrisma.fiscalResolution.create({
        data: {
          id: resId,
          subscriptionId,
          resolutionNumber: `1876400${resId.slice(0, 6)}`,
          documentType: "INVOICE",
          prefix,
          rangeFrom: 1,
          rangeTo: 1000,
          validFrom: new Date("2026-01-01"),
          validTo: new Date("2027-12-31"),
          state: "ACTIVE",
          workstationId: wsId,
        },
      });
      await serverPrisma.fiscalResolutionAllocation.create({
        data: {
          id: allocId,
          subscriptionId,
          resolutionId: resId,
          workstationId: wsId,
          rangeFrom: 1,
          rangeTo: 1000,
          allocatedAt: new Date("2026-01-01"),
          allocatedByUserId: SERVER_USER_ID,
        },
      });
    }

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-CONC-001",
        commercialName: "POS Concurrent Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-concurrent-server-price"),
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
        id: uuidFrom("pos-int-concurrent-server-tax"),
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

    // Supplier + reception for FIFO costing of the shared lot.
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900555444-3",
        businessName: "POS Concurrent Supplier",
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
        receivedQuantity: LOT_INITIAL_STOCK,
        lotNumber: "CONCURRENT-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: new Prisma.Decimal("5000"),
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "CONCURRENT-BATCH",
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

    const login = async (workstationId: string): Promise<string> => {
      const res = await request(serverApp.getHttpServer())
        .post("/auth/login")
        .send({
          identifier: USERNAME,
          secret: PASSWORD,
          sessionType: "PASSWORD",
          workstationId,
        })
        .expect(200);
      return res.body.accessToken as string;
    };
    tokenA = await login(SERVER_WS_A_ID);
    tokenB = await login(SERVER_WS_B_ID);

    // Two fully independent PGlite terminals.
    const bootTerminal = async (
      suffix: string,
    ): Promise<{ pg: PGlite; prisma: LocalPrismaClient }> => {
      const pg = new PGlite("memory://");
      await pg.exec(LOCAL_SCHEMA_SQL);
      const prisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });
      const now = new Date();
      await prisma.client.create({
        data: {
          id: "00000000-0000-0000-0000-000000000001",
          identificationType: "NIT",
          identificationNumber: "222222222222",
          fullName: "Cliente Genérico",
          isActive: true,
          createdById: SERVER_USER_ID,
        },
      });
      await prisma.product.create({
        data: {
          id: SERVER_PRODUCT_ID,
          internalCode: "POS-CONC-001",
          commercialName: "POS Concurrent Product",
          laboratory: "E2E Lab",
          saleType: "FREE_SALE",
          isActive: true,
          createdById: SERVER_USER_ID,
          createdAt: now,
          updatedAt: now,
        },
      });
      await prisma.productPriceHistory.create({
        data: {
          id: uuidFrom(`pos-int-concurrent-local-price-${suffix}`),
          productId: SERVER_PRODUCT_ID,
          price: new Prisma.Decimal(UNIT_PRICE),
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      // Same id as the server row: the PRODUCT_CREATION replay references
      // this taxSchemeId and the server FK must resolve it.
      await prisma.taxScheme.create({
        data: {
          id: SERVER_TAX_SCHEME_ID,
          code: "POS-CONC-IVA19",
          name: "POS Concurrent IVA 19%",
          taxType: "IVA",
          rate: new Prisma.Decimal("19"),
          effectiveFrom: now,
          createdById: SERVER_USER_ID,
        },
      });
      await prisma.productTaxHistory.create({
        data: {
          id: uuidFrom(`pos-int-concurrent-local-tax-hist-${suffix}`),
          productId: SERVER_PRODUCT_ID,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      await prisma.paymentMethod.create({
        data: {
          id: SERVER_PM_CASH_ID,
          internalCode: "POS-CONC-CASH",
          name: "POS Concurrent Cash",
          category: "CASH",
          isCash: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      // Local sellable stock (server assertions target the SERVER lot; the
      // local one only needs to let salesPos.confirm pass).
      await prisma.lot.create({
        data: {
          id: uuidFrom(`pos-int-concurrent-local-lot-${suffix}`),
          batchNumber: `CONCURRENT-LOCAL-${suffix}`,
          expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
          entryDate: now,
          state: "ACTIVE",
          currentStock: 100,
          productId: SERVER_PRODUCT_ID,
        },
      });
      return { pg, prisma };
    };
    const terminalA = await bootTerminal("a");
    pgA = terminalA.pg;
    localPrismaA = terminalA.prisma;
    const terminalB = await bootTerminal("b");
    pgB = terminalB.pg;
    localPrismaB = terminalB.prisma;
  }, 180000);

  afterAll(async () => {
    for (const prisma of [localPrismaA, localPrismaB]) {
      if (prisma) await prisma.$disconnect();
    }
    if (pgA) await pgA.close();
    if (pgB) await pgB.close();
    if (serverPrisma) {
      await cleanServerRows();
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const useTerminalSession = (
    localWsId: string,
    token: string,
    sessionId: string,
  ): void => {
    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username: USERNAME,
      fullName: "POS Concurrent Cashier",
      displayName: "POS Concurrent Cashier",
      role: "ADMIN",
      subscriptionId: subscriptionId!,
      workstationId: localWsId,
      accessToken: token,
      refreshToken: `refresh-${sessionId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId,
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });
  };

  const makeServices = (
    prisma: LocalPrismaClient,
  ): {
    salesPos: SalesPosService;
    cashShift: CashShiftService;
  } => {
    const auth = {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any;
    return {
      salesPos: createSalesPosService(
        prisma,
        auth,
        createInventoryLotsService(prisma),
      ),
      cashShift: createCashShiftService(prisma, auth),
    };
  };

  /**
   * Drains the server queue until no retryable rows remain. The concurrent
   * races need SEVERAL ticks: optimistic-locking losers come back as
   * transient FAILED (nextRetryAt set) and must be re-dispatched.
   */
  const drainServerQueue = async (maxTicks = 15): Promise<void> => {
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

  /**
   * Confirms a sale on a terminal and returns its SALE_CONFIRMATION outbox
   * entry (identified by the sale's sourceOperationUuid stamped in payload
   * metadata by the sales service).
   */
  const sellOneUnit = async (
    prisma: LocalPrismaClient,
    services: { salesPos: SalesPosService },
  ): Promise<string> => {
    const sale = (await services.salesPos.create({
      items: [{ productId: SERVER_PRODUCT_ID, quantity: 1 }],
    })) as { id: string };
    await services.salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: SERVER_PM_CASH_ID, amount: SALE_TOTAL }],
    });
    const entry = await prisma.syncQueue.findFirstOrThrow({
      where: { operationType: "SALE_CONFIRMATION", status: "PENDING" },
      orderBy: { clientSequence: "desc" },
    });
    return entry.operationUuid;
  };

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  it("last-unit race: exactly one sale survives and the lot never goes negative", async () => {
    // Reset the shared lot to exactly 1 unit.
    await serverPrisma.lot.update({
      where: { id: SERVER_LOT_ID },
      data: { currentStock: 1, version: 0, state: "ACTIVE" },
    });
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });

    // Terminal A: open LOCAL shift + sell. Terminal B: the same. The GLOBAL
    // shift model makes B's SHIFT_OPEN replay the documented duplicate
    // rejection — the sale itself must still replay via the bootstrap path.
    useTerminalSession(POS_WS_A_ID, tokenA, "pos-int-concurrent-session-a");
    const servicesA = makeServices(localPrismaA);
    await servicesA.cashShift.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    const saleUuidA = await sellOneUnit(localPrismaA, servicesA);

    useTerminalSession(POS_WS_B_ID, tokenB, "pos-int-concurrent-session-b");
    const servicesB = makeServices(localPrismaB);
    await servicesB.cashShift.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    const saleUuidB = await sellOneUnit(localPrismaB, servicesB);

    // ── THE RACE: both outboxes hit the server at the same time ────────
    const pushA = createSyncPushService({
      prisma: localPrismaA,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenA,
    });
    const pushB = createSyncPushService({
      prisma: localPrismaB,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenB,
    });
    const [resA, resB] = await Promise.all([
      pushA.pushPending(),
      pushB.pushPending(),
    ]);
    void resA;
    void resB;

    // Ingest accepted every entry regardless of order (sales replay via the
    // cron; SHIFT_OPEN is immediate-dispatched and one side wins the global
    // shift) — the per-terminal accepted counts are asserted nowhere because
    // the concurrent immediate dispatch can reject either side's SHIFT_OPEN.

    await drainServerQueue();

    // ── FINAL state: exactly one of the two sales exists as CONFIRMED ──
    const saleA = await serverPrisma.sale.findUnique({
      where: { sourceOperationUuid: saleUuidA },
    });
    const saleB = await serverPrisma.sale.findUnique({
      where: { sourceOperationUuid: saleUuidB },
    });
    const confirmed = [saleA, saleB].filter(
      (s) => s && s.operationalState === "CONFIRMED",
    );
    expect(confirmed).toHaveLength(1);

    // The lot must have absorbed EXACTLY one unit — never negative.
    const lot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(lot.currentStock).toBe(0);

    // Exactly one SALE movement exists for the shared lot.
    const saleMovements = await serverPrisma.inventoryMovement.count({
      where: { lotId: SERVER_LOT_ID, movementType: "SALE" },
    });
    expect(saleMovements).toBe(1);

    // The loser's queue row must be terminal (PERMANENT_FAILURE or FAILED
    // without a retry schedule) — never a silent drop, never an infinite
    // retry loop.
    const loserUuid = saleA?.operationalState === "CONFIRMED" ? saleUuidB : saleUuidA;
    const loserRow = await serverPrisma.syncQueue.findUniqueOrThrow({
      where: { operationUuid: loserUuid },
    });
    expect(["PERMANENT_FAILURE", "FAILED"]).toContain(loserRow.status);
  }, 180000);

  it("stock exactly sufficient: both concurrent sales apply with no lost update", async () => {
    // Stock = 2, two 1-unit sales pushed concurrently → both must apply.
    await serverPrisma.lot.update({
      where: { id: SERVER_LOT_ID },
      data: { currentStock: 2, version: 0, state: "ACTIVE" },
    });
    // Reset the movement ledger so the count is this test's own.
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });

    useTerminalSession(POS_WS_A_ID, tokenA, "pos-int-concurrent-session-a2");
    const servicesA = makeServices(localPrismaA);
    const saleUuidA = await sellOneUnit(localPrismaA, servicesA);

    useTerminalSession(POS_WS_B_ID, tokenB, "pos-int-concurrent-session-b2");
    const servicesB = makeServices(localPrismaB);
    const saleUuidB = await sellOneUnit(localPrismaB, servicesB);

    const pushA = createSyncPushService({
      prisma: localPrismaA,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenA,
    });
    const pushB = createSyncPushService({
      prisma: localPrismaB,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenB,
    });
    await Promise.all([pushA.pushPending(), pushB.pushPending()]);
    await drainServerQueue();

    const saleA = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: saleUuidA },
    });
    const saleB = await serverPrisma.sale.findUniqueOrThrow({
      where: { sourceOperationUuid: saleUuidB },
    });
    expect(saleA.operationalState).toBe("CONFIRMED");
    expect(saleB.operationalState).toBe("CONFIRMED");

    const lot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(lot.currentStock).toBe(0);

    // No lost update: exactly two SALE movements, one per sale.
    const movements = await serverPrisma.inventoryMovement.findMany({
      where: { lotId: SERVER_LOT_ID, movementType: "SALE" },
      select: { quantity: true, resultingStock: true },
    });
    expect(movements).toHaveLength(2);
    const totalSold = movements.reduce((sum, m) => sum + Number(m.quantity), 0);
    expect(totalSold).toBe(2);

    // Both terminals' outboxes drained clean.
    for (const prisma of [localPrismaA, localPrismaB]) {
      const pending = await prisma.syncQueue.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      });
      expect(pending).toBe(0);
    }
  }, 180000);

  it("same clientSequence from two workstations is never merged (per-workstation scoping)", async () => {
    // Test 2 already delivered overlapping sequences 1..2 from both
    // workstations. The server must hold them as DISTINCT rows — a global
    // sequence key would have collided at ingest time.
    const rows = await serverPrisma.syncQueue.findMany({
      where: {
        subscriptionId,
        operationType: "SALE_CONFIRMATION",
      },
      select: {
        operationUuid: true,
        sourceWorkstationId: true,
        clientSequence: true,
      },
    });
    const fromA = rows.filter((r) => r.sourceWorkstationId === SERVER_WS_A_ID);
    const fromB = rows.filter((r) => r.sourceWorkstationId === SERVER_WS_B_ID);
    expect(fromA.length).toBeGreaterThanOrEqual(2);
    expect(fromB.length).toBeGreaterThanOrEqual(2);
    // Overlapping clientSequence values coexist per workstation.
    const seqA = new Set(fromA.map((r) => Number(r.clientSequence)));
    const seqB = new Set(fromB.map((r) => Number(r.clientSequence)));
    expect([...seqA].some((s) => seqB.has(s))).toBe(true);
  }, 120000);

  it("concurrent SHIFT_OPEN from two workstations yields exactly ONE open shift", async () => {
    // Test 1's concurrent batch already carried BOTH workstations'
    // SHIFT_OPEN entries (a real production batch: shift open + sales
    // together). The global-shift advisory lock must have let exactly one
    // through — this test inspects that final state.
    const openShifts = await serverPrisma.cashShift.findMany({
      where: { subscriptionId, state: "OPEN" },
      select: { id: true, workstationId: true },
    });
    expect(openShifts).toHaveLength(1);
    // The shift belongs to whichever terminal won the race.
    expect([SERVER_WS_A_ID, SERVER_WS_B_ID]).toContain(
      openShifts[0]!.workstationId,
    );

    // The loser's SHIFT_OPEN row is the documented permanent rejection.
    const shiftOpenRows = await serverPrisma.syncQueue.findMany({
      where: { subscriptionId, operationType: "SHIFT_OPEN" },
      select: { sourceWorkstationId: true, status: true },
    });
    expect(shiftOpenRows).toHaveLength(2);
    const statuses = shiftOpenRows.map((r) => r.status).sort();
    // One COMPLETED (the winner), one terminal failure (the loser).
    expect(statuses).toEqual(["COMPLETED", "FAILED"]);
  }, 180000);

  it("concurrent PRODUCT_CREATION with OFFLINE- codes converges without duplicates", async () => {
    useTerminalSession(POS_WS_A_ID, tokenA, "pos-int-concurrent-session-a4");
    const productsA = createProductService(localPrismaA, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    useTerminalSession(POS_WS_B_ID, tokenB, "pos-int-concurrent-session-b4");
    const productsB = createProductService(localPrismaB, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);

    // Same commercial name + barcode on both terminals: two independent
    // PRODUCT_CREATION entries with OFFLINE- provisional codes.
    const runId = Date.now();
    const createLocal = async (
      products: ReturnType<typeof createProductService>,
      terminalIndex: number,
    ): Promise<string> => {
      const product = (await products.createProduct({
        commercialName: "Producto Concurrencia",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        price: { price: UNIT_PRICE },
        tax: { taxSchemeId: SERVER_TAX_SCHEME_ID },
        barcodes: [
          {
            // Distinct per terminal AND 13 digits (EAN13): a shared or
            // wrong-length code would fail server validation instead of
            // exercising the OFFLINE- P-code race.
            barcode: `77099${String(runId).slice(-7)}${terminalIndex}`,
            barcodeType: "EAN13",
            isPrimary: true,
          },
        ],
      })) as { id: string; internalCode: string };
      expect(product.internalCode.startsWith("OFFLINE-")).toBe(true);
      return product.id;
    };
    const localIdA = await createLocal(productsA, 1);
    const localIdB = await createLocal(productsB, 2);
    expect(localIdA).not.toBe(localIdB);

    // Both PRODUCT_CREATION entries pushed concurrently. The server
    // generates P-codes via MAX+1 (NOT inside one transaction): the P2002
    // on the unique internalCode must make the loser retry on the next
    // drain and converge with its own P-code.
    const pushA = createSyncPushService({
      prisma: localPrismaA,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenA,
    });
    const pushB = createSyncPushService({
      prisma: localPrismaB,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: tokenB,
    });
    await Promise.all([pushA.pushPending(), pushB.pushPending()]);
    // The drain loop retries the P2002 loser until it converges.
    await drainServerQueue();

    // Exactly TWO server products exist for this name — no duplicate flood.
    const serverProducts = await serverPrisma.product.findMany({
      where: { commercialName: "Producto Concurrencia" },
      select: { id: true, internalCode: true, sourceProductId: true },
    });
    expect(serverProducts).toHaveLength(2);
    for (const p of serverProducts) {
      expect(p.internalCode).toMatch(/^P\d+$/);
    }
    // Each local uuid remaps to its own server row.
    const ids = new Set(serverProducts.map((p) => p.id));
    expect(ids.size).toBe(2);

    // Both local outboxes are clean.
    for (const prisma of [localPrismaA, localPrismaB]) {
      const pending = await prisma.syncQueue.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      });
      expect(pending).toBe(0);
    }
  }, 180000);
});
