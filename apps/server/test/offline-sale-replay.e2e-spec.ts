import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';
import { SyncProcessingJob } from '../src/modules/sync/jobs/sync-processing.job';
import { seedSubscription } from './helpers/subscription-seed';

/**
 * End-to-end test of the money flow: an offline sale pushed through
 * POST /sync/batch as a SALE_CONFIRMATION and replayed by the server.
 *
 * This is the exact payload shape sales-pos.service.ts builds in
 * createSyncQueueEntry() (userId, createSaleDto with snapshotted totals,
 * confirmSaleDto with payments, metadata with localSaleId/localNumber)
 * and the exact handler the dispatcher routes it to
 * (handleSaleConfirmation → salesService.create + confirm).
 *
 * The assertions are on persisted rows — Sale, SaleItem, SalePayment,
 * SaleItemLot (FIFO stock consumption) — never on HTTP codes alone.
 * No spec covered this path before: a broken replay would have been
 * invisible until a customer's offline sale failed to exist on the server.
 */

const uuidFrom = (seed: string): string => {
  const h = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
};

const WORKSTATION_ID = uuidFrom('e2e-sale-sync-ws');
const USER_ID = 'e2e-sale-sync-user-id';
const USERNAME = 'e2e-sale-sync@sale.test';
const PASSWORD = 'SaleSyncPass123!';
const PRODUCT_ID = uuidFrom('e2e-sale-sync-product');
const TAX_SCHEME_ID = uuidFrom('e2e-sale-sync-tax-scheme');
const LOT_ID = uuidFrom('e2e-sale-sync-lot');
const CASH_PM_ID = uuidFrom('e2e-sale-sync-pm-cash');
const DEBIT_PM_ID = uuidFrom('e2e-sale-sync-pm-debit');
const SUPPLIER_ID = uuidFrom('e2e-sale-sync-supplier');
const RECEPTION_ID = uuidFrom('e2e-sale-sync-reception');
const RECEPTION_ITEM_ID = uuidFrom('e2e-sale-sync-reception-item');
const RESOLUTION_ID = uuidFrom('e2e-sale-sync-resolution');
const ALLOCATION_ID = uuidFrom('e2e-sale-sync-allocation');

const LOCAL_SALE_ID = uuidFrom('e2e-sale-sync-local-sale');
const SALE_OP_UUID = uuidFrom('e2e-sale-sync-op-sale');
const SECOND_SALE_OP_UUID = uuidFrom('e2e-sale-sync-op-second-sale');

const INITIAL_STOCK = 100;
const SALE_QTY = 3;
const UNIT_PRICE = '15000.00';
// Product taxed at 19% IVA: 3 × 15000 × 1.19 = 53550
const SALE_TOTAL = '53550.00';
const SALE_SUBTOTAL = '45000.00';
const SALE_TAX = '8550.00';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sha256 = (value: unknown): string =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Mirrors sales-pos.service.ts createSyncQueueEntry: everything the server's
 * handleSaleConfirmation needs to replay the sale server-side.
 */
const buildSaleConfirmationPayload = (overrides?: {
  localSaleId?: string;
  clientShiftId?: string;
}) => ({
  userId: USER_ID,
  createSaleDto: {
    saleType: 'FREE_SALE',
    clientId: null,
    cashShiftId: overrides?.clientShiftId ?? LOCAL_SALE_ID,
    items: [
      {
        productId: PRODUCT_ID,
        quantity: SALE_QTY,
        unitPrice: UNIT_PRICE,
      },
    ],
    prescriptionNumber: null,
    delivery: null,
    subtotal: SALE_SUBTOTAL,
    totalDiscount: '0.00',
    totalTax: SALE_TAX,
    totalAmount: SALE_TOTAL,
  },
  confirmSaleDto: {
    payments: [
      {
        paymentMethodId: CASH_PM_ID,
        amount: SALE_TOTAL,
        transactionReference: null,
        authorizationCode: null,
        cardBrand: null,
        cardLastFour: null,
        batchNumber: null,
        processorResponseCode: null,
      },
    ],
  },
  metadata: {
    localSaleId: overrides?.localSaleId ?? LOCAL_SALE_ID,
    localNumber: 1,
    workstationId: WORKSTATION_ID,
    sourceWorkstationId: WORKSTATION_ID,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    confirmedAt: new Date().toISOString(),
  },
});

describe('Offline sale replay (SALE_CONFIRMATION e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let subscriptionId: string;
  let token: string;

  const sendBatch = (operations: unknown[]) =>
    request(app.getHttpServer())
      .post('/sync/batch')
      .set('Authorization', `Bearer ${token}`)
      .send(operations);

  /** Ticks the cron until the queue row leaves PENDING. */
  const tickUntilProcessed = async (operationUuid: string) => {
    const job = app.get(SyncProcessingJob);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await job.processPendingOperations();
      const row = await prisma.syncQueue.findUnique({
        where: { operationUuid },
        select: { status: true, lastErrorMessage: true },
      });
      if (row && row.status !== 'PENDING') return row;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return prisma.syncQueue.findUnique({
      where: { operationUuid },
      select: { status: true, lastErrorMessage: true },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    subscriptionId = await seedSubscription(prisma, 'sale-sync');

    // ── Cleanup (children before parents) ────────────────────────────
    await prisma.syncOperationOutcome.deleteMany({ where: { subscriptionId } });
    await prisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: LOT_ID } });
    await prisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: WORKSTATION_ID } } },
    });
    await prisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: WORKSTATION_ID } } },
    });
    await prisma.sale.deleteMany({
      where: { cashShift: { workstationId: WORKSTATION_ID } },
    });
    await prisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: WORKSTATION_ID } },
    });
    await prisma.cashShift.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.inventoryMovement.deleteMany({ where: { lotId: LOT_ID } });
    await prisma.lot.deleteMany({ where: { id: LOT_ID } });
    await prisma.purchaseReceptionItem.deleteMany({
      where: { lotId: LOT_ID },
    });
    await prisma.purchaseReception.deleteMany({ where: { id: RECEPTION_ID } });
    await prisma.supplier.deleteMany({ where: { id: SUPPLIER_ID } });
    await prisma.productTaxHistory.deleteMany({
      where: { productId: PRODUCT_ID },
    });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: PRODUCT_ID },
    });
    await prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({
      where: { id: { in: [CASH_PM_ID, DEBIT_PM_ID] } },
    });
    await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
    await prisma.fiscalDocument.deleteMany({
      where: { resolution: { workstationId: WORKSTATION_ID } },
    });
    await prisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.fiscalResolution.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.userSession.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.workstation.deleteMany({ where: { id: WORKSTATION_ID } });

    // ── Seed (mirrors sale-lifecycle.e2e-spec) ───────────────────────
    await prisma.workstation.create({
      data: {
        id: WORKSTATION_ID,
        name: 'E2E Sale Sync Workstation',
        code: 'WS-E2E-SALE-SYNC',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    const passwordHash = await argon2.hash(PASSWORD);
    await prisma.user.create({
      data: {
        id: USER_ID,
        username: USERNAME,
        fullName: 'E2E Sale Sync Cashier',
        passwordHash,
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        subscriptionId,
        isActive: true,
      },
    });

    await prisma.taxScheme.create({
      data: {
        id: TAX_SCHEME_ID,
        subscriptionId,
        code: 'E2E-SS-IVA19',
        name: 'E2E Sale Sync IVA 19%',
        taxType: 'IVA',
        rate: new Prisma.Decimal('0.1900'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
        createdById: USER_ID,
      },
    });

    await prisma.product.create({
      data: {
        id: PRODUCT_ID,
        subscriptionId,
        internalCode: 'E2E-SS-PROD-001',
        commercialName: 'E2E Sale Sync Product',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: USER_ID,
      },
    });

    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        id: uuidFrom('e2e-sale-sync-price-hist'),
        subscriptionId,
        productId: PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: USER_ID,
        changedAt: new Date(),
      },
    });
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        id: uuidFrom('e2e-sale-sync-tax-hist'),
        subscriptionId,
        productId: PRODUCT_ID,
        taxSchemeId: TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: USER_ID,
        changedAt: new Date(),
      },
    });
    await prisma.product.update({
      where: { id: PRODUCT_ID },
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });

    await prisma.lot.create({
      data: {
        id: LOT_ID,
        subscriptionId,
        batchNumber: 'E2E-SS-BATCH',
        expirationDate: new Date('2027-12-31'),
        entryDate: new Date('2026-01-01'),
        state: 'ACTIVE',
        currentStock: INITIAL_STOCK,
        version: 0,
        productId: PRODUCT_ID,
      },
    });

    // FIFO stock consumption needs a real unit cost from a reception.
    await prisma.supplier.create({
      data: {
        subscriptionId,
        id: SUPPLIER_ID,
        identificationType: 'NIT',
        identificationNumber: '900999999-1',
        businessName: 'E2E Sale Sync Supplier SA',
        createdById: USER_ID,
      },
    });
    await prisma.purchaseReception.create({
      data: {
        subscriptionId,
        id: RECEPTION_ID,
        sequentialNumber: 1,
        state: 'CONFIRMED',
        receivedAt: new Date('2026-01-01'),
        createdById: USER_ID,
        supplierId: SUPPLIER_ID,
      },
    });
    await prisma.purchaseReceptionItem.create({
      data: {
        subscriptionId,
        id: RECEPTION_ITEM_ID,
        purchaseReceptionId: RECEPTION_ID,
        productId: PRODUCT_ID,
        lotId: LOT_ID,
        receivedQuantity: INITIAL_STOCK,
        lotNumber: 'E2E-SS-BATCH',
        expirationDate: new Date('2027-12-31'),
        realUnitCost: new Prisma.Decimal('8000.00'),
        taxSchemeId: TAX_SCHEME_ID,
        taxRate: new Prisma.Decimal('0.1900'),
        taxAmount: new Prisma.Decimal('0.00'),
        subtotal: new Prisma.Decimal('800000.00'),
        total: new Prisma.Decimal('952000.00'),
      },
    });

    // Confirming a sale allocates an INVOICE number from the workstation's
    // active fiscal resolution; without it the flow fails with 412.
    await prisma.fiscalResolution.create({
      data: {
        subscriptionId,
        id: RESOLUTION_ID,
        resolutionNumber: 'E2E-SS-RES-001',
        documentType: 'INVOICE',
        prefix: 'E2SS',
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2099-12-31'),
        state: 'ACTIVE',
        workstationId: WORKSTATION_ID,
      },
    });
    await prisma.fiscalResolutionAllocation.create({
      data: {
        subscriptionId,
        id: ALLOCATION_ID,
        resolutionId: RESOLUTION_ID,
        workstationId: WORKSTATION_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date('2024-01-01'),
        allocatedByUserId: USER_ID,
      },
    });

    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: CASH_PM_ID,
        internalCode: 'E2E-SS-CASH',
        name: 'E2E Sale Sync Cash',
        category: 'CASH',
        isCash: true,
      },
    });
    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: DEBIT_PM_ID,
        internalCode: 'E2E-SS-DEBIT',
        name: 'E2E Sale Sync Debit',
        category: 'DEBIT_CARD',
        isCash: false,
      },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
      })
      .expect(200);
    token = res.body.accessToken as string;
  }, 60000);

  afterAll(async () => {
    await prisma.syncOperationOutcome.deleteMany({ where: { subscriptionId } });
    await prisma.syncQueue.deleteMany({ where: { subscriptionId } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: LOT_ID } });
    await prisma.saleItem.deleteMany({
      where: { sale: { cashShift: { workstationId: WORKSTATION_ID } } },
    });
    await prisma.salePayment.deleteMany({
      where: { sale: { cashShift: { workstationId: WORKSTATION_ID } } },
    });
    await prisma.sale.deleteMany({
      where: { cashShift: { workstationId: WORKSTATION_ID } },
    });
    await prisma.shiftCashCount.deleteMany({
      where: { cashShift: { workstationId: WORKSTATION_ID } },
    });
    await prisma.cashShift.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.inventoryMovement.deleteMany({ where: { lotId: LOT_ID } });
    await prisma.lot.deleteMany({ where: { id: LOT_ID } });
    await prisma.purchaseReceptionItem.deleteMany({
      where: { lotId: LOT_ID },
    });
    await prisma.purchaseReception.deleteMany({ where: { id: RECEPTION_ID } });
    await prisma.supplier.deleteMany({ where: { id: SUPPLIER_ID } });
    await prisma.productTaxHistory.deleteMany({
      where: { productId: PRODUCT_ID },
    });
    await prisma.productPriceHistory.deleteMany({
      where: { productId: PRODUCT_ID },
    });
    await prisma.product.deleteMany({ where: { id: PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({
      where: { id: { in: [CASH_PM_ID, DEBIT_PM_ID] } },
    });
    await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
    await prisma.fiscalDocument.deleteMany({
      where: { resolution: { workstationId: WORKSTATION_ID } },
    });
    await prisma.fiscalResolutionAllocation.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.fiscalResolution.deleteMany({
      where: { workstationId: WORKSTATION_ID },
    });
    await prisma.userSession.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.workstation.deleteMany({ where: { id: WORKSTATION_ID } });

    await app.close();
    await prisma.$disconnect();
  }, 60000);

  it('replays an offline sale pushed through /sync/batch into real Sale, items, payments, and stock rows', async () => {
    // The POS builds this payload locally at confirm time (same shape as
    // createSyncQueueEntry) and enqueues it; the push service delivers it.
    const payload = buildSaleConfirmationPayload();
    const operation = {
      operationType: 'SALE_CONFIRMATION',
      operationUuid: SALE_OP_UUID,
      payload,
      payloadHash: sha256(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence: 101,
      source: 'DIRECT',
    };

    // SALE_CONFIRMATION is NOT an immediate-dispatch type: accepted and
    // queued, applied later by the cron. Stock is untouched at this point.
    const res = await sendBatch([operation]).expect(202);
    expect(res.body[0].status).toBe('ACCEPTED');
    expect(
      await prisma.lot
        .findUnique({ where: { id: LOT_ID } })
        .then((l) => l?.currentStock),
    ).toBe(INITIAL_STOCK);

    const row = await tickUntilProcessed(SALE_OP_UUID);
    // Surface the handler's reason when the application breaks.
    expect({
      status: row?.status,
      lastErrorMessage: row?.lastErrorMessage,
    }).toEqual({ status: 'COMPLETED', lastErrorMessage: null });

    // ── The sale exists on the server with the POS's snapshotted totals ──
    const sale = await prisma.sale.findFirstOrThrow({
      where: { sourceOperationUuid: SALE_OP_UUID },
      include: {
        items: { include: { lots: true } },
        payments: true,
      },
    });
    expect(sale.subscriptionId).toBe(subscriptionId);
    expect(sale.workstationId).toBe(WORKSTATION_ID);
    expect(sale.sourceWorkstationId).toBe(WORKSTATION_ID);
    expect(sale.operationalState).toBe('CONFIRMED');
    expect(sale.userId).toBe(USER_ID);
    // Snapshotted totals win over recomputation — the POS is authoritative
    // for what the customer actually paid.
    expect(Number(sale.totalAmount)).toBe(Number(SALE_TOTAL));
    expect(Number(sale.subtotal)).toBe(Number(SALE_SUBTOTAL));
    expect(Number(sale.totalTax)).toBe(Number(SALE_TAX));
    // Server numbering: sequential per workstation starting at 1.
    expect(Number(sale.localNumber)).toBe(1);

    // ── Items and FIFO lot consumption ────────────────────────────────
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].productId).toBe(PRODUCT_ID);
    expect(sale.items[0].quantity).toBe(SALE_QTY);
    expect(Number(sale.items[0].unitPrice)).toBe(Number(UNIT_PRICE));
    expect(sale.items[0].lots).toHaveLength(1);
    expect(sale.items[0].lots[0].lotId).toBe(LOT_ID);
    expect(sale.items[0].lots[0].quantity).toBe(SALE_QTY);

    // ── Payments persisted as the POS recorded them ───────────────────
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0].paymentMethodId).toBe(CASH_PM_ID);
    expect(Number(sale.payments[0].amount)).toBe(Number(SALE_TOTAL));

    // ── Stock consumed from the lot ───────────────────────────────────
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: LOT_ID } });
    expect(lot.currentStock).toBe(INITIAL_STOCK - SALE_QTY);

    // ── Inventory movement recorded (positive quantity, SALE type) ────
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { lotId: LOT_ID, movementType: 'SALE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement.quantity).toBe(SALE_QTY);

    // ── Outcome ledger ────────────────────────────────────────────────
    const outcomes = await prisma.syncOperationOutcome.findMany({
      where: { operationUuid: SALE_OP_UUID },
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('ACCEPTED');
    expect(outcomes[0].workstationId).toBe(WORKSTATION_ID);
  }, 60000);

  it('replays the same sale again without duplicating any persisted row', async () => {
    const payload = buildSaleConfirmationPayload();
    const operation = {
      operationType: 'SALE_CONFIRMATION',
      operationUuid: SALE_OP_UUID,
      payload,
      payloadHash: sha256(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence: 101,
      source: 'DIRECT',
    };

    const res = await sendBatch([operation]).expect(202);
    // Lost-response retry: the server recognises the operationUuid and does
    // not create a second sale.
    expect(res.body[0].status).toBe('ALREADY_ACCEPTED');

    await tickUntilProcessed(SALE_OP_UUID).then((row) => {
      expect(row?.status).toBe('COMPLETED');
    });

    const saleCount = await prisma.sale.count({
      where: { sourceOperationUuid: SALE_OP_UUID },
    });
    expect(saleCount).toBe(1);

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: LOT_ID } });
    // Stock consumed exactly once — a second consumption here is the
    // double-apply failure mode the operationUuid guard exists for.
    expect(lot.currentStock).toBe(INITIAL_STOCK - SALE_QTY);
  }, 60000);

  it('replays two offline sales from the same workstation with sequential local numbers', async () => {
    const payload = buildSaleConfirmationPayload({
      localSaleId: uuidFrom('e2e-sale-sync-local-sale-2'),
    });
    const operation = {
      operationType: 'SALE_CONFIRMATION',
      operationUuid: SECOND_SALE_OP_UUID,
      payload,
      payloadHash: sha256(payload),
      sourceCreatedAt: new Date().toISOString(),
      clientSequence: 102,
      source: 'DIRECT',
    };

    const res = await sendBatch([operation]).expect(202);
    expect(res.body[0].status).toBe('ACCEPTED');

    const row = await tickUntilProcessed(SECOND_SALE_OP_UUID);
    expect({
      status: row?.status,
      lastErrorMessage: row?.lastErrorMessage,
    }).toEqual({ status: 'COMPLETED', lastErrorMessage: null });

    const sales = await prisma.sale.findMany({
      where: { sourceWorkstationId: WORKSTATION_ID },
      orderBy: { localNumber: 'asc' },
      select: { localNumber: true, operationalState: true },
    });
    expect(sales).toHaveLength(2);
    // The advisory lock serialised numbering: 1 then 2, no reuse.
    expect(sales.map((s) => Number(s.localNumber))).toEqual([1, 2]);
    expect(sales.every((s) => s.operationalState === 'CONFIRMED')).toBe(true);

    // Both consumptions landed: 100 − 3 − 3.
    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: LOT_ID } });
    expect(lot.currentStock).toBe(INITIAL_STOCK - 2 * SALE_QTY);
  }, 60000);
});
