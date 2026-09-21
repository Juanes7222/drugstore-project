/**
 * Multi-terminal POS ↔ Server integration — TWO real POS databases (PGlite ×2)
 * with independent workstations and sessions synchronizing against ONE real
 * NestJS server and one shared Postgres database (RLS on).
 *
 * This exercises the production convergence story end to end:
 *   - Both terminals sell the same catalog product from their own local
 *     PGlite; the server must apply BOTH sale replays against the SAME lot
 *     (stock = 50 − 1 − 2) without cross-terminal interference.
 *   - Both terminals emit operations with overlapping clientSequence values
 *     (each local outbox starts at 1); the server must scope sequence
 *     identity per workstation, not globally.
 *   - Each terminal's DIAN INVOICE consumes a consecutive from ITS OWN
 *     workstation's FiscalResolutionAllocation.
 *
 * Same real-code harness as the other integration specs: real POS domain
 * services + real SyncPushService over real HTTP, real AppModule, real cron
 * tick. The only bridge between POS and server is the wire contract.
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
// Server side (real AppModule)
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import {
  INestApplication,
  ValidationPipe,
} from "../../../../../node_modules/.pnpm/node_modules/@nestjs/common";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
// The server-side Prisma client: the same prebuilt CJS bundle of
// packages/database the server e2e suite uses (real full client, loadable
// from vitest without jest's resolution tricks).
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

// Dynamic import: AppModule must evaluate AFTER setServerEnv() has run.
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
import {
  CashShiftService,
  createCashShiftService,
} from "../cash-shift/cash-shift.service";
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

// Server-side workstation rows (one per terminal).
const SERVER_WS_A_ID = uuidFrom("pos-int-multi-server-ws-a");
const SERVER_WS_B_ID = uuidFrom("pos-int-multi-server-ws-b");
const SERVER_USER_ID = "pos-int-multi-server-user-id";
const USERNAME = "pos-integration-multi@pos.test";
const PASSWORD = "PosIntegration123!";

// Shared catalog on the server, mirrored on both terminals.
const SERVER_PRODUCT_ID = uuidFrom("pos-int-multi-server-product");
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-multi-server-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-multi-server-pm-cash");
const SERVER_LOT_ID = uuidFrom("pos-int-multi-server-lot");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-multi-server-supplier");
const SERVER_RECEPTION_ID = uuidFrom("pos-int-multi-server-reception");
const SERVER_RECEPTION_ITEM_ID = uuidFrom(
  "pos-int-multi-server-reception-item",
);
const LOT_UNIT_COST = new Prisma.Decimal("8000");

// Fiscal numbering: one INVOICE resolution + allocation per workstation.
const SERVER_RESOLUTION_A_ID = uuidFrom("pos-int-multi-fiscal-resolution-a");
const SERVER_ALLOCATION_A_ID = uuidFrom("pos-int-multi-fiscal-allocation-a");
const SERVER_RESOLUTION_B_ID = uuidFrom("pos-int-multi-fiscal-resolution-b");
const SERVER_ALLOCATION_B_ID = uuidFrom("pos-int-multi-fiscal-allocation-b");

// Local (POS) ids. The local product row mirrors the server product with the
// SAME id (established-pharmacy case); workstations use fixed local codes.
const PRODUCT_ID = SERVER_PRODUCT_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;
const POS_WS_A_ID = "pos-int-multi-ws-a";
const POS_WS_B_ID = "pos-int-multi-ws-b";

const UNIT_PRICE = 15000;
const SALE_QTY_A = 1;
const SALE_QTY_B = 2;
const TOTAL_A = 17850; // 1 × 15000 × 1.19
const TOTAL_B = 35700; // 2 × 15000 × 1.19
const LOT_INITIAL_STOCK = 50;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — two terminals converge on one server", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let tokenA: string;
  let tokenB: string;

  // POS terminal A
  let pgA: PGlite;
  let localPrismaA: LocalPrismaClient;
  let salesPosA: SalesPosService;
  let cashShiftA: CashShiftService;

  // POS terminal B
  let pgB: PGlite;
  let localPrismaB: LocalPrismaClient;
  let salesPosB: SalesPosService;
  let cashShiftB: CashShiftService;

  /** Cleans every tenant-scoped row this spec owns, children before parents. */
  const cleanServerRows = async (): Promise<void> => {
    const wsIds = [SERVER_WS_A_ID, SERVER_WS_B_ID];
    const resolutionIds = [SERVER_RESOLUTION_A_ID, SERVER_RESOLUTION_B_ID];
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: { in: wsIds } } },
    });
    await serverPrisma.saleItemLot.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: wsIds } } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: { in: wsIds } } } },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: { in: wsIds } } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: { in: wsIds } },
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
        resolutionId: { in: resolutionIds },
      },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: { in: wsIds } },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { id: { in: resolutionIds } },
    });
    // Historials first (FK RESTRICT on Product), then the product rows.
    // The offline-race scenario creates a second product row server-side.
    await serverPrisma.productPriceHistory.deleteMany({
      where: { product: { commercialName: "Producto Offline Race" } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { product: { commercialName: "Producto Offline Race" } },
    });
    await serverPrisma.product.deleteMany({
      where: { commercialName: "Producto Offline Race" },
    });
    await serverPrisma.productPriceHistory.deleteMany({
      where: { product: { commercialName: "POS Multi Integration Product" } },
    });
    await serverPrisma.productTaxHistory.deleteMany({
      where: { product: { commercialName: "POS Multi Integration Product" } },
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
      where: { workstationId: { in: wsIds } },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: { in: wsIds } },
    });
  };

  beforeAll(async () => {
    // =====================================================================
    // 1. SERVER — real NestJS app, real Postgres, TWO workstations
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-multi");
    await cleanServerRows();

    for (const [id, name, code] of [
      [SERVER_WS_A_ID, "POS Multi Terminal A", "WS-POS-MULTI-A"],
      [SERVER_WS_B_ID, "POS Multi Terminal B", "WS-POS-MULTI-B"],
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

    // ONE cashier account used from both terminals (the realistic case).
    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Multi Integration Cashier",
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
        code: "POS-MULTI-IVA19",
        name: "POS Multi IVA 19%",
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
        internalCode: "POS-MULTI-001",
        commercialName: "POS Multi Integration Product",
        laboratory: "E2E Lab",
        saleType: "FREE_SALE",
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: uuidFrom("pos-int-multi-server-price-hist"),
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
        id: uuidFrom("pos-int-multi-server-tax-hist"),
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

    // ONE shared lot: both terminals will sell from it and the server must
    // converge the stock correctly (50 − 1 − 2 = 47).
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        batchNumber: "POS-MULTI-BATCH",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: LOT_INITIAL_STOCK,
        version: 0,
        productId: SERVER_PRODUCT_ID,
      },
    });

    // The lot's acquisition cost (required by sale replay FIFO costing).
    await serverPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        subscriptionId,
        identificationType: "NIT",
        identificationNumber: "900123456-2",
        businessName: "POS Multi Integration Supplier",
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
        lotNumber: "POS-MULTI-BATCH",
        expirationDate: new Date("2027-12-31"),
        realUnitCost: LOT_UNIT_COST,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
      },
    });

    // Fiscal numbering per workstation (each terminal has its own resolution
    // + allocation, like a real multi-terminal deployment).
    for (const [wsId, resId, allocId, prefix] of [
      [
        SERVER_WS_A_ID,
        SERVER_RESOLUTION_A_ID,
        SERVER_ALLOCATION_A_ID,
        "POS-INTA",
      ],
      [
        SERVER_WS_B_ID,
        SERVER_RESOLUTION_B_ID,
        SERVER_ALLOCATION_B_ID,
        "POS-INTB",
      ],
    ] as const) {
      await serverPrisma.fiscalResolution.create({
        data: {
          id: resId,
          subscriptionId,
          resolutionNumber: `187640${prefix.length}${resId.slice(0, 6)}`,
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

    await serverPrisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: SERVER_PM_CASH_ID,
        internalCode: "POS-MULTI-CASH",
        name: "POS Multi Integration Cash",
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
    await serverApp.listen(0);
    serverPort = serverApp.getHttpServer().address().port;

    // One login PER WORKSTATION — each terminal holds its own token and the
    // server attributes every pushed operation to the authenticated terminal.
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

    // =====================================================================
    // 2. TWO POS terminals — two real PGlite databases, fully independent
    // =====================================================================
    const bootTerminal = async (
      suffix: string,
    ): Promise<{
      pg: PGlite;
      prisma: LocalPrismaClient;
    }> => {
      const pg = new PGlite("memory://");
      await pg.exec(LOCAL_SCHEMA_SQL);
      const prisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });
      const now = new Date();
      // Generic (consumidor final) client every anonymous sale falls back to.
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
          id: PRODUCT_ID,
          internalCode: "POS-MULTI-001",
          commercialName: "POS Multi Integration Product",
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
          id: uuidFrom(`pos-int-multi-local-price-hist-${suffix}`),
          productId: PRODUCT_ID,
          price: new Prisma.Decimal(UNIT_PRICE),
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      await prisma.taxScheme.create({
        data: {
          id: uuidFrom("pos-int-multi-local-tax-scheme"),
          code: "IVA-19",
          name: "IVA 19",
          taxType: "IVA",
          rate: new Prisma.Decimal("19"),
          effectiveFrom: now,
          createdById: SERVER_USER_ID,
        },
      });
      await prisma.productTaxHistory.create({
        data: {
          id: uuidFrom("pos-int-multi-local-tax-hist"),
          productId: PRODUCT_ID,
          taxSchemeId: uuidFrom("pos-int-multi-local-tax-scheme"),
          effectiveFrom: now,
          changedById: SERVER_USER_ID,
          changedAt: now,
        },
      });
      await prisma.lot.create({
        data: {
          id: uuidFrom(`pos-int-multi-local-lot-${suffix}`),
          batchNumber: "POS-MULTI-LOCAL-LOT",
          expirationDate: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
          entryDate: now,
          state: "ACTIVE",
          currentStock: 100,
          productId: PRODUCT_ID,
        },
      });
      await prisma.paymentMethod.create({
        data: {
          id: PM_CASH_ID,
          internalCode: "POS-MULTI-CASH",
          name: "POS Multi Integration Cash",
          category: "CASH",
          isCash: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
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
    if (localPrismaA) await localPrismaA.$disconnect();
    if (pgA) await pgA.close();
    if (localPrismaB) await localPrismaB.$disconnect();
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

  /**
   * The local session store is global to the POS process: point it at a
   * terminal before driving that terminal's services (this is exactly what
   * the app does — the logged-in session decides the workstation).
   */
  const useTerminalSession = (
    localWsId: string,
    username: string,
    token: string,
    sessionId: string,
  ): void => {
    useLocalSessionStore.getState().setSession({
      userId: SERVER_USER_ID,
      username,
      fullName: "POS Multi Integration Cashier",
      displayName: "POS Multi Integration Cashier",
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

  const makeTerminalServices = (
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

  const drainServerQueue = async (): Promise<void> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < 10; i++) {
      await job.processPendingOperations();
      // FAILED rows WITHOUT nextRetryAt are permanent rejections (e.g. the
      // documented global-shift duplicate) — they must not block the drain.
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

  it("applies sales from both terminals to the shared server lot without cross-terminal interference", async () => {
    // ── Terminal A: open shift + sell 1 unit ────────────────────────────
    useTerminalSession(
      POS_WS_A_ID,
      USERNAME,
      tokenA,
      "pos-int-multi-session-a",
    );
    const servicesA = makeTerminalServices(localPrismaA);
    salesPosA = servicesA.salesPos;
    cashShiftA = servicesA.cashShift;

    const shiftA = await cashShiftA.openShift({
      openingBalance: new Prisma.Decimal("100000"),
    });
    expect(shiftA.state).toBe("OPEN");

    const saleA = (await salesPosA.create({
      items: [{ productId: PRODUCT_ID, quantity: SALE_QTY_A }],
    })) as { id: string };
    await salesPosA.confirm(saleA.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: TOTAL_A }],
    });

    // ── Terminal B: open shift + sell 2 units ───────────────────────────
    useTerminalSession(
      POS_WS_B_ID,
      USERNAME,
      tokenB,
      "pos-int-multi-session-b",
    );
    const servicesB = makeTerminalServices(localPrismaB);
    salesPosB = servicesB.salesPos;
    cashShiftB = servicesB.cashShift;

    const shiftB = await cashShiftB.openShift({
      openingBalance: new Prisma.Decimal("200000"),
    });
    expect(shiftB.state).toBe("OPEN");

    const saleB = (await salesPosB.create({
      items: [{ productId: PRODUCT_ID, quantity: SALE_QTY_B }],
    })) as { id: string };
    await salesPosB.confirm(saleB.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: TOTAL_B }],
    });

    // ── Both terminals push their own outbox with their own token ───────
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

    const resultA = await pushA.pushPending();
    expect(resultA.pushed).toBe(2); // SHIFT_OPEN + SALE_CONFIRMATION
    expect(resultA.accepted).toBe(2);

    const resultB = await pushB.pushPending();
    expect(resultB.pushed).toBe(2);
    // The GLOBAL shift model (see handleShiftOpen): terminal A's SHIFT_OPEN
    // created THE store-wide shift, so terminal B's own SHIFT_OPEN replay is
    // rejected as a duplicate (ShiftAlreadyOpenException) — only its sale is
    // accepted. B's sale then joins the global shift via the sale-replay
    // bootstrap, exactly as the documented flow prescribes.
    expect(resultB.accepted).toBe(1);

    // B's local outbox marks the rejected SHIFT_OPEN as PERMANENT_FAILURE
    // (no retry — the store already has its shift) and the sale as COMPLETED.
    const localShiftOpenB = await localPrismaB.syncQueue.findFirstOrThrow({
      where: { operationType: "SHIFT_OPEN" },
    });
    expect(localShiftOpenB.status).toBe("PERMANENT_FAILURE");
    expect(localShiftOpenB.lastErrorMessage).toContain(
      "already open for this store",
    );

    // Replay the sales like the real deployment's cron does.
    await drainServerQueue();

    // ── Server: BOTH sales exist, each attributed to its workstation ────
    const serverSaleA = await serverPrisma.sale.findFirstOrThrow({
      where: {
        sourceWorkstationId: SERVER_WS_A_ID,
        cashShift: { workstationId: SERVER_WS_A_ID },
      },
      include: { items: true },
    });
    expect(serverSaleA.operationalState).toBe("CONFIRMED");
    expect(Number(serverSaleA.totalAmount)).toBe(TOTAL_A);
    // Each terminal keeps its OWN local numbering — both start at 1 and the
    // server must preserve that per-workstation sequence.
    expect(Number(serverSaleA.localNumber)).toBe(1);

    const serverSaleB = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_B_ID },
      include: { items: true },
    });
    expect(serverSaleB.operationalState).toBe("CONFIRMED");
    expect(Number(serverSaleB.totalAmount)).toBe(TOTAL_B);
    expect(Number(serverSaleB.localNumber)).toBe(1);
    // Global shift model: B's sale is attached to THE store-wide shift (the
    // one A opened) by the sale-replay bootstrap — B's own local shift id was
    // never created server-side.
    expect(serverSaleB.cashShiftId).toBe(shiftA.id);

    // ── Convergence: the SHARED lot absorbed both consumptions ──────────
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(
      LOT_INITIAL_STOCK - SALE_QTY_A - SALE_QTY_B,
    ); // 47

    // ── Invoice numbering follows the GLOBAL shift, not the pushing terminal ──
    // salesService.create stamps sale.workstationId = cashShift.workstationId
    // (the shift owner). B's sale joined A's global shift, so its invoice is
    // numbered from A's allocation. DESIGN CONSEQUENCE (documented here):
    // under the global-shift model the shift-opening workstation's DIAN range
    // numbers every sale of the store for that shift; other workstations'
    // allocations stay untouched until they open a shift themselves.
    const invoiceA = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: { saleId: serverSaleA.id, documentType: "INVOICE" },
    });
    expect(invoiceA.fullNumber).toBe("POS-INTA1");
    expect(invoiceA.resolutionId).toBe(SERVER_RESOLUTION_A_ID);

    const invoiceB = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: { saleId: serverSaleB.id, documentType: "INVOICE" },
    });
    // B's sale is numbered by A's resolution (global shift owner), as 2nd
    // consecutive of A's range — NOT "POS-INTB1".
    expect(invoiceB.fullNumber).toBe("POS-INTA2");
    expect(invoiceB.resolutionId).toBe(SERVER_RESOLUTION_A_ID);

    const allocationA =
      await serverPrisma.fiscalResolutionAllocation.findUniqueOrThrow({
        where: { id: SERVER_ALLOCATION_A_ID },
      });
    const allocationB =
      await serverPrisma.fiscalResolutionAllocation.findUniqueOrThrow({
        where: { id: SERVER_ALLOCATION_B_ID },
      });
    expect(allocationA.currentConsecutive).toBe(2); // both sales
    expect(allocationB.currentConsecutive).toBe(0); // untouched

    // ── clientSequence identity is scoped PER WORKSTATION ───────────────
    // Both terminals started their outbox at sequence 1 (SHIFT_OPEN) and 2
    // (SALE_CONFIRMATION). The server must have stored FOUR distinct rows —
    // a global (cross-terminal) sequence key would have collided.
    const queueRows = await serverPrisma.syncQueue.findMany({
      where: {
        subscriptionId,
        operationType: { in: ["SHIFT_OPEN", "SALE_CONFIRMATION"] },
      },
      select: {
        sourceWorkstationId: true,
        clientSequence: true,
        status: true,
        operationType: true,
      },
    });
    const fromA = queueRows.filter(
      (r) => r.sourceWorkstationId === SERVER_WS_A_ID,
    );
    const fromB = queueRows.filter(
      (r) => r.sourceWorkstationId === SERVER_WS_B_ID,
    );
    expect(fromA).toHaveLength(2);
    expect(fromB).toHaveLength(2);
    // The actual collision case: the SAME clientSequence values from two
    // different workstations coexist as separate operations.
    expect(fromA.map((r) => Number(r.clientSequence)).sort()).toEqual([1, 2]);
    expect(fromB.map((r) => Number(r.clientSequence)).sort()).toEqual([1, 2]);
    // A's operations fully applied; B's SHIFT_OPEN is the documented
    // permanent rejection (global shift already open), its sale applied.
    expect(fromA.every((r) => r.status === "COMPLETED")).toBe(true);
    const bByType = new Map(
      fromB.map((r) => [r.operationType, r.status] as const),
    );
    expect(bByType.get("SHIFT_OPEN")).toBe("FAILED");
    expect(bByType.get("SALE_CONFIRMATION")).toBe("COMPLETED");

    // ── A's shift arrived with its id, owned by A ────────────────────────
    const serverShiftA = await serverPrisma.cashShift.findUniqueOrThrow({
      where: { id: shiftA.id },
    });
    expect(serverShiftA.workstationId).toBe(SERVER_WS_A_ID);
    // B's local shift id must NOT exist server-side (rejected replay).
    const serverShiftBCount = await serverPrisma.cashShift.count({
      where: { id: shiftB.id },
    });
    expect(serverShiftBCount).toBe(0);

    // ── Terminal A's local outbox fully COMPLETED ──────────────────────
    const entriesA = await localPrismaA.syncQueue.findMany({
      where: { operationType: { in: ["SHIFT_OPEN", "SALE_CONFIRMATION"] } },
      select: { status: true },
    });
    expect(entriesA).toHaveLength(2);
    expect(entriesA.every((e) => e.status === "COMPLETED")).toBe(true);
  }, 120000);

  it("leaves no pending operation on either terminal", async () => {
    for (const prisma of [localPrismaA, localPrismaB]) {
      const pending = await prisma.syncQueue.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      });
      expect(pending).toBe(0);
    }
  });
});
