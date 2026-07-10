import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-ws-cs-001';
const TEST_ADMIN_USERNAME = 'e2e-admin@cs.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_PRODUCT_ID = 'e2e-cs-product-id-001';
const TEST_TAX_SCHEME_ID = 'e2e-cs-tax-scheme-001';
const TEST_LOT_ID = 'e2e-cs-lot-id-001';
const TEST_CASH_PM_ID = 'e2e-cs-pm-cash-001';
const TEST_DEBIT_PM_ID = 'e2e-cs-pm-debit-001';
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
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data
    await prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
    await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID, TEST_DEBIT_PM_ID] } } });
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
        isActive: true,
      },
    });

    // Seed: Tax scheme
    await prisma.taxScheme.create({
      data: {
        id: TEST_TAX_SCHEME_ID,
        code: 'IVA19',
        name: 'IVA 19%',
        taxType: 'GENERAL_SALES',
        rate: new Prisma.Decimal('0.1900'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
        createdById: 'e2e-cs-admin-id',
      },
    });

    // Seed: Product
    await prisma.product.create({
      data: {
        id: TEST_PRODUCT_ID,
        internalCode: 'E2E-CS-PROD-001',
        commercialName: 'E2E Cash Shift Product',
        genericName: 'E2E CS Generic',
        activePrinciple: 'E2E CS Principle',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: 'e2e-cs-admin-id',
      },
    });

    // Seed: Product price history
    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        id: 'e2e-cs-price-hist-001',
        productId: TEST_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        createdById: 'e2e-cs-admin-id',
      },
    });

    // Seed: Product tax history
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        id: 'e2e-cs-tax-hist-001',
        productId: TEST_PRODUCT_ID,
        taxSchemeId: TEST_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        createdById: 'e2e-cs-admin-id',
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

    // Seed: Payment methods
    await prisma.paymentMethod.create({
      data: {
        id: TEST_CASH_PM_ID,
        internalCode: 'E2E-CS-CASH',
        name: 'E2E CS Cash',
        category: 'CASH',
        isCash: true,
      },
    });
    await prisma.paymentMethod.create({
      data: {
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
      await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
      await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
      await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID, TEST_DEBIT_PM_ID] } } });
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
        .send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD })
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
      expect(res.body.openingBalance).toBe(OPENING_BALANCE);

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
          counts: [
            {
              paymentMethodId: TEST_CASH_PM_ID,
              declaredAmount: DECLARED_CASH.toFixed(2),
            },
          ],
        })
        .expect(201);

      expect(res.body).toBeDefined();
    });

    it('should close the shift and have a difference', async () => {
      const res = await request(app.getHttpServer())
        .post(`/cash-shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ closingNotes: 'E2E test cash shift closure' })
        .expect(200);

      expect(res.body.state).toBe('CLOSED');
      expect(res.body.closedAt).toBeDefined();

      // expectedClosingAmount includes opening balance + confirmed sales
      const expectedTotal = parseFloat(OPENING_BALANCE) + SALE_QUANTITY * parseFloat(UNIT_PRICE);
      const actualTotal = DECLARED_CASH;
      const difference = expectedTotal - actualTotal;

      expect(parseFloat(res.body.expectedClosingAmount)).toBeCloseTo(expectedTotal, 0);
      expect(parseFloat(res.body.actualClosingAmount)).toBeCloseTo(actualTotal, 0);
      expect(parseFloat(res.body.closingDifference)).toBeCloseTo(difference, 0);
    });
  });
});
