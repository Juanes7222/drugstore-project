/**
 * POS ↔ Server integration — MULTI-POS price propagation.
 *
 * Two REAL POS workstations (two independent PGlite databases) sync against
 * the same real NestJS server. Workstation A changes a product's price with
 * the REAL POS product service (PRODUCT_UPDATE outbox entry → push → server
 * replay creating a new ProductPriceHistory). Workstation B — which knows
 * nothing about A — pulls the catalog incrementally (updatedSince cursor)
 * and must converge to the new price without duplicating history rows.
 *
 * This is the production "price change at the backoffice/workstation A
 * reaches every register" scenario exercised end to end:
 *
 *   POS A (PGlite) --PRODUCT_UPDATE--> server (Postgres) --pull--> POS B (PGlite)
 *
 * Verified invariants
 * -------------------
 * - The price change leaves POS A only through the sync pipeline (no direct
 *   server writes from A's side), replayed by the real dispatcher.
 * - POS B's INCREMENTAL pull (second pull, with the updatedSince cursor)
 *   picks up the changed product — the `updatedAt` filter on the server's
 *   sync endpoint actually fires after a replayed PRODUCT_UPDATE.
 * - POS B converges to the new price: currentPriceId points at the NEW
 *   price history row (same id the server created), no duplicated rows.
 * - The guard against clobbering pending local edits on B is respected:
 *   B has no pending PRODUCT_UPDATE for this product, so the server wins.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import {
  PrismaClient as LocalPrismaClient,
  Prisma,
} from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import request from "../../../../../node_modules/.pnpm/node_modules/supertest/index.js";
import { Test } from "../../../../../node_modules/.pnpm/node_modules/@nestjs/testing";
import * as argon2 from "../../../../../node_modules/.pnpm/node_modules/argon2";
import { createRequire } from "node:module";
const serverRequire = createRequire(import.meta.url);
const { PrismaClient: ServerPrismaClient } = serverRequire(
  "../../../../server/test/generated/database-cjs/database.cjs",
) as {
  PrismaClient: new (args: Record<string, unknown>) => ServerPrismaClientType;
};
const { PrismaPg } = serverRequire(
  "../../../../../node_modules/.pnpm/node_modules/@prisma/adapter-pg",
) as { PrismaPg: new (args: Record<string, unknown>) => unknown };

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
const { HttpExceptionFilter } =
  await import("../../../../server/src/common/filters/http-exception.filter");
const { TenantContextInterceptor } =
  await import("../../../../server/src/modules/tenant/tenant-context.interceptor");
const { SyncProcessingJob } =
  await import("../../../../server/src/modules/sync/jobs/sync-processing.job");
const { seedSubscription } =
  await import("../../../../server/test/helpers/subscription-seed");

import { createCatalogSyncService } from "../catalog/catalog-sync.service";
import { createLotSyncService } from "../inventory-lots/lot-sync.service";
import { createClientPullService } from "../clients/client-pull.service";
import { useLocalSessionStore } from "../auth/local-session.store";
import { createProductService } from "../catalog/product.service";

type ServerPrismaClientType = import("@pharmacy/database").PrismaClient;

const uuidFrom = (seed: string): string => {
  const h = Array.from(seed).reduce(
    (acc, c) => ((acc * 31 + c.charCodeAt(0)) | 0) >>> 0,
    7,
  );
  const hex = h.toString(16).padStart(8, "0").repeat(4);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
};

const SUB_SEED = "pos-int-mppull";
const SERVER_WS_ID = uuidFrom("pos-int-mppull-server-ws");
const SERVER_USER_ID = "pos-int-mppull-server-user-id";
const USERNAME = "pos-int-mppull@pos.test";
const PASSWORD = "PosMpPull123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-mppull-tax-scheme");
const SERVER_CATEGORY_ID = uuidFrom("pos-int-mppull-category");
const SERVER_FORM_ID = uuidFrom("pos-int-mppull-form");
const SERVER_PRODUCT_ID = uuidFrom("pos-int-mppull-product");
const SERVER_PRICE_HISTORY_ID = uuidFrom("pos-int-mppull-price-hist");
const SERVER_TAX_HISTORY_ID = uuidFrom("pos-int-mppull-tax-hist");
const SERVER_BARCODE_ID = uuidFrom("pos-int-mppull-barcode");
const SERVER_LOT_ID = uuidFrom("pos-int-mppull-lot");
const UNIT_PRICE = 12500;
const NEW_PRICE = 18000;

// Each POS is its own workstation with its own PGlite database.
type PosNode = {
  wsId: string;
  pg: PGlite;
  prisma: LocalPrismaClient;
  token: string;
};

const buildPosSession = (wsId: string): void => {
  useLocalSessionStore.getState().setSession({
    userId: SERVER_USER_ID,
    username: USERNAME,
    fullName: "POS MpPull Cashier",
    displayName: "POS MpPull Cashier",
    role: "ADMIN",
    subscriptionId,
    workstationId: wsId,
    accessToken: "",
    refreshToken: `refresh-token-${wsId}`,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    sessionId: `pos-int-mppull-session-${wsId}`,
    totpEnabled: false,
    sessionTrust: "SERVER_VERIFIED",
    offlineToken: null,
    locationIds: [],
  });
};

/**
 * Reset the pull cursors before a node's FIRST pull.
 *
 * The cursors live in localStorage scoped by the local database's install
 * id. That machinery is a module singleton wired to the real Tauri database
 * (getLocalDatabaseInstallId is null in tests → one shared 'uninitialized'
 * scope), so two PGlite nodes would otherwise share one cursor and B's
 * first pull would run incrementally against A's cursor — starving B of
 * data. In production each POS has its own localStorage, so resetting
 * before the first pull reproduces that reality exactly: full pull first,
 * then genuinely incremental pulls afterwards.
 */
const resetPullCursors = (): void => {
  localStorage.removeItem("pharmacy_sync_metadata__uninitialized");
};

let subscriptionId: string;
let serverApp: INestApplication;
let serverPrisma: InstanceType<typeof ServerPrismaClientType>;
let serverPort: number;

const posA: PosNode = { wsId: "pos-int-mppull-ws-a" } as PosNode;
const posB: PosNode = { wsId: "pos-int-mppull-ws-b" } as PosNode;

const drainServerQueue = async (
  operationType: string,
  wantStatus: "COMPLETED" | "FAILED" | "PERMANENT_FAILURE",
  attemptsWithPolling = 10,
): Promise<{ status: string; lastErrorMessage: string | null }> => {
  const job = serverApp.get(SyncProcessingJob);
  const sourceWorkstationIds = [SERVER_WS_ID, posA.wsId, posB.wsId];
  for (let i = 0; i < attemptsWithPolling; i++) {
    await job.processPendingOperations();
    const entry = await serverPrisma.syncQueue.findFirst({
      where: {
        operationType,
        sourceWorkstationId: { in: sourceWorkstationIds },
      },
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
    where: {
      operationType,
      sourceWorkstationId: { in: sourceWorkstationIds },
    },
    orderBy: { receivedAt: "desc" },
    select: { status: true, lastErrorMessage: true },
  });
  return {
    status: entry?.status ?? "(no entry)",
    lastErrorMessage: entry?.lastErrorMessage ?? null,
  };
};

describe("POS ↔ Server integration — multi-POS price propagation via pull", () => {
  const spawnPos = async (node: PosNode): Promise<void> => {
    node.pg = new PGlite("memory://");
    await node.pg.exec(LOCAL_SCHEMA_SQL);
    node.prisma = new LocalPrismaClient({
      adapter: new PrismaPGlite(node.pg),
    });
    // Login per workstation: the token's session carries the workstation id,
    // which is how the server attributes pushed operations to A vs B.
    const loginRes = await request(serverApp.getHttpServer())
      .post("/auth/login")
      .send({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: "PASSWORD",
        workstationId: node.wsId,
      })
      .expect(200);
    node.token = loginRes.body.accessToken as string;
  };

  /** Full pull for one POS exactly as the scheduler tick performs it. */
  const runPulls = async (node: PosNode): Promise<void> => {
    const catalog = createCatalogSyncService(node.prisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    const lotSync = createLotSyncService(node.prisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    const clientPull = createClientPullService(node.prisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    (catalog as unknown as { accessToken: string }).accessToken = node.token;
    (lotSync as unknown as { accessToken: string }).accessToken = node.token;
    (clientPull as unknown as { accessToken: string }).accessToken = node.token;

    const catalogPayload = await catalog.fetchCatalog();
    await catalog.applyCatalog(catalogPayload);
    const lots = await lotSync.fetchLots();
    await lotSync.applyLots(lots);
    const classifications = await clientPull.fetchClassifications();
    await clientPull.applyClassifications(classifications);
    const clients = await clientPull.fetchClients();
    await clientPull.applyClients(clients);
  };

  beforeAll(async () => {
    vi.stubGlobal("navigator", { onLine: true });
    if (typeof globalThis.localStorage === "undefined") {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
    }

    // =====================================================================
    // SERVER — real NestJS app on a real port, real Postgres
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, SUB_SEED);

    // ── Cleanup (children first, scoped to this suite's ids) ────────────
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
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
    await serverPrisma.category.deleteMany({
      where: { id: SERVER_CATEGORY_ID },
    });
    await serverPrisma.pharmaceuticalForm.deleteMany({
      where: { id: SERVER_FORM_ID },
    });
    await serverPrisma.taxScheme.deleteMany({
      where: { id: SERVER_TAX_SCHEME_ID },
    });
    await serverPrisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: SERVER_USER_ID },
          { workstationId: { in: [posA.wsId, posB.wsId] } },
        ],
      },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: { in: [SERVER_WS_ID, posA.wsId, posB.wsId] } },
    });

    // ── Seed the server-side world both POS will pull ───────────────────
    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "MpPull Server WS",
        code: "WS-MPPULL-SRV",
        isActive: true,
        registeredAt: new Date(),
      },
    });
    for (const [node, code, name] of [
      [posA, "WS-MPPULL-A", "MpPull POS A"],
      [posB, "WS-MPPULL-B", "MpPull POS B"],
    ] as Array<[PosNode, string, string]>) {
      await serverPrisma.workstation.create({
        data: {
          id: node.wsId,
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
        fullName: "POS MpPull Cashier",
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
        code: "POS-INT-MPPULL-IVA19",
        name: "MpPull IVA 19%",
        taxType: "IVA",
        rate: new Prisma.Decimal("19"),
        effectiveFrom: new Date("2024-01-01"),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.category.create({
      data: {
        id: SERVER_CATEGORY_ID,
        subscriptionId,
        name: "MpPull Categoría",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.pharmaceuticalForm.create({
      data: {
        id: SERVER_FORM_ID,
        subscriptionId,
        name: "MpPull Forma",
        sortOrder: 1,
        isActive: true,
      },
    });

    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-INT-MPPULL-A",
        commercialName: "MpPull Product",
        laboratory: "MpPull Lab",
        saleType: "FREE_SALE",
        minimumStock: 5,
        isActive: true,
        categoryId: SERVER_CATEGORY_ID,
        pharmaceuticalFormId: SERVER_FORM_ID,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.productBarcode.create({
      data: {
        id: SERVER_BARCODE_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        barcode: "7701234000022",
        barcodeType: "EAN13",
        isPrimary: true,
      },
    });
    const priceHistory = await serverPrisma.productPriceHistory.create({
      data: {
        id: SERVER_PRICE_HISTORY_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date("2026-01-01"),
        changedById: SERVER_USER_ID,
        changedAt: new Date("2026-01-01"),
      },
    });
    const taxHistory = await serverPrisma.productTaxHistory.create({
      data: {
        id: SERVER_TAX_HISTORY_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        taxSchemeId: SERVER_TAX_SCHEME_ID,
        effectiveFrom: new Date("2026-01-01"),
        changedById: SERVER_USER_ID,
        changedAt: new Date("2026-01-01"),
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
        productId: SERVER_PRODUCT_ID,
        batchNumber: "MPPULL-BATCH-1",
        currentStock: 25,
        entryDate: new Date("2026-01-01"),
        expirationDate: new Date("2027-12-31"),
      },
    });

    // =====================================================================
    // Nest app bootstrap + login for both POS workstations
    // =====================================================================
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    serverApp = moduleFixture.createNestApplication();
    serverApp.useGlobalFilters(new HttpExceptionFilter());
    serverApp.useGlobalInterceptors(serverApp.get(TenantContextInterceptor));
    serverApp.useGlobalPipes(
      new (serverRequire("@nestjs/common").ValidationPipe)({ transform: true }),
    );
    await serverApp.listen(0);
    serverPort = serverApp.getHttpServer().address().port;

    await spawnPos(posA);
    await spawnPos(posB);

    // Both POS pull the initial catalog so each has the product at UNIT_PRICE.
    resetPullCursors();
    buildPosSession(posA.wsId);
    await runPulls(posA);
    resetPullCursors();
    buildPosSession(posB.wsId);
    await runPulls(posB);

    const aProduct = await posA.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(aProduct.currentPriceId).toBe(SERVER_PRICE_HISTORY_ID);
    const bProduct = await posB.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(bProduct.currentPriceId).toBe(SERVER_PRICE_HISTORY_ID);
  }, 120000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const node of [posA, posB]) {
      if (node.prisma) await node.prisma.$disconnect();
      if (node.pg) await node.pg.close();
    }
    if (serverPrisma) {
      await serverPrisma.syncOperationOutcome.deleteMany({
        where: { subscriptionId },
      });
      await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
      await serverPrisma.inventoryMovement.deleteMany({
        where: { lotId: SERVER_LOT_ID },
      });
      await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
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
      await serverPrisma.category.deleteMany({
        where: { id: SERVER_CATEGORY_ID },
      });
      await serverPrisma.pharmaceuticalForm.deleteMany({
        where: { id: SERVER_FORM_ID },
      });
      await serverPrisma.taxScheme.deleteMany({
        where: { id: SERVER_TAX_SCHEME_ID },
      });
      await serverPrisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: SERVER_USER_ID },
            { workstationId: { in: [posA.wsId, posB.wsId] } },
          ],
        },
      });
      await serverPrisma.userSession.deleteMany({
        where: { userId: SERVER_USER_ID },
      });
      await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
      await serverPrisma.workstation.deleteMany({
        where: { id: { in: [SERVER_WS_ID, posA.wsId, posB.wsId] } },
      });
      await serverPrisma.$disconnect();
    }
    if (serverApp) await serverApp.close();
  }, 120000);

  it("price changed on POS A propagates to POS B through the incremental pull", async () => {
    // ===================================================================
    // 1. POS A changes the price with the REAL POS product service.
    //    This writes a local price history, flips the currentPriceId, and
    //    enqueues a PRODUCT_UPDATE in A's outbox — nothing touches the
    //    server directly.
    // ===================================================================
    buildPosSession(posA.wsId);
    const productServiceA = createProductService(posA.prisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await productServiceA.updateProduct(SERVER_PRODUCT_ID, {
      newPrice: { price: NEW_PRICE },
    });

    // Local state on A: new price active immediately.
    const aProduct = await posA.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(aProduct.currentPriceId).not.toBe(SERVER_PRICE_HISTORY_ID);
    const aNewPrice = await posA.prisma.productPriceHistory.findUniqueOrThrow({
      where: { id: aProduct.currentPriceId! },
    });
    expect(Number(aNewPrice.price)).toBe(NEW_PRICE);
    // The old price row is closed, not deleted.
    expect(aNewPrice.previousPriceHistoryId).toBe(SERVER_PRICE_HISTORY_ID);
    const aOldPrice = await posA.prisma.productPriceHistory.findUniqueOrThrow({
      where: { id: SERVER_PRICE_HISTORY_ID },
    });
    expect(aOldPrice.effectiveTo).not.toBeNull();

    // B is untouched until the sync round trip completes.
    const bBefore = await posB.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(bBefore.currentPriceId).toBe(SERVER_PRICE_HISTORY_ID);

    // ===================================================================
    // 2. A pushes; the server replay creates the new price history with a
    //    NEW server-side id and flips the server's currentPriceId.
    // ===================================================================
    const { createSyncPushService } = await import("../sync/sync-push.service");
    const pushA = createSyncPushService({
      prisma: posA.prisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: posA.token,
    });
    const pushResult = await pushA.pushPending();
    expect(pushResult.accepted).toBeGreaterThanOrEqual(1);
    const updateStatus = await drainServerQueue("PRODUCT_UPDATE", "COMPLETED");
    expect(updateStatus.status).toBe("COMPLETED");

    const serverProduct = await serverPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(serverProduct.currentPriceId).not.toBe(SERVER_PRICE_HISTORY_ID);
    const serverNewPrice =
      await serverPrisma.productPriceHistory.findUniqueOrThrow({
        where: { id: serverProduct.currentPriceId! },
      });
    expect(Number(serverNewPrice.price)).toBe(NEW_PRICE);
    const serverPriceCount = await serverPrisma.productPriceHistory.count({
      where: { productId: SERVER_PRODUCT_ID },
    });
    expect(serverPriceCount).toBe(2);

    // ===================================================================
    // 3. POS B pulls INCREMENTALLY — B already pulled once in beforeAll,
    //    so the updatedSince cursor is set. The server must include the
    //    product (its updatedAt was bumped by the replay) and B must
    //    converge.
    // ===================================================================
    buildPosSession(posB.wsId);
    await runPulls(posB);

    const bProduct = await posB.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(bProduct.currentPriceId).toBe(serverProduct.currentPriceId);
    const bNewPrice = await posB.prisma.productPriceHistory.findUniqueOrThrow({
      where: { id: serverProduct.currentPriceId! },
    });
    expect(Number(bNewPrice.price)).toBe(NEW_PRICE);

    // No duplicates on B, and the old price row is still there (history
    // rows are never deleted by the pull).
    expect(
      await posB.prisma.productPriceHistory.count({
        where: { productId: SERVER_PRODUCT_ID },
      }),
    ).toBe(2);
  }, 120000);

  it("pull does not clobber a newer local price change on POS B (pending-edit guard)", async () => {
    // B now makes its OWN price change (conflicting with A's value) but does
    // NOT push yet. The product edit is pending in B's outbox.
    buildPosSession(posB.wsId);
    const productServiceB = createProductService(posB.prisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await productServiceB.updateProduct(SERVER_PRODUCT_ID, {
      newPrice: { price: 21000 },
    });
    const bPending = await posB.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    const bPendingPriceId = bPending.currentPriceId!;
    const bPendingPrice =
      await posB.prisma.productPriceHistory.findUniqueOrThrow({
        where: { id: bPendingPriceId },
      });
    expect(Number(bPendingPrice.price)).toBe(21000);

    // A pushes another change (16000). The server now holds 16000.
    buildPosSession(posA.wsId);
    const productServiceA = createProductService(posA.prisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await productServiceA.updateProduct(SERVER_PRODUCT_ID, {
      newPrice: { price: 16000 },
    });
    const { createSyncPushService } = await import("../sync/sync-push.service");
    const pushA = createSyncPushService({
      prisma: posA.prisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: posA.token,
    });
    await pushA.pushPending();
    expect(await drainServerQueue("PRODUCT_UPDATE", "COMPLETED")).toMatchObject(
      {
        status: "COMPLETED",
      },
    );
    const serverProduct = await serverPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(
      Number(
        (
          await serverPrisma.productPriceHistory.findUniqueOrThrow({
            where: { id: serverProduct.currentPriceId! },
          })
        ).price,
      ),
    ).toBe(16000);

    // B pulls. The pending local edit (21000) must WIN: the pull upserts the
    // price row for history but does NOT flip the currentPriceId pointer.
    await runPulls(posB);

    const bAfter = await posB.prisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(bAfter.currentPriceId).toBe(bPendingPriceId);
    const bActive = await posB.prisma.productPriceHistory.findUniqueOrThrow({
      where: { id: bAfter.currentPriceId! },
    });
    expect(Number(bActive.price)).toBe(21000);
    // The server's row arrived as history but was not promoted.
    expect(bAfter.currentPriceId).not.toBe(serverProduct.currentPriceId);

    // B pushes its own change; the server converges to 21000 (B is the
    // latest writer).
    const pushB = createSyncPushService({
      prisma: posB.prisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: posB.token,
    });
    await pushB.pushPending();
    expect(await drainServerQueue("PRODUCT_UPDATE", "COMPLETED")).toMatchObject(
      {
        status: "COMPLETED",
      },
    );
    const serverAfter = await serverPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(
      Number(
        (
          await serverPrisma.productPriceHistory.findUniqueOrThrow({
            where: { id: serverAfter.currentPriceId! },
          })
        ).price,
      ),
    ).toBe(21000);
  }, 120000);

  it("drains both outboxes completely — no operation is left behind", async () => {
    for (const node of [posA, posB]) {
      const pending = await node.prisma.syncQueue.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      });
      expect(pending).toBe(0);
    }
  });
});

// INestApplication type helper (kept untyped in imports to match the other specs).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface INestApplication {}
  }
}
