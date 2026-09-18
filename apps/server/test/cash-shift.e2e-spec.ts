import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedSubscription } from './helpers/subscription-seed';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ValidationPipe } from '@nestjs/common';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';

// UUID-shaped. Values are deterministic (uuidv5-style from the legacy names)
// so reruns reuse the same rows.
const uuidFrom = (seed: string): string => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const h = createHash('sha256').update(seed).digest('hex');
  // Force RFC 4122 v4 shape (zod's z.uuid() validates version/variant bits):
  // 13th hex nibble = '4', 17th = 8/9/a/b.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
};

const TEST_WORKSTATION_ID = uuidFrom('e2e-ws-cs-001');
const TEST_ADMIN_USERNAME = 'e2e-admin@cs.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_PRODUCT_ID = uuidFrom('e2e-cs-product-id-001');
const TEST_TAX_SCHEME_ID = uuidFrom('e2e-cs-tax-scheme-001');
const TEST_LOT_ID = uuidFrom('e2e-cs-lot-id-001');
const TEST_CASH_PM_ID = uuidFrom('e2e-cs-pm-cash-001');
const TEST_DEBIT_PM_ID = uuidFrom('e2e-cs-pm-debit-001');
const INITIAL_LOT_STOCK = 50;
const SALE_QUANTITY = 2;
const UNIT_PRICE = '25000.00';
const OPENING_BALANCE = '100000.00';
const DECLARED_CASH = 55000; // Slightly more than expected (50000)
const DECLARED_DEBIT = 0;

describe('Cash shift closing with difference (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let shiftId: string;
  let saleId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    // Multi-tenant schema: every operational row requires a subscription.
    const subscriptionId = await seedSubscription(prisma, 'cashshift');

    // Clean up any leftover data
    await prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.purchaseReceptionItem.deleteMany({ where: { purchaseReceptionId: uuidFrom('e2e-cs-reception-001') } });
    await prisma.purchaseReception.deleteMany({ where: { supplierId: uuidFrom('e2e-cs-supplier-001') } });
    await prisma.supplier.deleteMany({ where: { id: uuidFrom('e2e-cs-supplier-001') } });
    await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
    await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID, TEST_DEBIT_PM_ID] } } });
    await prisma.auditLog.deleteMany({ where: { userId: 'e2e-cs-admin-id' } });
    await prisma.userSession.deleteMany({ where: { userId: 'e2e-cs-admin-id' } });
    await prisma.user.deleteMany({ where: { username: TEST_ADMIN_USERNAME } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Cash Shift Test Workstation',
        code: 'WS-E2E-CS-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Admin user
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-cs-admin-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E Cash Shift Admin',
        passwordHash: adminHash,
        passwordAlgorithm: 'argon2',
        role: 'ADMIN',
        subscriptionId,
        isActive: true,
      },
    });

    // Seed: Tax scheme
    await prisma.taxScheme.create({
      data: {
        createdById: 'e2e-cs-admin-id',
        subscriptionId,
        id: TEST_TAX_SCHEME_ID,
        code: 'IVA0',
        name: 'IVA 0%',
        taxType: 'IVA',
        rate: new Prisma.Decimal('0.0000'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
      },
    });

    // Seed: Product
    await prisma.product.create({
      data: {
        subscriptionId,
        id: TEST_PRODUCT_ID,
        internalCode: 'E2E-CS-PROD-001',
        commercialName: 'E2E Cash Shift Product',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: 'e2e-cs-admin-id',
      },
    });

    // Seed: Product price history
    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-cs-price-hist-001',
        productId: TEST_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: 'e2e-cs-admin-id',
        changedAt: new Date(),
      },
    });

    // Seed: Product tax history
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-cs-tax-hist-001',
        productId: TEST_PRODUCT_ID,
        taxSchemeId: TEST_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: 'e2e-cs-admin-id',
        changedAt: new Date(),
      },
    });

    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });

    // Seed: Lot with stock
    await prisma.lot.create({
      data: {
        subscriptionId,
        id: TEST_LOT_ID,
        batchNumber: 'E2E-CS-BATCH-001',
        expirationDate: new Date('2027-12-31'),
        entryDate: new Date('2024-06-01'),
        state: 'ACTIVE',
        currentStock: INITIAL_LOT_STOCK,
        version: 0,
        productId: TEST_PRODUCT_ID,
      },
    });

    // Seed: Purchase reception giving the lot a real unit cost. The sale
    // confirmation consumes stock via FIFO and requires
    // PurchaseReceptionItem.realUnitCost; without it the flow fails with
    // LotCostUnavailableException.
    const supplier = await prisma.supplier.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-cs-supplier-001'),
        identificationType: 'NIT',
        identificationNumber: '900123456-3',
        businessName: 'E2E CS Supplier SA',
        createdById: 'e2e-cs-admin-id',
      },
    });
    const reception = await prisma.purchaseReception.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-cs-reception-001'),
        sequentialNumber: 1,
        state: 'CONFIRMED',
        receivedAt: new Date('2024-06-01'),
        createdById: 'e2e-cs-admin-id',
        supplierId: supplier.id,
      },
    });
    await prisma.purchaseReceptionItem.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-cs-reception-item-001'),
        purchaseReceptionId: reception.id,
        productId: TEST_PRODUCT_ID,
        lotId: TEST_LOT_ID,
        receivedQuantity: 100,
        lotNumber: 'E2E-CS-BATCH-001',
        expirationDate: new Date('2027-12-31'),
        realUnitCost: new Prisma.Decimal('10000.00'),
        taxSchemeId: TEST_TAX_SCHEME_ID,
        taxRate: new Prisma.Decimal('0.0000'),
        subtotal: new Prisma.Decimal('1000000.00'),
        total: new Prisma.Decimal('1000000.00'),
      },
    });

    // Seed: Fiscal resolution + allocation for the workstation. Confirming a
    // sale allocates an INVOICE document number for the sale's workstation.
    const resolution = await prisma.fiscalResolution.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-cs-fiscal-resolution-001'),
        resolutionNumber: 'E2E-CS-RES-001',
        documentType: 'INVOICE',
        prefix: 'E2ECS',
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2099-12-31'),
        state: 'ACTIVE',
        workstationId: TEST_WORKSTATION_ID,
      },
    });
    await prisma.fiscalResolutionAllocation.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-cs-fiscal-allocation-001'),
        resolutionId: resolution.id,
        workstationId: TEST_WORKSTATION_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date('2024-01-01'),
        allocatedByUserId: 'e2e-cs-admin-id',
      },
    });

    // Seed: Payment methods
    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: TEST_CASH_PM_ID,
        internalCode: 'E2E-CS-CASH',
        name: 'E2E CS Cash',
        category: 'CASH',
        isCash: true,
      },
    });
    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: TEST_DEBIT_PM_ID,
        internalCode: 'E2E-CS-DEBIT',
        name: 'E2E CS Debit',
        category: 'DEBIT_CARD',
        isCash: false,
      },
    });

    // Build and start NestJS app
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (prisma) {
      await prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_LOT_ID } });
      await prisma.saleItemLot.deleteMany({ where: { lotId: TEST_LOT_ID } });
      await prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
      await prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
      await prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
      await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
      await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
      await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID, TEST_DEBIT_PM_ID] } } });
      await prisma.auditLog.deleteMany({ where: { userId: 'e2e-cs-admin-id' } });
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-cs-admin-id' } });
      await prisma.user.deleteMany({ where: { username: TEST_ADMIN_USERNAME } });
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  describe('Step 1: Login as ADMIN', () => {
    it('should return admin token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_ADMIN_USERNAME, secret: TEST_ADMIN_PASSWORD, sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      adminToken = res.body.accessToken;
    });
  });

  describe('Step 2: Open cash shift', () => {
    it('should create an OPEN shift with opening balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/cash-shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .send({ openingBalance: OPENING_BALANCE })
        .expect(201);

      expect(res.body.state).toBe('OPEN');
      expect(res.body.openingBalance).toBe(String(parseFloat(OPENING_BALANCE)));

      shiftId = res.body.id;
    });
  });

  describe('Step 3: Create and confirm a sale', () => {
    it('should create a sale in IN_PROGRESS', async () => {
      const res = await request(app.getHttpServer())
        .post('/sales-pos')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .send({
          saleType: 'FREE_SALE',
          cashShiftId: shiftId,
          items: [
            {
              productId: TEST_PRODUCT_ID,
              quantity: SALE_QUANTITY,
              unitPrice: UNIT_PRICE,
            },
          ],
        })
        .expect(201);

      saleId = res.body.id;
    });

    it('should confirm the sale', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sales-pos/${saleId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          payments: [
            {
              paymentMethodId: TEST_CASH_PM_ID,
              amount: SALE_QUANTITY * parseFloat(UNIT_PRICE),
            },
          ],
        })
        .expect(200);

      expect(res.body.operationalState).toBe('CONFIRMED');
    });
  });

  describe('Step 4: Close cash shift with declared amounts', () => {
    it('should register cash counts', async () => {
      const res = await request(app.getHttpServer())
        .post(`/cash-shifts/${shiftId}/cash-counts`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          countType: 'CLOSING',
          paymentMethodId: TEST_CASH_PM_ID,
          expectedAmount: (OPENING_BALANCE && (SALE_QUANTITY * parseFloat(UNIT_PRICE) + parseFloat(OPENING_BALANCE))).toFixed(2),
          declaredAmount: DECLARED_CASH.toFixed(2),
        })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('should close the shift and have a difference', async () => {
      const res = await request(app.getHttpServer())
        .post(`/cash-shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'E2E test cash shift closure' })
        .expect(201);

      expect(res.body.state).toBe('CLOSED');
      expect(res.body.closedAt).toBeDefined();

      // expectedClosingAmount includes opening balance + confirmed sales
      const expectedTotal = parseFloat(OPENING_BALANCE) + SALE_QUANTITY * parseFloat(UNIT_PRICE);
      const actualTotal = DECLARED_CASH;
      // closingDifference is actual - expected (positive = surplus).
      const difference = actualTotal - expectedTotal;

      expect(parseFloat(res.body.expectedClosingAmount)).toBeCloseTo(expectedTotal, 0);
      expect(parseFloat(res.body.actualClosingAmount)).toBeCloseTo(actualTotal, 0);
      expect(parseFloat(res.body.closingDifference)).toBeCloseTo(difference, 0);
    });
  });
});
