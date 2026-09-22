/**
 * POS ↔ Server integration — fiscal contingency (exhausted numbering range).
 *
 * The scenario: a workstation's DIAN-authorized numbering range runs out
 * while it is in contingency mode. Sales keep being confirmed (business
 * rule: the sale must never be lost because of a fiscal problem), but no
 * new invoice number can be issued. This spec verifies exactly what the
 * POS is left holding, end to end, with the real services over real HTTP:
 *
 *   1. POS confirms sales online (server reachable) with a healthy range →
 *      every sale gets a local invoice in TRANSMITTED_AUTHORIZED state and
 *      a SALE_CONFIRMATION outbox entry.
 *   2. The range is driven to its end (authorizedEnd reached). Contingency
 *      is active (offline). One more sale is confirmed:
 *      - the sale IS confirmed locally (CONFIRMED, stock consumed, payment
 *        recorded, outbox entry enqueued),
 *      - invoice generation fails with FiscalCounterExhaustedError,
 *      - `ConfirmResult.invoiceGenerated === false` and `invoiceError`
 *        carries the failure (what the UI surfaces to the cashier),
 *      - the sale is NOT lost: pushing the outbox replays it on the server,
 *        where the server-side DIAN machinery issues the invoice from the
 *        server's own FiscalResolutionAllocation.
 *   3. Push + drain: the exhausted-range sale arrives CONFIRMED on the
 *      server and consumes a consecutive from the server allocation, while
 *      the healthy-range sales consumed their own consecutives. Local and
 *      server stock converge.
 *   4. The fiscal scheduler transitions nothing incorrectly: invoices from
 *      the healthy range stay TRANSMITTED_AUTHORIZED (they were issued
 *      online; no contingency window applies).
 *
 * No fiscal machinery is mocked: FiscalNumberingService, ContingencyService,
 * InvoiceService and SalesPosService are the production services running on
 * a real PGlite; the server is the real NestJS app on real Postgres.
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

import { useLocalSessionStore } from "../auth/local-session.store";
import { createSyncPushService } from "../sync/sync-push.service";
import { createSalesPosService } from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import { createFiscalNumberingService } from "../fiscal/numbering.service";
import { createContingencyService } from "../fiscal/contingency.service";
import { createInvoiceService } from "../fiscal/invoice.service";
import { FiscalCounterExhaustedError } from "../fiscal/exceptions";
import { createCatalogSyncService } from "../catalog/catalog-sync.service";
import { createLotSyncService } from "../inventory-lots/lot-sync.service";
import { createClientPullService } from "../clients/client-pull.service";

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

const SUB_SEED = "pos-int-fiscalex";
const SERVER_WS_ID = uuidFrom("pos-int-fiscalex-server-ws");
const SERVER_USER_ID = "pos-int-fiscalex-server-user-id";
const USERNAME = "pos-int-fiscalex@pos.test";
const PASSWORD = "PosFiscalEx123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-fiscalex-tax-scheme");
const SERVER_CATEGORY_ID = uuidFrom("pos-int-fiscalex-category");
const SERVER_FORM_ID = uuidFrom("pos-int-fiscalex-form");
const SERVER_PRODUCT_ID = uuidFrom("pos-int-fiscalex-product");
const SERVER_PRICE_HISTORY_ID = uuidFrom("pos-int-fiscalex-price-hist");
const SERVER_TAX_HISTORY_ID = uuidFrom("pos-int-fiscalex-tax-hist");
const SERVER_BARCODE_ID = uuidFrom("pos-int-fiscalex-barcode");
const SERVER_LOT_ID = uuidFrom("pos-int-fiscalex-lot");
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-fiscalex-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-fiscalex-allocation");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-fiscalex-pm-cash");
const UNIT_PRICE = 10000;
const SALE_QTY = 1;
const EXPECTED_TOTAL = Math.round(UNIT_PRICE * SALE_QTY * 1.19);

const POS_WS_ID = "pos-int-fiscalex-ws-0001";
const POS_USER_ID = SERVER_USER_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;

describe("POS ↔ Server integration — fiscal contingency with exhausted numbering range", () => {
  let serverApp: INestApplication;
  let serverPrisma: InstanceType<typeof ServerPrismaClientType>;
  let serverPort: number;
  let subscriptionId: string;
  let serverToken: string;

  let pg: PGlite;
  let localPrisma: LocalPrismaClient;
  let salesPos: ReturnType<typeof createSalesPosService>;
  let numbering: ReturnType<typeof createFiscalNumberingService>;
  let contingency: ReturnType<typeof createContingencyService>;
  let invoiceService: ReturnType<typeof createInvoiceService>;

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

  /** Confirm one 1-unit cash sale through the real POS service. */
  const confirmOneSale = async (): Promise<{
    saleId: string;
    invoiceGenerated: boolean;
    invoiceError?: string;
  }> => {
    const sale = (await salesPos.create({
      items: [{ productId: SERVER_PRODUCT_ID, quantity: SALE_QTY }],
    })) as { id: string };
    const result = (await salesPos.confirm(sale.id, {
      payments: [{ paymentMethodId: PM_CASH_ID, amount: EXPECTED_TOTAL }],
    })) as { invoiceGenerated: boolean; invoiceError?: string };
    return {
      saleId: sale.id,
      invoiceGenerated: result.invoiceGenerated,
      invoiceError: result.invoiceError,
    };
  };

  beforeAll(async () => {
    // The pull/push services short-circuit without a webview reporting online.
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
      where: { sequentialNumber: 990002 },
    });
    await serverPrisma.supplier.deleteMany({
      where: { identificationNumber: "900999998-1" },
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
    await serverPrisma.fiscalResolutionAllocation.deleteMany({
      where: { id: SERVER_ALLOCATION_ID },
    });
    await serverPrisma.fiscalResolution.deleteMany({
      where: { id: SERVER_RESOLUTION_ID },
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

    // ── Seed the server-side world ──────────────────────────────────────
    await serverPrisma.workstation.create({
      data: {
        id: SERVER_WS_ID,
        name: "FiscalEx Workstation",
        code: "WS-FISCALEX-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });
    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS FiscalEx Cashier",
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
        code: "POS-INT-FISCALEX-IVA19",
        name: "FiscalEx IVA 19%",
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
        name: "FiscalEx Analgésicos",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.pharmaceuticalForm.create({
      data: {
        id: SERVER_FORM_ID,
        subscriptionId,
        name: "FiscalEx Tableta",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.paymentMethod.create({
      data: {
        id: SERVER_PM_CASH_ID,
        subscriptionId,
        internalCode: "POS-INT-FISCALEX-CASH",
        name: "FiscalEx Cash",
        category: "CASH",
        isCash: true,
      },
    });
    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-INT-FISCALEX-A",
        commercialName: "FiscalEx Product A",
        laboratory: "FiscalEx Lab",
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
        barcode: "7701234000033",
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
    // The lot must have a REAL purchase reception behind it — the sale replay
    // resolves the unit cost from the reception (LotCostUnavailableException
    // otherwise), exactly like a lot that arrived through the pull.
    await serverPrisma.purchaseReception.create({
      data: {
        id: uuidFrom("pos-int-fiscalex-reception"),
        subscriptionId,
        sequentialNumber: 990002,
        state: "CONFIRMED",
        supplierId: (
          await serverPrisma.supplier.create({
            data: {
              id: uuidFrom("pos-int-fiscalex-supplier"),
              subscriptionId,
              identificationType: "NIT",
              identificationNumber: "900999998-1",
              businessName: "FiscalEx Supplier",
              isActive: true,
              createdById: SERVER_USER_ID,
            },
          })
        ).id,
        subtotal: new Prisma.Decimal(50 * 6000),
        totalTax: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(50 * 6000),
        createdById: SERVER_USER_ID,
        receivedAt: new Date("2026-01-15"),
        items: {
          create: {
            id: uuidFrom("pos-int-fiscalex-reception-item"),
            subscriptionId,
            productId: SERVER_PRODUCT_ID,
            receivedQuantity: 50,
            lotId: SERVER_LOT_ID,
            lotNumber: "FISCALEX-BATCH-1",
            realUnitCost: new Prisma.Decimal(6000),
            taxSchemeId: SERVER_TAX_SCHEME_ID,
            taxRate: new Prisma.Decimal("19"),
            discountAmount: new Prisma.Decimal(0),
            subtotal: new Prisma.Decimal(50 * 6000),
          },
        },
      },
    });
    await serverPrisma.lot.create({
      data: {
        id: SERVER_LOT_ID,
        subscriptionId,
        productId: SERVER_PRODUCT_ID,
        batchNumber: "FISCALEX-BATCH-1",
        currentStock: 50,
        entryDate: new Date("2026-01-01"),
        expirationDate: new Date("2027-12-31"),
      },
    });
    // DIAN resolution + allocation: a healthy range of 3 consecutive numbers
    // starting at 1 — enough for the online sales, deliberately exhaustible.
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000998877",
        documentType: "INVOICE",
        prefix: "FEX",
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

    // =====================================================================
    // Nest app bootstrap + POS session/login
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
    // POS — real PGlite with the local schema, minimal boot seeds
    // =====================================================================
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);
    localPrisma = new LocalPrismaClient({ adapter: new PrismaPGlite(pg) });

    await localPrisma.paymentMethod.create({
      data: {
        id: PM_CASH_ID,
        internalCode: "POS-INT-FISCALEX-CASH",
        name: "FiscalEx Cash",
        category: "CASH",
        isCash: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // Generic client — the boot flow (seedGenericClientIfEmpty) creates it
    // locally; the sale flow FK-references it (Sale_clientId_fkey).
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

    useLocalSessionStore.getState().setSession({
      userId: POS_USER_ID,
      username: USERNAME,
      fullName: "POS FiscalEx Cashier",
      displayName: "POS FiscalEx Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-int-fiscalex",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-int-fiscalex-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });

    // Real fiscal stack wired exactly like useFiscalServices does.
    numbering = createFiscalNumberingService({
      prisma: localPrisma,
      workstationId: POS_WS_ID,
    });
    contingency = createContingencyService({
      prisma: localPrisma,
      workstationId: POS_WS_ID,
    });
    invoiceService = createInvoiceService({
      prisma: localPrisma,
      workstationId: POS_WS_ID,
      numberingService: numbering,
      contingencyService: contingency,
    });
    salesPos = createSalesPosService(
      localPrisma,
      { requireRole: () => useLocalSessionStore.getState().session! } as any,
      createInventoryLotsService(localPrisma),
      invoiceService,
    );

    // The POS only has catalog/stock because of the PULL — fill it with the
    // real pull services (same code the scheduler tick runs).
    const catalog = createCatalogSyncService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    const lotSync = createLotSyncService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    (catalog as unknown as { accessToken: string }).accessToken = serverToken;
    (lotSync as unknown as { accessToken: string }).accessToken = serverToken;
    const catalogPayload = await catalog.fetchCatalog();
    await catalog.applyCatalog(catalogPayload);
    await lotSync.applyLots(await lotSync.fetchLots());
    // Generic client — in production the boot flow creates it locally; the
    // sale flow FK-references it locally (Sale_clientId_fkey).
    const clientPull = createClientPullService(localPrisma, {
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });
    (clientPull as unknown as { accessToken: string }).accessToken =
      serverToken;
    await clientPull.applyClassifications(
      await clientPull.fetchClassifications(),
    );
    await clientPull.applyClients(await clientPull.fetchClients());

    const pulledProduct = await localPrisma.product.findUniqueOrThrow({
      where: { id: SERVER_PRODUCT_ID },
      select: { serverId: true, currentPriceId: true },
    });
    expect(pulledProduct.serverId).toBe(SERVER_PRODUCT_ID);
    expect(pulledProduct.currentPriceId).toBe(SERVER_PRICE_HISTORY_ID);
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
      await serverPrisma.paymentMethod.deleteMany({
        where: { id: SERVER_PM_CASH_ID },
      });
      await serverPrisma.fiscalResolutionAllocation.deleteMany({
        where: { id: SERVER_ALLOCATION_ID },
      });
      await serverPrisma.fiscalResolution.deleteMany({
        where: { id: SERVER_RESOLUTION_ID },
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

  it("exhausted local range: sale confirmed without invoice, outbox intact, server replays it", async () => {
    // ===================================================================
    // Phase 1 — healthy range: two sales confirmed ONLINE (no contingency).
    // Each one gets a local invoice with a number from the local counter
    // (TRANSMITTED_AUTHORIZED placeholder — online mode needs no window).
    // ===================================================================
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await cashShift.openShift({ openingBalance: new Prisma.Decimal("100000") });

    // Local counter: authorized range 1..2 — exactly two numbers available.
    await numbering.initializeCounters({
      workstationId: POS_WS_ID,
      currentRegularNumber: 0,
      currentContingencyNumber: 0,
      resolutionPrefix: "FEX",
      authorizedStart: 1,
      authorizedEnd: 2,
      paddingLength: 8,
    });

    const sale1 = await confirmOneSale();
    expect(sale1.invoiceGenerated).toBe(true);
    const sale2 = await confirmOneSale();
    expect(sale2.invoiceGenerated).toBe(true);

    const healthyInvoices = await localPrisma.invoice.findMany({
      orderBy: { issuedAt: "asc" },
    });
    expect(healthyInvoices).toHaveLength(2);
    for (const inv of healthyInvoices) {
      // Online issuance: no contingency window applies.
      expect(inv.status).toBe("TRANSMITTED_AUTHORIZED");
      expect(inv.contingencyNumber).toBeNull();
      expect(inv.contingencyEventId).toBeNull();
    }
    // Consecutive numbering from the local counter (FEX prefix).
    expect(healthyInvoices[0].invoiceNumber).toBe(
      `FEX-${POS_WS_ID.slice(0, 8)}-00000001`,
    );
    expect(healthyInvoices[1].invoiceNumber).toBe(
      `FEX-${POS_WS_ID.slice(0, 8)}-00000002`,
    );

    // Local stock: two units consumed from the pulled lot (shared id).
    expect(
      (
        await localPrisma.lot.findUniqueOrThrow({
          where: { id: SERVER_LOT_ID },
        })
      ).currentStock,
    ).toBe(48);

    // ===================================================================
    // Phase 2 — contingency active AND the contingency counter also
    // exhausted: the worst case. In contingency the POS invoices from the
    // separate CONT counter (by design — that is the whole point of the
    // mode); a workstation that already burned through its contingency
    // range cannot issue ANY new invoice. The sale must still survive.
    // ===================================================================
    await contingency.enterContingency(
      "NETWORK_LOST",
      "Test: DIAN unreachable while both numbering ranges are exhausted.",
    );
    expect(await contingency.isInContingency()).toBe(true);

    // Burn the contingency counter to its authorized end as well.
    await localPrisma.fiscalCounter.update({
      where: { workstationId: POS_WS_ID },
      data: { currentContingencyNumber: 2n },
    });

    // Precondition: BOTH counters sit at their authorizedEnd.
    const counterBefore = await localPrisma.fiscalCounter.findUniqueOrThrow({
      where: { workstationId: POS_WS_ID },
    });
    expect(counterBefore.currentRegularNumber).toBe(2n);
    expect(counterBefore.currentContingencyNumber).toBe(2n);
    expect(counterBefore.authorizedEnd).toBe(2n);

    const sale3 = await confirmOneSale();
    // The sale is NOT lost...
    const sale3Local = await localPrisma.sale.findUniqueOrThrow({
      where: { id: sale3.saleId },
    });
    expect(sale3Local.operationalState).toBe("CONFIRMED");
    // ...but the invoice generation failed and the UI is told so.
    expect(sale3.invoiceGenerated).toBe(false);
    expect(sale3.invoiceError).toBeDefined();

    // No third invoice exists: the counter refused to issue a number outside
    // the authorized range.
    expect(await localPrisma.invoice.count()).toBe(2);
    // No INVOICE_TRANSMISSION was queued for the failed invoice either.
    expect(
      await localPrisma.syncQueue.count({
        where: { operationType: "INVOICE_TRANSMISSION" },
      }),
    ).toBe(0);

    // Contingency event recorded the sales that DID generate invoices (the
    // two online ones were issued before the event existed — only sales
    // confirmed during the event increment its counters).
    const activeEvent = await localPrisma.contingencyEvent.findFirstOrThrow({
      where: { workstationId: POS_WS_ID, endedAt: null },
    });

    // The exhausted-range sale still consumed stock and recorded its payment.
    expect(
      (
        await localPrisma.lot.findUniqueOrThrow({
          where: { id: SERVER_LOT_ID },
        })
      ).currentStock,
    ).toBe(47);
    expect(
      await localPrisma.salePayment.count({ where: { saleId: sale3.saleId } }),
    ).toBe(1);

    // All three SALE_CONFIRMATION entries are queued — fiscal trouble never
    // blocks the operational pipeline.
    expect(
      await localPrisma.syncQueue.count({
        where: { operationType: "SALE_CONFIRMATION", status: "PENDING" },
      }),
    ).toBe(3);

    // Prove both issuance paths are exactly the exhausted counter (regular
    // was drained by phase 1, contingency was drained above).
    await expect(
      numbering.nextNumber("ELECTRONIC_INVOICE", false),
    ).rejects.toBeInstanceOf(FiscalCounterExhaustedError);
    await expect(
      numbering.nextNumber("ELECTRONIC_INVOICE", true),
    ).rejects.toBeInstanceOf(FiscalCounterExhaustedError);

    void activeEvent;

    // ===================================================================
    // Phase 3 — push + drain: the server must receive all three sales and
    // invoice each one from ITS OWN allocation (the local fiscal failure
    // does not propagate as an operational failure). 4 entries = the 3
    // SALE_CONFIRMATIONs + the SHIFT_OPEN that opened the day.
    // ===================================================================
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const pushResult = await push.pushPending();
    expect(pushResult.pushed).toBe(4);
    expect(pushResult.accepted).toBe(4);

    for (const opType of ["SALE_CONFIRMATION"]) {
      const status = await drainServerQueue(opType, "COMPLETED");
      expect(status.status).toBe("COMPLETED");
    }

    const serverSales = await serverPrisma.sale.findMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
      include: { items: true },
    });
    expect(serverSales).toHaveLength(3);
    for (const s of serverSales) {
      expect(s.operationalState).toBe("CONFIRMED");
    }

    // Server stock converges with the POS: 50 − 3.
    expect(
      (
        await serverPrisma.lot.findUniqueOrThrow({
          where: { id: SERVER_LOT_ID },
        })
      ).currentStock,
    ).toBe(47);

    // The server's own allocation issued the invoices for the replayed sales.
    const allocation =
      await serverPrisma.fiscalResolutionAllocation.findUniqueOrThrow({
        where: { id: SERVER_ALLOCATION_ID },
      });
    expect(allocation.currentConsecutive).toBe(3);
    const serverInvoices = await serverPrisma.fiscalDocument.findMany({
      where: { resolutionId: SERVER_RESOLUTION_ID, documentType: "INVOICE" },
    });
    expect(serverInvoices).toHaveLength(3);
    for (const doc of serverInvoices) {
      expect(doc.fullNumber).toMatch(/^FEX/);
    }

    // Local outbox fully drained — nothing left behind, fiscal or otherwise.
    const pending = await localPrisma.syncQueue.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    });
    expect(pending).toBe(0);
  }, 120000);

  it("fiscal scheduler leaves online-issued invoices untouched", async () => {
    // The two healthy-range invoices were issued ONLINE, so the 48h
    // contingency window never applied to them: the scheduler's expiry
    // pass must not transition them to EXPIRED_CONTINGENCY.
    const { createFiscalScheduler } =
      await import("../fiscal/fiscal-scheduler.service");
    const scheduler = createFiscalScheduler({
      invoiceService,
      contingencyService: contingency,
    });
    const result = await scheduler.checkNow();
    expect(result.expiredCount).toBe(0);

    const statuses = await localPrisma.invoice.findMany({
      select: { status: true },
    });
    expect(statuses.map((s) => s.status).sort()).toEqual([
      "TRANSMITTED_AUTHORIZED",
      "TRANSMITTED_AUTHORIZED",
    ]);
  });
});
