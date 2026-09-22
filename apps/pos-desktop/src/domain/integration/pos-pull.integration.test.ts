/**
 * POS ↔ Server integration — PULL (server → POS).
 *
 * Every other integration spec in this directory exercises the PUSH path
 * (local PGlite → server Postgres). This one exercises the opposite
 * direction with the real code end to end:
 *
 *   server Postgres (real rows) → HTTP endpoints → real pull services
 *   (CatalogSyncService, LotSyncService, ClientPullService) → local PGlite.
 *
 * No HTTP client is mocked: the services hit the bootstrapped NestJS server
 * over 127.0.0.1 exactly like production. Only `navigator.onLine` is stubbed
 * (the vitest node environment has no webview to report connectivity).
 *
 * Verified invariants
 * -------------------
 * - Catalog: categories/forms/tax schemes/product land in PGlite with
 *   `serverId` stamped (the sellable gate), plus barcodes, current price and
 *   tax history pointers.
 * - Lots: server lots arrive with the SAME id the server uses — the
 *   shared-id invariant every sale replay depends on.
 * - Clients: full row (credit limit, consent, classification) lands via the
 *   bulk ON CONFLICT upsert, and the classification FK resolves.
 * - Incremental: a second pull does not duplicate and picks up deltas
 *   (price change + new client) while skipping untouched rows.
 * - Real round trip: a product that exists ONLY because of the pull can be
 *   sold on the POS and replayed on the server against the pulled lot.
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
import { useLocalConfigStore } from "../configuration/local-config.store";
import { createSyncPushService } from "../sync/sync-push.service";
import { createSalesPosService } from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import {
  getClientsLastSyncedAt,
  getCatalogLastSyncedAt,
} from "../../common/sync-metadata";

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

const SUB_SEED = "pos-int-pull";
const SERVER_WS_ID = uuidFrom("pos-int-pull-server-ws");
const SERVER_USER_ID = "pos-int-pull-server-user-id";
const USERNAME = "pos-int-pull@pos.test";
const PASSWORD = "PosPull123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-pull-tax-scheme");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-pull-pm-cash");
const SERVER_CATEGORY_ID = uuidFrom("pos-int-pull-category");
const SERVER_FORM_ID = uuidFrom("pos-int-pull-form");
const SERVER_CLASSIFICATION_ID = uuidFrom("pos-int-pull-classification");
const SERVER_PRODUCT_ID = uuidFrom("pos-int-pull-product");
const SERVER_PRICE_HISTORY_ID = uuidFrom("pos-int-pull-price-hist");
const SERVER_TAX_HISTORY_ID = uuidFrom("pos-int-pull-tax-hist");
const SERVER_BARCODE_ID = uuidFrom("pos-int-pull-barcode");
const SERVER_LOT_ID = uuidFrom("pos-int-pull-lot");
const SERVER_CLIENT_ID = uuidFrom("pos-int-pull-client");
const SERVER_CLIENT2_ID = uuidFrom("pos-int-pull-client-2");
const UNIT_PRICE = 15000;

const POS_WS_ID = "pos-int-pull-ws-0001";
const POS_USER_ID = SERVER_USER_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;

describe("POS ↔ Server integration — pull (server → POS)", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClientType>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;

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

  const runPulls = async (): Promise<void> => {
    const catalog = createCatalogSyncService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    const lotSync = createLotSyncService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    const clientPull = createClientPullService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    // Inject the real auth header the way the scheduler does (config carries
    // accessToken); the services default to the global fetch otherwise.
    (catalog as unknown as { accessToken: string }).accessToken = serverToken;
    (lotSync as unknown as { accessToken: string }).accessToken = serverToken;
    (clientPull as unknown as { accessToken: string }).accessToken =
      serverToken;

    // Exactly what the scheduler tick does (fetch unlocked, apply under lock
    // — here without the lock since the test owns the database).
    const catalogPayload = await catalog.fetchCatalog();
    await catalog.applyCatalog(catalogPayload);
    const lots = await lotSync.fetchLots();
    await lotSync.applyLots(lots);
    const classifications = await clientPull.fetchClassifications();
    await clientPull.applyClassifications(classifications);
    const clients = await clientPull.fetchClients();
    await clientPull.applyClients(clients);
    return;
  };

  beforeAll(async () => {
    // The pull services short-circuit without a webview reporting online.
    vi.stubGlobal("navigator", { onLine: true });
    // localStorage exists in the vitest node env? No — provide a minimal shim
    // so sync-metadata (pull cursors) and the config store can persist.
    if (typeof globalThis.localStorage === "undefined") {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      });
    }
    // Enable store credit so the pulled client's creditLimit is usable.
    useLocalConfigStore.setState({
      salesConfig: {
        ...useLocalConfigStore.getState().salesConfig,
        creditEnabled: true,
        defaultCreditLimitCents: 1_000_000,
      },
    });

    // =====================================================================
    // 1. SERVER — real NestJS app on a real port, real Postgres
    // =====================================================================
    serverPrisma = new ServerPrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await serverPrisma.$connect();

    subscriptionId = await seedSubscription(serverPrisma, SUB_SEED);

    // ── Cleanup (children first, scoped to this suite's ids) ────────────
    const serverSaleWhere = { cashShift: { workstationId: SERVER_WS_ID } };
    await serverPrisma.syncOperationOutcome.deleteMany({
      where: { subscriptionId },
    });
    await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await serverPrisma.saleItemLot.deleteMany({
      where: { saleItem: { sale: serverSaleWhere } },
    });
    await serverPrisma.saleItem.deleteMany({
      where: { sale: serverSaleWhere },
    });
    await serverPrisma.salePayment.deleteMany({
      where: { sale: serverSaleWhere },
    });
    await serverPrisma.sale.deleteMany({ where: serverSaleWhere });
    await serverPrisma.fiscalDocument.deleteMany({
      where: { subscriptionId, documentType: "INVOICE" },
    });
    await serverPrisma.cashShift.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
    await serverPrisma.inventoryMovement.deleteMany({
      where: { lotId: SERVER_LOT_ID },
    });
    await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
    await serverPrisma.purchaseReceptionItem.deleteMany({
      where: { productId: SERVER_PRODUCT_ID },
    });
    await serverPrisma.purchaseReception.deleteMany({
      where: { sequentialNumber: 990001 },
    });
    await serverPrisma.supplier.deleteMany({
      where: { identificationNumber: "900999999-1" },
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
    await serverPrisma.product.deleteMany({ where: { id: SERVER_PRODUCT_ID } });
    await serverPrisma.client.deleteMany({
      where: { id: { in: [SERVER_CLIENT_ID, SERVER_CLIENT2_ID] } },
    });
    await serverPrisma.clientClassification.deleteMany({
      where: { id: SERVER_CLASSIFICATION_ID },
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
    await serverPrisma.paymentMethod.deleteMany({
      where: { id: SERVER_PM_CASH_ID },
    });
    // Audit logs reference sessions and the workstation (FK) — clear them
    // before the session/user/workstation deletes. A previous run's login
    // leaves both behind.
    await serverPrisma.auditLog.deleteMany({
      where: {
        OR: [{ userId: SERVER_USER_ID }, { workstationId: SERVER_WS_ID }],
      },
    });
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { allocatedByUserId: SERVER_USER_ID },
    });
    await serverPrisma.userSession.deleteMany({
      where: { userId: SERVER_USER_ID },
    });
    await serverPrisma.user.deleteMany({ where: { id: SERVER_USER_ID } });
    await serverPrisma.workstation.deleteMany({
      where: { id: SERVER_WS_ID },
    });

    // ── Seed the server-side world the POS will pull ────────────────────
    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "POS Pull Workstation",
        code: "WS-POS-PULL-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });
    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS Pull Cashier",
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
        code: "POS-INT-PULL-IVA19",
        name: "POS Pull IVA 19%",
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
        name: "Pull Analgésicos",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.pharmaceuticalForm.create({
      data: {
        id: SERVER_FORM_ID,
        subscriptionId,
        name: "Pull Tableta",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.paymentMethod.create({
      data: {
        id: SERVER_PM_CASH_ID,
        subscriptionId,
        internalCode: "POS-INT-PULL-CASH",
        name: "POS Pull Cash",
        category: "CASH",
        isCash: true,
      },
    });
    // DIAN authorization — every replayed sale generates an INVOICE that
    // consumes a consecutive from the workstation's active allocation.
    const SERVER_RESOLUTION_ID = uuidFrom("pos-int-pull-fiscal-resolution");
    await serverPrisma.fiscalResolution.upsert({
      where: { id: SERVER_RESOLUTION_ID },
      create: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000998899",
        documentType: "INVOICE",
        prefix: "PULL",
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2027-12-31"),
        state: "ACTIVE",
        workstationId: SERVER_WS_ID,
      },
      update: {},
    });
    // Allocation is consumed by replays — reset it so consecutive numbering
    // starts fresh even if a previous run left rows behind.
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { resolutionId: SERVER_RESOLUTION_ID },
    });
    await serverPrisma.fiscalResolutionAllocation.create({
      data: {
        id: uuidFrom("pos-int-pull-fiscal-allocation"),
        subscriptionId,
        resolutionId: SERVER_RESOLUTION_ID,
        workstationId: SERVER_WS_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date("2026-01-01"),
        allocatedByUserId: SERVER_USER_ID,
      },
    });
    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-INT-PULL-A",
        commercialName: "Pulled Product A",
        laboratory: "Pull Lab",
        saleType: "FREE_SALE",
        minimumStock: 5,
        isActive: true,
        categoryId: SERVER_CATEGORY_ID,
        pharmaceuticalFormId: SERVER_FORM_ID,
        createdById: SERVER_USER_ID,
      },
    });
    await serverPrisma.productPriceHistory.create({
      data: {
        id: SERVER_PRICE_HISTORY_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.productTaxHistory.create({
      data: {
        id: SERVER_TAX_HISTORY_ID,
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
        currentPriceId: SERVER_PRICE_HISTORY_ID,
        currentTaxHistoryId: SERVER_TAX_HISTORY_ID,
      },
    });
    await serverPrisma.productBarcode.create({
      data: {
        id: SERVER_BARCODE_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        barcode: "7701234000011",
        barcodeType: "EAN13",
        isPrimary: true,
      },
    });
    // The lot exists ONLY server-side (stock hydrated by an earlier
    // reception on another terminal — the classic pull scenario). The
    // reception item is required: sale replays resolve the acquisition
    // cost through it (LotCostUnavailableException otherwise).
    await serverPrisma.purchaseReception.deleteMany({
      where: { items: { some: { lotId: SERVER_LOT_ID } } },
    });
    await serverPrisma.purchaseReception.create({
      data: {
        id: uuidFrom("pos-int-pull-reception"),
        subscriptionId,
        sequentialNumber: 990001,
        state: "CONFIRMED",
        supplierId: (
          await serverPrisma.supplier.create({
            data: {
              id: uuidFrom("pos-int-pull-supplier"),
              subscriptionId,
              identificationType: "NIT",
              identificationNumber: "900999999-1",
              businessName: "Pull Supplier",
              isActive: true,
              createdById: SERVER_USER_ID,
            },
          })
        ).id,
        subtotal: new Prisma.Decimal(25 * 6000),
        totalTax: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(25 * 6000),
        createdById: SERVER_USER_ID,
        receivedAt: new Date("2026-01-15"),
        items: {
          create: {
            id: uuidFrom("pos-int-pull-reception-item"),
            subscriptionId,
            productId: SERVER_PRODUCT_ID,
            receivedQuantity: 25,
            lotId: SERVER_LOT_ID,
            lotNumber: "PULL-BATCH-1",
            realUnitCost: new Prisma.Decimal(6000),
            taxSchemeId: SERVER_TAX_SCHEME_ID,
            taxRate: new Prisma.Decimal("19"),
            discountAmount: new Prisma.Decimal(0),
            subtotal: new Prisma.Decimal(25 * 6000),
          },
        },
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        batchNumber: "PULL-BATCH-1",
        expirationDate: new Date("2027-10-31"),
        entryDate: new Date("2026-01-15"),
        state: "ACTIVE",
        currentStock: 25,
        version: 0,
      },
    });
    await serverPrisma.clientClassification.create({
      data: {
        id: SERVER_CLASSIFICATION_ID,
        subscriptionId,
        type: "FREQUENT",
        discountPercentage: new Prisma.Decimal("2.5"),
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.client.create({
      data: {
        id: SERVER_CLIENT_ID,
        subscriptionId,
        identificationType: "CC",
        identificationNumber: "PULL-CC-0001",
        fullName: "Cliente Pulled Uno",
        phone: "3110000001",
        creditLimit: new Prisma.Decimal(250000),
        classificationId: SERVER_CLASSIFICATION_ID,
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
    serverApp.useGlobalPipes(
      new (serverRequire("@nestjs/common").ValidationPipe)({ transform: true }),
    );
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
    // 2. POS — real PGlite, EMPTY (no manual seeds): the pull must fill it
    // =====================================================================
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    // The only local seeds the POS boot itself would create: generic client
    // (sales need it locally) and the payment method catalog mirror.
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
    await localPrisma.paymentMethod.create({
      data: {
        id: PM_CASH_ID,
        internalCode: "POS-INT-PULL-CASH",
        name: "POS Pull Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    useLocalSessionStore.getState().setSession({
      userId: POS_USER_ID,
      username: USERNAME,
      fullName: "POS Pull Cashier",
      displayName: "POS Pull Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-int-pull",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-int-pull-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });
  }, 120000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();

    if (serverPrisma) {
      const serverSaleWhere = { cashShift: { workstationId: SERVER_WS_ID } };
      await serverPrisma.syncOperationOutcome.deleteMany({
        where: { subscriptionId },
      });
      await serverPrisma.syncQueue.deleteMany({ where: { subscriptionId } });
      await serverPrisma.saleItemLot.deleteMany({
        where: { saleItem: { sale: serverSaleWhere } },
      });
      await serverPrisma.saleItem.deleteMany({
        where: { sale: serverSaleWhere },
      });
      await serverPrisma.salePayment.deleteMany({
        where: { sale: serverSaleWhere },
      });
      await serverPrisma.sale.deleteMany({ where: serverSaleWhere });
      await serverPrisma.fiscalDocument.deleteMany({
        where: { subscriptionId, documentType: "INVOICE" },
      });
      await serverPrisma.cashShift.deleteMany({
        where: { workstationId: SERVER_WS_ID },
      });
      await serverPrisma.inventoryMovement.deleteMany({
        where: { lotId: SERVER_LOT_ID },
      });
      await serverPrisma.lot.deleteMany({ where: { id: SERVER_LOT_ID } });
      await serverPrisma.purchaseReceptionItem.deleteMany({
        where: { productId: SERVER_PRODUCT_ID },
      });
      await serverPrisma.purchaseReception.deleteMany({
        where: { sequentialNumber: 990001 },
      });
      await serverPrisma.supplier.deleteMany({
        where: { identificationNumber: "900999999-1" },
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
      await serverPrisma.client.deleteMany({
        where: { id: { in: [SERVER_CLIENT_ID, SERVER_CLIENT2_ID] } },
      });
      await serverPrisma.clientClassification.deleteMany({
        where: { id: SERVER_CLASSIFICATION_ID },
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
      await serverPrisma.paymentMethod.deleteMany({
        where: { id: SERVER_PM_CASH_ID },
      });
      await serverPrisma.auditLog.deleteMany({
        where: {
          OR: [{ userId: SERVER_USER_ID }, { workstationId: SERVER_WS_ID }],
        },
      });
      await serverPrisma.fiscalResolutionAllocation.deleteMany({
        where: { allocatedByUserId: SERVER_USER_ID },
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

  it("pulls the full catalog into an empty POS: products sellable, lots shared-id, reference data", async () => {
    expect(await serverPrisma.product.count()).toBeGreaterThan(0);

    await runPulls();

    // ── Product: the sellable gate ──────────────────────────────────────
    const localProduct = await localPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
      include: { barcodes: true },
    });
    expect(localProduct.serverId).toBe(SERVER_PRODUCT_ID);
    expect(localProduct.commercialName).toBe("Pulled Product A");
    expect(localProduct.internalCode).toBe("POS-INT-PULL-A");
    expect(localProduct.categoryId).toBe(SERVER_CATEGORY_ID);
    expect(localProduct.pharmaceuticalFormId).toBe(SERVER_FORM_ID);
    expect(localProduct.currentPriceId).toBe(SERVER_PRICE_HISTORY_ID);
    expect(localProduct.currentTaxHistoryId).toBe(SERVER_TAX_HISTORY_ID);
    expect(localProduct.barcodes).toHaveLength(1);
    expect(localProduct.barcodes[0].barcode).toBe("7701234000011");
    const pulledPrice = await localPrisma.productPriceHistory.findUniqueOrThrow(
      {
        where: { id: SERVER_PRICE_HISTORY_ID },
      },
    );
    expect(Number(pulledPrice.price)).toBe(UNIT_PRICE);
    const pulledTax = await localPrisma.productTaxHistory.findUniqueOrThrow({
      where: { id: SERVER_TAX_HISTORY_ID },
      include: { taxScheme: true },
    });
    expect(pulledTax.taxScheme.rate.toString()).toBe("19");

    // ── Reference data ──────────────────────────────────────────────────
    expect(
      await localPrisma.category.findUnique({
        where: { id: SERVER_CATEGORY_ID },
      }),
    ).not.toBeNull();
    expect(
      await localPrisma.pharmaceuticalForm.findUnique({
        where: { id: SERVER_FORM_ID },
      }),
    ).not.toBeNull();
    expect(
      await localPrisma.taxScheme.findUnique({
        where: { id: SERVER_TAX_SCHEME_ID },
      }),
    ).not.toBeNull();

    // ── Lot: SAME id as the server (shared-id invariant) ────────────────
    const localLot = await localPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(localLot.productId).toBe(SERVER_PRODUCT_ID);
    expect(localLot.currentStock).toBe(25);
    expect(localLot.batchNumber).toBe("PULL-BATCH-1");

    // ── Client: full row + classification FK ────────────────────────────
    const localClient = await localPrisma.client.findUniqueOrThrow({
      where: { id: SERVER_CLIENT_ID },
    });
    expect(localClient.fullName).toBe("Cliente Pulled Uno");
    expect(localClient.creditLimit?.toString()).toBe("250000");
    expect(localClient.classificationId).toBe(SERVER_CLASSIFICATION_ID);
    expect(
      await localPrisma.clientClassification.findUnique({
        where: { id: SERVER_CLASSIFICATION_ID },
      }),
    ).not.toBeNull();

    // ── Cursors recorded ────────────────────────────────────────────────
    expect(getCatalogLastSyncedAt()).not.toBeNull();
    expect(getClientsLastSyncedAt()).not.toBeNull();
  }, 120000);

  it("second pull is idempotent and picks up server-side deltas", async () => {
    // ── Server-side drift: price change + a NEW client ─────────────────
    const newPriceId = uuidFrom("pos-int-pull-price-hist-2");
    await serverPrisma.productPriceHistory.create({
      data: {
        id: newPriceId,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        price: new Prisma.Decimal(16000),
        effectiveFrom: new Date(),
        changedById: SERVER_USER_ID,
        changedAt: new Date(),
      },
    });
    await serverPrisma.product.update({
      where: { id: SERVER_PRODUCT_ID },
      data: { currentPriceId: newPriceId },
    });
    await serverPrisma.client.create({
      data: {
        id: SERVER_CLIENT2_ID,
        subscriptionId,
        identificationType: "CC",
        identificationNumber: "PULL-CC-0002",
        fullName: "Cliente Pulled Dos",
        creditLimit: new Prisma.Decimal(100000),
        isActive: true,
        createdById: SERVER_USER_ID,
      },
    });

    await runPulls();

    // Delta applied: new price, new client.
    const productAfter = await localPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
    });
    expect(productAfter.currentPriceId).toBe(newPriceId);
    expect(
      Number(
        (
          await localPrisma.productPriceHistory.findUniqueOrThrow({
            where: { id: newPriceId },
          })
        ).price,
      ),
    ).toBe(16000);
    const client2 = await localPrisma.client.findUniqueOrThrow({
      where: { id: SERVER_CLIENT2_ID },
    });
    expect(client2.fullName).toBe("Cliente Pulled Dos");

    // No duplicates anywhere.
    expect(await localPrisma.product.count()).toBe(1);
    expect(await localPrisma.lot.count()).toBe(1);
    expect(
      await localPrisma.client.count({
        where: {
          identificationNumber: { in: ["PULL-CC-0001", "PULL-CC-0002"] },
        },
      }),
    ).toBe(2);
  }, 120000);

  it("a pulled product is sellable end to end: sale replay consumes the pulled lot", async () => {
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await cashShift.openShift({ openingBalance: new Prisma.Decimal("100000") });

    const salesPos = createSalesPosService(
      localPrisma,
      { requireRole: () => useLocalSessionStore.getState().session! } as any,
      createInventoryLotsService(localPrisma),
    );

    // Sell 2 units — the POS only has this product because of the pull.
    // Price: whatever the last pull left as current (the delta test moved
    // it from 15000 to 16000), so the amount never hardcodes a price.
    const sale = (await salesPos.create({
      items: [{ productId: SERVER_PRODUCT_ID, quantity: 2 }],
    })) as { id: string };
    const currentPrice =
      await localPrisma.productPriceHistory.findUniqueOrThrow({
        where: {
          id: (
            await localPrisma.product.findUniqueOrThrow({
              where: { id: SERVER_PRODUCT_ID },
              select: { currentPriceId: true },
            })
          ).currentPriceId!,
        },
      });
    const saleTotal = Math.round(2 * Number(currentPrice.price) * 1.19);
    await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: saleTotal }],
    });

    // Local: FIFO consumed the PULLED lot (shared id).
    const saleItemLot = await localPrisma.saleItemLot.findFirstOrThrow({
      where: { saleItem: { saleId: sale.id } },
    });
    expect(saleItemLot.lotId).toBe(SERVER_LOT_ID);
    const localLot = await localPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(localLot.currentStock).toBe(23);

    // Push + drain: the server replays the sale against ITS OWN lot.
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const pushResult = await push.pushPending();
    expect(pushResult.accepted).toBeGreaterThanOrEqual(1);
    const saleStatus = await drainServerQueue("SALE_CONFIRMATION", "COMPLETED");
    expect(saleStatus.status).toBe("COMPLETED");

    const serverSale = await serverPrisma.sale.findFirstOrThrow({
      where: { sourceWorkstationId: SERVER_WS_ID },
      include: { items: { include: { lots: true } } },
    });
    expect(serverSale.operationalState).toBe("CONFIRMED");
    expect(serverSale.items[0].productId).toBe(SERVER_PRODUCT_ID);
    expect(serverSale.items[0].lots[0].lotId).toBe(SERVER_LOT_ID);
    const serverLot = await serverPrisma.lot.findUniqueOrThrow({
      where: { id: SERVER_LOT_ID },
    });
    expect(serverLot.currentStock).toBe(23);
  }, 120000);

  it("drains the local outbox completely — no operation is left behind", async () => {
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  });
});
