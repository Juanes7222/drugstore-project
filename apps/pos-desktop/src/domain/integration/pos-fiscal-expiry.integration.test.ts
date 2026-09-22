/**
 * POS ↔ Server integration — contingency transmission window expiry (48h).
 *
 * The scenario: a workstation generates an invoice in contingency mode
 * (CONTINGENCY_PENDING_TRANSMISSION with an INVOICE_TRANSMISSION outbox
 * entry). Two things can then happen, and this spec verifies both:
 *
 *   1. HAPPY PATH — the server's fiscal engine transmits the document to
 *      DIAN and writes the outcome to SyncInvoiceResult; the workstation
 *      polls GET /sync/invoice-results and applies the result: the local
 *      invoice becomes TRANSMITTED_AUTHORIZED with the official CUFE, and
 *      the contingency event counters reflect the transmission.
 *   2. EXPIRY — the window elapses without a transmission result. The
 *      fiscal scheduler's checkNow() transitions the invoice to
 *      EXPIRED_CONTINGENCY and increments the event's invoicesExpired
 *      counter. Crucially, an invoice that WAS transmitted in time must
 *      NOT be touched by the expiry pass.
 *
 * No fiscal machinery is mocked: ContingencyService, InvoiceService,
 * FiscalNumberingService and SalesPosService are the production services
 * running on a real PGlite; the server is the real NestJS app on real
 * Postgres. The fiscal-engine consumer of the fiscal-documents queue is a
 * separate app (not running here), so its DB-side effect — writing the
 * SyncInvoiceResult row — is simulated at the database boundary exactly as
 * apps/fiscal-engine/src/modules/fiscal-processing/contingency-result.writer.ts
 * does it.
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
import { useContingencyStore } from "../fiscal/contingency.store";
import { createSyncPushService } from "../sync/sync-push.service";
import { createSalesPosService } from "../sales-pos/sales-pos.service";
import { createInventoryLotsService } from "../inventory-lots/inventory-lots.service";
import { createFiscalNumberingService } from "../fiscal/numbering.service";
import { createContingencyService } from "../fiscal/contingency.service";
import { createInvoiceService } from "../fiscal/invoice.service";
import { createFiscalScheduler } from "../fiscal/fiscal-scheduler.service";
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

const SUB_SEED = "pos-int-fiscalexpiry";
const SERVER_WS_ID = uuidFrom("pos-int-fiscalexpiry-server-ws");
const SERVER_USER_ID = "pos-int-fiscalexpiry-server-user-id";
const USERNAME = "pos-int-fiscalexpiry@pos.test";
const PASSWORD = "PosFiscalExp123!";
const SERVER_TAX_SCHEME_ID = uuidFrom("pos-int-fiscalexpiry-tax-scheme");
const SERVER_CATEGORY_ID = uuidFrom("pos-int-fiscalexpiry-category");
const SERVER_FORM_ID = uuidFrom("pos-int-fiscalexpiry-form");
const SERVER_PRODUCT_ID = uuidFrom("pos-int-fiscalexpiry-product");
const SERVER_PRICE_HISTORY_ID = uuidFrom("pos-int-fiscalexpiry-price-hist");
const SERVER_TAX_HISTORY_ID = uuidFrom("pos-int-fiscalexpiry-tax-hist");
const SERVER_BARCODE_ID = uuidFrom("pos-int-fiscalexpiry-barcode");
const SERVER_LOT_ID = uuidFrom("pos-int-fiscalexpiry-lot");
const SERVER_RESOLUTION_ID = uuidFrom("pos-int-fiscalexpiry-resolution");
const SERVER_ALLOCATION_ID = uuidFrom("pos-int-fiscalexpiry-allocation");
const SERVER_PM_CASH_ID = uuidFrom("pos-int-fiscalexpiry-pm-cash");
const UNIT_PRICE = 10000;
const SALE_QTY = 1;
const EXPECTED_TOTAL = Math.round(UNIT_PRICE * SALE_QTY * 1.19);

const POS_WS_ID = SERVER_WS_ID;
const POS_USER_ID = SERVER_USER_ID;
const PM_CASH_ID = SERVER_PM_CASH_ID;

describe("POS ↔ Server integration — contingency transmission window expiry", () => {
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
    await serverPrisma.syncInvoiceResult.deleteMany({
      where: { workstationId: SERVER_WS_ID },
    });
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
      where: { sequentialNumber: 990003 },
    });
    await serverPrisma.supplier.deleteMany({
      where: { identificationNumber: "900999997-2" },
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
        name: "FiscalExpiry Workstation",
        code: "WS-FISCALEXPIRY-001",
        isActive: true,
        registeredAt: new Date(),
      },
    });
    const passwordHash = await argon2.hash(PASSWORD);
    await serverPrisma.user.create({
      data: {
        id: SERVER_USER_ID,
        username: USERNAME,
        fullName: "POS FiscalExpiry Cashier",
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
        code: "POS-INT-FISCALEXPIRY-IVA19",
        name: "FiscalExpiry IVA 19%",
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
        name: "FiscalExpiry Analgésicos",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.pharmaceuticalForm.create({
      data: {
        id: SERVER_FORM_ID,
        subscriptionId,
        name: "FiscalExpiry Tableta",
        sortOrder: 1,
        isActive: true,
      },
    });
    await serverPrisma.paymentMethod.create({
      data: {
        id: SERVER_PM_CASH_ID,
        subscriptionId,
        internalCode: "POS-INT-FISCALEXPIRY-CASH",
        name: "FiscalExpiry Cash",
        category: "CASH",
        isCash: true,
      },
    });
    await serverPrisma.product.create({
      data: {
        id: SERVER_PRODUCT_ID,
        subscriptionId,
        internalCode: "POS-INT-FISCALEXPIRY-A",
        commercialName: "FiscalExpiry Product A",
        laboratory: "FiscalExpiry Lab",
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
        barcode: "7701234000040",
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
        id: uuidFrom("pos-int-fiscalexpiry-reception"),
        subscriptionId,
        sequentialNumber: 990003,
        state: "CONFIRMED",
        supplierId: (
          await serverPrisma.supplier.create({
            data: {
              id: uuidFrom("pos-int-fiscalexpiry-supplier"),
              subscriptionId,
              identificationType: "NIT",
              identificationNumber: "900999997-2",
              businessName: "FiscalExpiry Supplier",
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
            id: uuidFrom("pos-int-fiscalexpiry-reception-item"),
            subscriptionId,
            productId: SERVER_PRODUCT_ID,
            receivedQuantity: 50,
            lotId: SERVER_LOT_ID,
            lotNumber: "FISCALEXPIRY-BATCH-1",
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
        batchNumber: "FISCALEXPIRY-BATCH-1",
        currentStock: 50,
        entryDate: new Date("2026-01-01"),
        expirationDate: new Date("2027-12-31"),
      },
    });
    // DIAN resolution + allocation: a healthy range — the server invoices
    // every replayed sale from its own allocation.
    await serverPrisma.fiscalResolution.create({
      data: {
        id: SERVER_RESOLUTION_ID,
        subscriptionId,
        resolutionNumber: "18764000998878",
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
        internalCode: "POS-INT-FISCALEXPIRY-CASH",
        name: "FiscalExpiry Cash",
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
      fullName: "POS FiscalExpiry Cashier",
      displayName: "POS FiscalExpiry Cashier",
      role: "ADMIN",
      subscriptionId,
      workstationId: POS_WS_ID,
      accessToken: serverToken,
      refreshToken: "refresh-token-pos-int-fiscalexpiry",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      sessionId: "pos-int-fiscalexpiry-session-1",
      totpEnabled: false,
      sessionTrust: "SERVER_VERIFIED",
      offlineToken: null,
      locationIds: [],
    });
    useContingencyStore.getState().exit();

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
    await catalog.applyCatalog(await catalog.fetchCatalog());
    await lotSync.applyLots(await lotSync.fetchLots());
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
      select: { serverId: true },
    });
    expect(pulledProduct.serverId).toBe(SERVER_PRODUCT_ID);
  }, 120000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (localPrisma) await localPrisma.$disconnect();
    if (pg) await pg.close();

    if (serverPrisma) {
      const serverSaleWhere = { cashShift: { workstationId: SERVER_WS_ID } };
      await serverPrisma.syncInvoiceResult.deleteMany({
        where: { workstationId: SERVER_WS_ID },
      });
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

  it("contingency invoice: transmission result applies in time; expired window transitions via scheduler", async () => {
    // ===================================================================
    // Phase 1 — healthy range, online: one sale gets a regular invoice.
    // ===================================================================
    const { CashShiftService: CashShift } =
      await import("../cash-shift/cash-shift.service");
    const cashShift = new CashShift(localPrisma, {
      requireRole: () => useLocalSessionStore.getState().session!,
    } as any);
    await cashShift.openShift({ openingBalance: new Prisma.Decimal("100000") });

    // Local counter: plenty of room in both ranges — the sale in
    // contingency will take number 1 from the CONT counter.
    await numbering.initializeCounters({
      workstationId: POS_WS_ID,
      currentRegularNumber: 0,
      currentContingencyNumber: 0,
      resolutionPrefix: "FEX",
      authorizedStart: 1,
      authorizedEnd: 100,
      paddingLength: 8,
    });

    const onlineSale = await confirmOneSale();
    expect(onlineSale.invoiceGenerated).toBe(true);
    const onlineInvoice = await localPrisma.invoice.findFirstOrThrow({
      where: { saleId: onlineSale.saleId },
    });
    expect(onlineInvoice.status).toBe("TRANSMITTED_AUTHORIZED");
    expect(onlineInvoice.contingencyEventId).toBeNull();

    // ===================================================================
    // Phase 2 — contingency active: the next sale is invoiced from the
    // CONT counter and lands in CONTINGENCY_PENDING_TRANSMISSION with an
    // INVOICE_TRANSMISSION outbox entry (the 48h window starts).
    // ===================================================================
    await contingency.enterContingency(
      "NETWORK_LOST",
      "Test: DIAN unreachable — contingency invoicing with a live window.",
    );
    expect(await contingency.isInContingency()).toBe(true);

    const contingencySale = await confirmOneSale();
    expect(contingencySale.invoiceGenerated).toBe(true);
    const pendingInvoice = await localPrisma.invoice.findFirstOrThrow({
      where: { saleId: contingencySale.saleId },
    });
    expect(pendingInvoice.status).toBe("CONTINGENCY_PENDING_TRANSMISSION");
    expect(pendingInvoice.contingencyNumber).toBe(pendingInvoice.invoiceNumber);
    expect(pendingInvoice.contingencyEventId).toBeTruthy();
    // The window: issuedAt + 48h.
    const windowMs =
      pendingInvoice.expiresAt.getTime() - pendingInvoice.issuedAt.getTime();
    expect(windowMs).toBe(48 * 60 * 60 * 1000);

    const activeEvent = await localPrisma.contingencyEvent.findFirstOrThrow({
      where: { workstationId: POS_WS_ID, endedAt: null },
    });
    expect(activeEvent.invoicesGenerated).toBe(1);

    // Exactly one INVOICE_TRANSMISSION is queued, PENDING, tied to this
    // invoice — this is what the sync pushes to the server when online
    // (or when connectivity is restored).
    const transmissionEntry = await localPrisma.syncQueue.findFirstOrThrow({
      where: { operationType: "INVOICE_TRANSMISSION" },
    });
    expect(transmissionEntry.status).toBe("PENDING");
    const transmissionPayload = JSON.parse(transmissionEntry.payload) as {
      invoiceId: string;
      saleId: string;
      provisionalCufe: string;
    };
    expect(transmissionPayload.invoiceId).toBe(pendingInvoice.id);

    // ===================================================================
    // Phase 3 — push + drain: the server receives the transmission. The
    // dispatcher validates the payload, creates a FiscalDocument in
    // CONTINGENCY state for the sale, and enqueues the fiscal-engine job
    // (whose consumer is a separate app — not running here).
    // ===================================================================
    const push = createSyncPushService({
      prisma: localPrisma,
      baseUrl: `http://127.0.0.1:${serverPort}`,
      accessToken: serverToken,
    });
    const pushResult = await push.pushPending();
    // 3 = SHIFT_OPEN + 2 × SALE_CONFIRMATION + 1 × INVOICE_TRANSMISSION.
    expect(pushResult.pushed).toBeGreaterThanOrEqual(1);
    expect(pushResult.accepted).toBe(pushResult.pushed);

    const transmissionDrain = await drainServerQueue(
      "INVOICE_TRANSMISSION",
      "COMPLETED",
    );
    expect(transmissionDrain.status).toBe("COMPLETED");

    // The dispatcher created the CONTINGENCY FiscalDocument for the sale.
    // The transmission payload's saleId is the POS's LOCAL sale id (the
    // server sale — from the replay — has its own id), so locate the
    // contingency document by the provisional CUFE it carries.
    const serverDoc = await serverPrisma.fiscalDocument.findFirstOrThrow({
      where: {
        fiscalState: "CONTINGENCY",
        cufeCude: pendingInvoice.cufeProvisional,
      },
    });
    expect(serverDoc.saleId).toBe(transmissionPayload.saleId);
    expect(serverDoc.cufeCude).toBe(pendingInvoice.cufeProvisional);

    // ===================================================================
    // Phase 4 — fiscal-engine effect simulated at the DB boundary (the
    // consumer lives in apps/fiscal-engine): it validates the document and
    // writes the outcome to SyncInvoiceResult, exactly like
    // ContingencyResultWriter.writeForDocument does.
    // ===================================================================
    await serverPrisma.fiscalDocument.update({
      where: { id: serverDoc.id },
      data: {
        fiscalState: "VALIDATED",
        cufeCude: "f".repeat(96),
        signedXml: "<Invoice>official-dian-xml</Invoice>",
      },
    });
    await serverPrisma.syncInvoiceResult.upsert({
      where: { id: uuidFrom("pos-int-fiscalexpiry-invoice-result") },
      create: {
        id: uuidFrom("pos-int-fiscalexpiry-invoice-result"),
        subscriptionId,
        // The corrected ContingencyResultWriter uses doc.saleId — the POS's
        // LOCAL sale id that traveled in the transmission payload. The POS
        // matches it back via Invoice.saleId (fallback in applyTransmissionResult).
        invoiceId: serverDoc.saleId as string,
        workstationId: SERVER_WS_ID,
        status: "AUTHORIZED",
        cufeOfficial: "f".repeat(96),
        dianXml: "<Invoice>official-dian-xml</Invoice>",
        authorizedAt: new Date(),
      },
      update: {
        status: "AUTHORIZED",
        cufeOfficial: "f".repeat(96),
        dianXml: "<Invoice>official-dian-xml</Invoice>",
        authorizedAt: new Date(),
      },
    });

    // The POS polls /sync/invoice-results and applies the outcome.
    const applied = await invoiceService.pullAndApplyResults(
      `http://127.0.0.1:${serverPort}`,
      serverToken,
    );
    expect(applied).toBe(1);

    const transmittedInvoice = await localPrisma.invoice.findUniqueOrThrow({
      where: { id: pendingInvoice.id },
    });
    expect(transmittedInvoice.status).toBe("TRANSMITTED_AUTHORIZED");
    expect(transmittedInvoice.cufeOfficial).toBe("f".repeat(96));
    expect(transmittedInvoice.fiscalXml).toContain("official-dian-xml");
    expect(transmittedInvoice.transmittedAt).toBeTruthy();

    // The contingency event counters reflect the transmission.
    const eventAfterTransmission =
      await localPrisma.contingencyEvent.findUniqueOrThrow({
        where: { id: activeEvent.id },
      });
    expect(eventAfterTransmission.invoicesTransmitted).toBe(1);
    expect(eventAfterTransmission.invoicesExpired).toBe(0);

    // ===================================================================
    // Phase 5 — a SECOND contingency invoice is left untransmitted past
    // its window. The scheduler's expiry pass must transition exactly that
    // one to EXPIRED_CONTINGENCY and leave the transmitted invoice alone.
    // ===================================================================
    const secondSale = await confirmOneSale();
    expect(secondSale.invoiceGenerated).toBe(true);
    const expiringInvoice = await localPrisma.invoice.findFirstOrThrow({
      where: { saleId: secondSale.saleId },
    });
    expect(expiringInvoice.status).toBe("CONTINGENCY_PENDING_TRANSMISSION");

    // The 48h window elapses without a transmission result for this one.
    await localPrisma.invoice.update({
      where: { id: expiringInvoice.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const scheduler = createFiscalScheduler({
      invoiceService,
      contingencyService: contingency,
    });
    const check = await scheduler.checkNow();
    expect(check.expiredCount).toBe(1);

    const expiredInvoice = await localPrisma.invoice.findUniqueOrThrow({
      where: { id: expiringInvoice.id },
    });
    expect(expiredInvoice.status).toBe("EXPIRED_CONTINGENCY");

    // The transmitted invoice is untouched by the expiry pass — the window
    // only applies to invoices still pending transmission.
    const stillTransmitted = await localPrisma.invoice.findUniqueOrThrow({
      where: { id: transmittedInvoice.id },
    });
    expect(stillTransmitted.status).toBe("TRANSMITTED_AUTHORIZED");

    // The online invoice was never in a window either.
    const stillOnline = await localPrisma.invoice.findUniqueOrThrow({
      where: { id: onlineInvoice.id },
    });
    expect(stillOnline.status).toBe("TRANSMITTED_AUTHORIZED");

    // The event counters now include the expiry.
    const eventAfterExpiry =
      await localPrisma.contingencyEvent.findUniqueOrThrow({
        where: { id: activeEvent.id },
      });
    expect(eventAfterExpiry.invoicesExpired).toBe(1);

    // The expired invoice's INVOICE_TRANSMISSION entry was never pushed
    // (no result arrived in time): it stays COMPLETED from the successful
    // push earlier... actually only the FIRST transmission was pushed; the
    // second invoice's entry — created during Phase 5 — must still be
    // PENDING. The DISCARDED transition is a separate sync-recovery flow;
    // the fiscal scheduler only fixes the invoice status.
    const untransmittedEntries = await localPrisma.syncQueue.findMany({
      where: { operationType: "INVOICE_TRANSMISSION" },
      select: { status: true, payload: true },
    });
    const pendingTransmission = untransmittedEntries.find(
      (e) => e.status === "PENDING",
    );
    expect(pendingTransmission).toBeDefined();
    const pendingPayload = JSON.parse(pendingTransmission!.payload) as {
      invoiceId: string;
    };
    expect(pendingPayload.invoiceId).toBe(expiringInvoice.id);

    // ===================================================================
    // Phase 6 — drain the remaining operational entries (2 sales pushed
    // earlier + 1 new SALE_CONFIRMATION + SHIFT_OPEN). The server replays
    // every sale CONFIRMED and invoices each from its own allocation.
    // ===================================================================
    const finalPush = await push.pushPending();
    void finalPush;
    const saleDrain = await drainServerQueue("SALE_CONFIRMATION", "COMPLETED");
    expect(saleDrain.status).toBe("COMPLETED");

    const serverSales = await serverPrisma.sale.findMany({
      where: { cashShift: { workstationId: SERVER_WS_ID } },
    });
    expect(serverSales).toHaveLength(3);
    for (const s of serverSales) {
      expect(s.operationalState).toBe("CONFIRMED");
    }
  }, 120000);
});
