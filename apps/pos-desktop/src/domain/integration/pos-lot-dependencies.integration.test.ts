/**
 * POS ↔ Server integration — lot dependency ordering between operations.
 *
 * Same real-code harness as pos-server-replay.integration.test.ts:
 * real PGlite + real local Prisma + real POS domain services on one side,
 * real NestJS AppModule over real HTTP against the migrated Postgres test
 * database (RLS on) on the other. The only bridge is the wire contract.
 *
 * Lot identity model exercised here (the "modalidades" this spec exists for):
 *
 *   1. LOTS SHARE IDS: when a workstation confirms a purchase reception, the
 *      POS either adopts a lot it already knows (pulled from the server) or
 *      creates a local lot with its own UUID. The sync payload carries the
 *      lot snapshot (`lot: { batchNumber, ... }`) and the server's
 *      `resolveLotForSync` uses the POS lot id as the server lot id when one
 *      is supplied. So the SAME lot id must exist on both sides after a
 *      reception replay — and a subsequent sale referencing that lot must
 *      consume the server lot that the reception created.
 *
 *   2. NO REMAP FOR LOTS: unlike products (sourceProductId indirection) and
 *      sales (localSaleItemId adoption), lot ids are used as-is. If the POS
 *      ever sold from a lot the server has never seen, the sale replay can
 *      only succeed if the server can materialize the lot — which the sale
 *      payload does NOT carry (no lot data on SALE_CONFIRMATION items).
 *
 *   3. ACQUISITION COST: the server-side sale replay resolves the lot's unit
 *      cost through the PurchaseReceptionItem that received it. A lot that
 *      exists server-side but was never received (no reception item) makes
 *      the sale fail with LotCostUnavailableException → PERMANENT_FAILURE.
 *
 * Scenarios:
 *   A. Reception → sale, in order: the server lot (created by the reception
 *      replay) backs the sale replay; stock converges to 30 − 2 and a
 *      PURCHASE_RECEIPT inventory movement exists.
 *   B. Out-of-order arrival: the SALE_CONFIRMATION is pushed BEFORE its
 *      PURCHASE_RECEPTION_CONFIRMATION. The sale fails fast (lot missing →
 *      DomainException → PERMANENT_FAILURE); once the reception lands, the
 *      lot exists server-side and the (already permanently failed) sale
 *      stays failed — a documented ordering hazard of the current design.
 *   C. Sale of a lot that exists but was never received server-side
 *      (no acquisition cost) fails with a cost-unavailable error.
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
import {
  SalesPosService,
  createSalesPosService,
} from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";
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

const SERVER_WS_ID = uuidFrom("pos-int-lotdep-server-ws");
const SERVER_USER_ID = "pos-int-lotdep-server-user-id";
const USERNAME = "pos-int-lotdep@pos.test";
const PASSWORD = "PosIntegration123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-lotdep-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-lotdep-pm-cash");
const SERVER_SUPPLIER_ID = uuidFrom("pos-int-lotdep-supplier");
// Server-side product for scenario A (shared id with the POS, like a
// pulled catalog product in an established pharmacy).
const SERVER_PRODUCT_A_ID = uuidFrom("pos-int-lotdep-product-a");
// Server-side products for scenarios B and C. Only their local (POS) ids
// exist in the payload; the local rows carry serverId = server product id.
const LOCAL_PRODUCT_B_ID = uuidFrom("pos-int-lotdep-product-b");
const LOCAL_PRODUCT_C_ID = uuidFrom("pos-int-lotdep-product-c");
// Server product ids backing the local B/C rows (Product.sourceProductId
// indirection is NOT needed here: sale payloads reference the server id
// because the local rows have serverId set, mirroring a pulled product).
const SERVER_PRODUCT_B_ID = uuidFrom("pos-int-lotdep-server-product-b");
const SERVER_PRODUCT_C_ID = uuidFrom("pos-int-lotdep-server-product-c");

// Unit prices are shared per product across both sides.
const UNIT_PRICE_A = 12000;
const UNIT_PRICE_B = 9000;
const UNIT_PRICE_C = 7000;

// Every sale produces a DIAN INVOICE, which consumes a consecutive from the
// workstation's active FiscalResolutionAllocation — seed a real one.
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-lotdep-fiscal-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-lotdep-fiscal-allocation");

const POS_WS_ID = "pos-int-lotdep-ws-0001";
const POS_USER_ID = SERVER_USER_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;

// ---------------------------------------------------------------------------
// Cleanup helpers — the test DB is shared; every id is scoped to this suite.
// ---------------------------------------------------------------------------

describe("POS ↔ Server integration — lot dependency ordering", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClient>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let salesPos: SalesPosService;
  let receptions: ReturnType<typeof createPurchaseReceptionsService>;

  const serverProductIds = [
    SERVER_PRODUCT_A_ID,
    SERVER_PRODUCT_B_ID,
    SERVER_PRODUCT_C_ID,
  ];
  const drainServerQueue = async (
    operationType: string,
    wantStatus: "COMPLETED" | "FAILED" | "PERMANENT_FAILURE",
    attemptsWithPolling = 10,
  ): Promise<{ status: string; lastErrorMessage: string | null }> => {
    const job = serverApp.get(SyncProcessingJob);
    for (let i = 0; i < attemptsWithPolling; i++) {
      await job.processPendingOperations();
      const entry = await serverPrisma.syncQueue.findFirst({
        where: { operationType, sourceWorkstationId: SERVER_WS_ID },
        orderBy: { receivedAt: "desc" },
        select: { status: true, lastErrorMessage: true },
      });
      if (entry && entry.status === wantStatus) {
        return {
          status: entry.status,
          lastErrorMessage: entry.lastErrorMessage,
        };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const entry = await serverPrisma.syncQueue.findFirst({
      where: { operationType, sourceWorkstationId: SERVER_WS_ID },
      orderBy: { receivedAt: "desc" },
      select: { status: true, lastErrorMessage: true },
    });
    return {
      status: entry?.status ?? "(no entry)",
      lastErrorMessage: entry?.lastErrorMessage ?? null,
    };
  };

  /** Returns the single SaleItemLot's lotId recorded locally for a sale. */
  const saleItemLotOf = async (saleId: string): Promise<string | null> => {
    const row = await localPrisma.saleItemLot.findFirst({
      where: { saleItem: { saleId } },
      select: { lotId: true },
    });
    return row?.lotId ?? null;
  };

  beforeAll(async () => {
    // =====================================================================
    // 1. SERVER — real NestJS app on a real port, real Postgres
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, "pos-int-lotdep");

    // ── Seed the server-side world ──────────────────────────────────────
    // (children-first deletes, mirroring the pos-server-replay harness)
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });

    const serverLots = await serverPrisma.lot.findMany({
      where: { productId: { in: serverProductIds } },
      select: { id: true },
    });
    const lotIds = serverLots.map((l) => l.id);

    // Sale-side cleanup for the workstation
    await serverPrisma.saleItemLot.deleteMany({
      where: { saleItem: { sale: { cashShift: { workstationId: SERVER_WS_ID } } } },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: SERVER_WS_ID } } },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: SERVER_WS_ID } } },
    });
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId, resolutionId: SERVER_RESOLUTION_ID },
    });
    await serverPrisma.sale.deleteMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });

    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: { in: lotIds } },
    });
    await serverPrisma.lot.deleteMany({
      where: { id: { in: lotIds } },
    });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { productId: { in: serverProductIds } },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { supplierId: SERVER_SUPPLIER_ID },
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
    for (const productId of serverProductIds) {
      await serverPrisma.productPriceHistory.deleteMany({
        where: { productId },
      });
      await serverPrisma.productCostHistory.deleteMany({
        where: { productId },
      });
      await serverPrisma.productTaxHistory.deleteMany({
        where: { productId },
      });
      await serverPrisma.productBarcode.deleteMany({ where: { productId } });
      await serverPrisma.product.deleteMany({ where: { id: productId } });
    }
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
    await serverPrisma.workstation.deleteMany({ where: { id: SERVER_WS_ID } });

    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS LotDep Workstation",
        code: "WS-POS-LOTDEP-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS LotDep Cashier",
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
        code: "POS-INT-LOTDEP-IVA19",
        name: "POS LotDep IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    // Products A, B, C on the server. B and C exist so the SALE payload's
    // server-id references resolve; their lots are intentionally NOT seeded
    // (they arrive via PURCHASE_RECEPTION_CONFIRMATION, or never).
    const productSeeds = [
      { id: SERVER_PRODUCT_A_ID, code: "POS-INT-LOTDEP-A", name: "LotDep Product A", price: UNIT_PRICE_A },
      { id: SERVER_PRODUCT_B_ID, code: "POS-INT-LOTDEP-B", name: "LotDep Product B", price: UNIT_PRICE_B },
      { id: SERVER_PRODUCT_C_ID, code: "POS-INT-LOTDEP-C", name: "LotDep Product C", price: UNIT_PRICE_C },
    ];
    for (const seed of productSeeds) {
      await serverPrisma.product.create({
        data: {
          id: seed.id,
          subscriptionId,
          internalCode: seed.code,
          commercialName: seed.name,
          laboratory: "E2E Lab",
          saleType: "FREE_SALE",
          isActive: true,
          createdById: SERVER_USER_ID,
        },
      });
      const priceHistory = await serverPrisma.productPriceHistory.create({
        data: {
          id: uuidFrom(`${seed.id}-price`),
          subscriptionId,
          productId: seed.id,
          price: new Prisma.Decimal(seed.price),
          effectiveFrom: new Date(),
          changedById: SERVER_USER_ID,
          changedAt: new Date(),
        },
      });
      const taxHistory = await serverPrisma.productTaxHistory.create({
        data: {
          id: uuidFrom(`${seed.id}-tax`),
          subscriptionId,
          productId: seed.id,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          effectiveFrom: new Date(),
          changedById: SERVER_USER_ID,
          changedAt: new Date(),
        },
      });
      await serverPrisma.product.update({
        where: { id: seed.id },
        data: {
          currentPriceId: priceHistory.id,
          currentTaxHistoryId: taxHistory.id,
        },
      });
    }

    // DIAN authorization for the workstation.
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000998877",
        documentType: "INVOICE",
        prefix: "LOTDEP",
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
        internalCode: "POS-INT-LOTDEP-CASH",
        name: "POS LotDep Cash",
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

    // The local tax scheme must exist before product tax histories.
    await localPrisma.taxScheme.create({
      data: {
        id: SERVER_TAX_SCHEME_ID,
        code: "IVA-19",
        name: "IVA 19",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: now,
        createdById: POS_USER_ID,
      },
    });

    // Local mirror: product A (shared id — pulled product), products B and C
    // (local rows whose serverId points at the server rows, so SALE payloads
    // carry the server ids directly, like an established pharmacy).
    const localProductSeeds = [
      { localId: SERVER_PRODUCT_A_ID, serverId: SERVER_PRODUCT_A_ID, code: "POS-INT-LOTDEP-A", name: "LotDep Product A", price: UNIT_PRICE_A },
      { localId: LOCAL_PRODUCT_B_ID, serverId: SERVER_PRODUCT_B_ID, code: "POS-INT-LOTDEP-B", name: "LotDep Product B", price: UNIT_PRICE_B },
      { localId: LOCAL_PRODUCT_C_ID, serverId: SERVER_PRODUCT_C_ID, code: "POS-INT-LOTDEP-C", name: "LotDep Product C", price: UNIT_PRICE_C },
    ];
    for (const seed of localProductSeeds) {
      await localPrisma.product.create({
        data: {
          id: seed.localId,
          serverId: seed.serverId,
          internalCode: seed.code,
          commercialName: seed.name,
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
          id: uuidFrom(`${seed.localId}-local-price`),
          productId: seed.localId,
          price: new Prisma.Decimal(seed.price),
          effectiveFrom: now,
          changedById: POS_USER_ID,
          changedAt: now,
        },
      });
      await localPrisma.productTaxHistory.create({
        data: {
          id: uuidFrom(`${seed.localId}-local-tax`),
          productId: seed.localId,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          effectiveFrom: now,
          changedById: POS_USER_ID,
          changedAt: now,
        },
      });
    }

    // The supplier the receptions reference (exists on both sides, as after
    // a catalog pull).
    await localPrisma.supplier.create({
      data: {
        id: SERVER_SUPPLIER_ID,
        identificationType: "NIT",
        identificationNumber: "900123456-9",
        businessName: "LotDep Supplier",
        isActive: true,
        createdById: POS_USER_ID,
        createdAt: now,
        updatedAt: now,
      },
    });

    await localPrisma.paymentMethod.create({
      data: {
        id: PM_CASH_ID,
        internalCode: "POS-INT-LOTDEP-CASH",
        name: "POS LotDep Cash",
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
      fullName: "POS LotDep Cashier",
      displayName: "POS LotDep Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-int-lotdep",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-int-lotdep-session-1",
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
    receptions = createPurchaseReceptionsService(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
  }, 120000);

  afterAll(async () => {
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();

    if (serverPrisma) {
      const serverLots = await serverPrisma.lot.findMany({
        where: { productId: { in: serverProductIds } },
        select: { id: true },
      });
      const lotIds = serverLots.map((l) => l.id);

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
      await serverPrisma.fiscalDocument.deleteMany({
        where: {
          subscriptionId: subscriptionId!,
          resolutionId: SERVER_RESOLUTION_ID,
        },
      });
      await serverPrisma.sale.deleteMany({
        where: { cashShift: { workstationId: SERVER_WS_ID } },
      });
      await serverPrisma.cashShift.deleteMany({
        where: { workstationId: SERVER_WS_ID },
      });
      await serverPrisma.inventoryMovement.deleteMany({
        where: { lotId: { in: lotIds } },
      });
      await serverPrisma.lot.deleteMany({ where: { id: { in: lotIds } } });
      await serverPrisma.purchaseReceptionItem.deleteMany({
        where: { productId: { in: serverProductIds } },
      });
      await serverPrisma.purchaseReception.deleteMany({
        where: { supplierId: SERVER_SUPPLIER_ID },
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
      for (const productId of serverProductIds) {
        await serverPrisma.productPriceHistory.deleteMany({
          where: { productId },
        });
        await serverPrisma.productCostHistory.deleteMany({
          where: { productId },
        });
        await serverPrisma.productTaxHistory.deleteMany({
          where: { productId },
        });
        await serverPrisma.productBarcode.deleteMany({ where: { productId } });
        await serverPrisma.product.deleteMany({ where: { id: productId } });
      }
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

  it("reception replay materializes the POS lot server-side and the sale consumes it", async () => {
    const step = (msg: string): void =>
      console.log(`[lotdep] ${new Date().toISOString()} ${msg}`);

    // ── Step 1: open the local shift ────────────────────────────────────
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await cashShift.openShift({ openingBalance: new Prisma.Decimal("100000") });

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });

    // ── Step 2: real reception on the POS ───────────────────────────────
    // A draft reception for product A with a fresh batch, then confirm it.
    // confirmReception creates the local lot and enqueues the
    // PURCHASE_RECEPTION_CONFIRMATION whose payload carries the lot snapshot.
    step("step 2: creating + confirming reception (real code)");
    const reception = await receptions.createReception({
      supplierId: SERVER_SUPPLIER_ID,
      items: [
        {
          productId: SERVER_PRODUCT_A_ID,
          receivedQuantity: 30,
          lotNumber: "LOTDEP-BATCH-1",
          expirationDate: "2027-06-30",
          realUnitCost: 6500,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          taxRate: 19,
        },
      ],
    });
    const confirmedReception = await receptions.confirmReception(reception.id);
    expect(confirmedReception.state).toBe("CONFIRMED");
    expect(confirmedReception.items[0].lotId).toBeTruthy();
    const posLotId = confirmedReception.items[0].lotId as string;

    // Local stock: 30 units on the new lot.
    const posLot = await localPrisma.lot.findUniqueOrThrow({
      where: { id: posLotId },
    });
    expect(posLot.currentStock).toBe(30);

    // ── Step 3: push + drain → reception replayed server-side ──────────
    step("step 3: pushing reception");
    const pushResult = await push.pushPending();
    expect(pushResult.accepted).toBeGreaterThanOrEqual(1);
    const receptionStatus = await drainServerQueue(
      "PURCHASE_RECEPTION_CONFIRMATION",
      "COMPLETED",
    );
    expect(receptionStatus.status).toBe("COMPLETED");

    // Server database: the SAME lot id exists, with the reception's stock.
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: posLotId },
    });
    expect(serverLot.productId).toBe(SERVER_PRODUCT_A_ID);
    expect(serverLot.batchNumber).toBe("LOTDEP-BATCH-1");
    expect(serverLot.currentStock).toBe(30);
    const serverReceptionItem = await serverPrisma.purchaseReceptionItem
      .findFirstOrThrow({
        where: { lotId: posLotId },
      });
    expect(Number(serverReceptionItem.realUnitCost)).toBe(6500);
    const receiptMovement = await serverPrisma.inventoryMovement
      .findFirstOrThrow({
        where: { lotId: posLotId, movementType: "PURCHASE_RECEIPT" },
      });
    expect(receiptMovement.resultingStock).toBe(30);

    // ── Step 4: sell 2 units of the received batch ─────────────────────
    step("step 4: creating + confirming sale of the received lot");
    const sale = (await salesPos.create({
      items: [{ productId: SERVER_PRODUCT_A_ID, quantity: 2 }],
    })) as { id: string };
    const saleTotal = Math.round(2 * UNIT_PRICE_A * 1.19);
    await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: saleTotal }],
    });

    // FIFO must have consumed exactly the received batch (the only one).
    const saleItemLot = await localPrisma.saleItemLot.findFirstOrThrow({
      where: { saleItem: { saleId: sale.id } },
    });
    expect(saleItemLot.lotId).toBe(posLotId);
    expect(await localPrisma.lot.findUnique({
      where: { id: posLotId },
      select: { currentStock: true },
    }).then((l) => l?.currentStock)).toBe(28);

    // ── Step 5: push + drain → sale replayed against the SAME lot ──────
    step("step 5: pushing sale");
    const salePush = await push.pushPending();
    expect(salePush.accepted).toBeGreaterThanOrEqual(1);
    const saleStatus = await drainServerQueue("SALE_CONFIRMATION", "COMPLETED");
    expect(saleStatus.status).toBe("COMPLETED");

    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_ID },
      include: { items: { include: { lots: true } } },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    expect(serverSale.items).toHaveLength(1);
    expect(serverSale.items[0].productId).toBe(SERVER_PRODUCT_A_ID);
    // The sale consumed the SAME lot id the reception created server-side.
    expect(serverSale.items[0].lots).toHaveLength(1);
    expect(serverSale.items[0].lots[0].lotId).toBe(posLotId);
    expect(serverSale.items[0].lots[0].quantity).toBe(2);

    // Converged stock: 30 − 2 on both sides.
    const serverLotAfter = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: posLotId },
    });
    expect(serverLotAfter.currentStock).toBe(28);

    // ── Step 6: the local outbox drained ────────────────────────────────
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  }, 120000);

  it("sale pushed BEFORE its lot's reception fails permanently and stays failed after the reception lands", async () => {
    // ── Step 1: sell product B locally — its lot exists ONLY on the POS ─
    const lotB = await localPrisma.lot.create({
      data: {
        id: uuidFrom("pos-int-lotdep-local-lot-b"),
        productId: LOCAL_PRODUCT_B_ID,
        batchNumber: "LOTDEP-BATCH-B",
        expirationDate: new Date("2027-09-30"),
        entryDate: new Date(),
        state: "ACTIVE",
        currentStock: 10,
        version: 0,
      },
    });

    const saleB = (await salesPos.create({
      items: [{ productId: LOCAL_PRODUCT_B_ID, quantity: 1 }],
    })) as { id: string };
    const saleBTotal = Math.round(1 * UNIT_PRICE_B * 1.19);
    await salesPos.confirm(saleB.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: saleBTotal }],
    });
    expect(await saleItemLotOf(saleB.id)).toBe(lotB.id);

    // ── Step 2: push ONLY the sale (hold the reception back) ───────────
    // Scenario B of the modalidades: the SALE_CONFIRMATION arrives before
    // the PURCHASE_RECEPTION_CONFIRMATION that would materialize its lot.
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const salePush = await push.pushPending();
    expect(salePush.accepted).toBeGreaterThanOrEqual(1);

    const saleStatus = await drainServerQueue(
      "SALE_CONFIRMATION",
      "PERMANENT_FAILURE",
    );
    // The lot genuinely does not exist server-side and the sale payload
    // carries no lot data → DomainException → no retry can ever fix it.
    expect(saleStatus.status).toBe("PERMANENT_FAILURE");

    // Server: no sale, no lot for product B yet.
    const serverSaleCount = await serverPrisma.sale.count({
      where: { sourceWorkstationId: SERVER_WS_ID },
    });
    // (sale A from the previous test is the only one)
    expect(serverSaleCount).toBe(1);
    const serverLotBCount = await serverPrisma.lot.count({
      where: { productId: SERVER_PRODUCT_B_ID },
    });
    expect(serverLotBCount).toBe(0);

    // ── Step 3: NOW the reception lands with the same lot id ───────────
    const receptionB = await receptions.createReception({
      supplierId: SERVER_SUPPLIER_ID,
      items: [
        {
          productId: LOCAL_PRODUCT_B_ID,
          receivedQuantity: 10,
          lotNumber: "LOTDEP-BATCH-B",
          expirationDate: "2027-09-30",
          realUnitCost: 5000,
          taxSchemeId: SERVER_TAX_SCHEME_ID,
          taxRate: 19,
        },
      ],
    });
    const confirmedB = await receptions.confirmReception(receptionB.id);
    const posLotBId = confirmedB.items[0].lotId as string;

    const receptionPush = await push.pushPending();
    expect(receptionPush.accepted).toBeGreaterThanOrEqual(1);
    const receptionStatus = await drainServerQueue(
      "PURCHASE_RECEPTION_CONFIRMATION",
      "COMPLETED",
    );
    expect(receptionStatus.status).toBe("COMPLETED");

    // The lot now exists server-side — but with the POS-created UUID, while
    // the failed sale never referenced any lot the server could adopt. The
    // sale remains PERMANENT_FAILURE: the ordering gap is NOT self-healing.
    const stillFailed = await serverPrisma.syncQueue.findFirstOrThrow({
      where: {
        operationType: "SALE_CONFIRMATION",
        sourceWorkstationId: SERVER_WS_ID,
        payload: { contains: saleB.id },
      },
      select: { status: true },
    });
    expect(stillFailed.status).toBe("PERMANENT_FAILURE");

    // The lot itself DID arrive (shared id semantics). Stock converges with
    // the POS: snapshot stock at confirmation (10 − 1 sold = 9) + the 10
    // received units.
    const serverLotB = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: posLotBId },
    });
    expect(serverLotB.currentStock).toBe(19);
  }, 120000);

  it("sale of a lot that exists server-side without acquisition cost fails with a cost error", async () => {
    // ── Step 1: product C — seed a server lot with NO reception item ────
    // (the manual lot an admin created directly on the server: no cost)
    await serverPrisma.lot.create({
      data: {
        id: uuidFrom("pos-int-lotdep-server-lot-c"),
        subscriptionId,
        productId: SERVER_PRODUCT_C_ID,
        batchNumber: "LOTDEP-BATCH-C",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date("2026-01-01"),
        state: "ACTIVE",
        currentStock: 20,
        version: 0,
      },
    });

    // ── Step 2: sell product C locally and push ────────────────────────
    const lotC = await localPrisma.lot.create({
      data: {
        id: uuidFrom("pos-int-lotdep-local-lot-c"),
        productId: LOCAL_PRODUCT_C_ID,
        batchNumber: "LOTDEP-BATCH-C",
        expirationDate: new Date("2027-12-31"),
        entryDate: new Date(),
        state: "ACTIVE",
        currentStock: 20,
        version: 0,
      },
    });

    const saleC = (await salesPos.create({
      items: [{ productId: LOCAL_PRODUCT_C_ID, quantity: 1 }],
    })) as { id: string };
    const saleCTotal = Math.round(1 * UNIT_PRICE_C * 1.19);
    await salesPos.confirm(saleC.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: saleCTotal }],
    });
    expect(await saleItemLotOf(saleC.id)).toBe(lotC.id);

    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    await push.pushPending();
    const saleStatus = await drainServerQueue("SALE_CONFIRMATION", "PERMANENT_FAILURE");
    expect(saleStatus.status).toBe("PERMANENT_FAILURE");
    // The failure is about the cost chain, not the lot itself.
    expect(saleStatus.lastErrorMessage ?? "").toMatch(/cost/i);

    // Server lot untouched: the failed replay consumed nothing.
    const serverLotC = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: uuidFrom("pos-int-lotdep-server-lot-c") },
    });
    expect(serverLotC.currentStock).toBe(20);
  }, 120000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
