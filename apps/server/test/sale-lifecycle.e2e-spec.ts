import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-ws-sale-001';
const TEST_CASHIER_USERNAME = 'e2e-cashier@sale.test';
const TEST_CASHIER_PASSWORD = 'CashierPass123!';
const TEST_ADMIN_USERNAME = 'e2e-admin@sale.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_PRODUCT_ID = 'e2e-sale-product-id-001';
const TEST_TAX_SCHEME_ID = 'e2e-sale-tax-scheme-id-001';
const TEST_LOT_ID = 'e2e-sale-lot-id-001';
const TEST_CASH_PM_ID = 'e2e-sale-pm-cash-001';
const TEST_DEBIT_PM_ID = 'e2e-sale-pm-debit-001';
const INITIAL_LOT_STOCK = 100;
const SALE_QUANTITY = 3;
const UNIT_PRICE = '15000.00';

describe('Sale lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let cashierToken: string;
  let adminToken: string;
  let shiftId: string;
  let saleId: string;
  let productPriceId: string;
  let productTaxId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data from previous test runs
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
    await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-cashier-user-id', 'e2e-admin-user-id'] } } });
    await prisma.user.deleteMany({ where: { username: { in: [TEST_CASHIER_USERNAME, TEST_ADMIN_USERNAME] } } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Sale Test Workstation',
        code: 'WS-E2E-SALE-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Cashier user
    const cashierHash = await argon2.hash(TEST_CASHIER_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-cashier-user-id',
        username: TEST_CASHIER_USERNAME,
        fullName: 'E2E Cashier User',
        passwordHash: cashierHash,
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        isActive: true,
      },
    });

    // Seed: Admin user
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-admin-user-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E Admin User',
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
        createdById: 'e2e-admin-user-id',
      },
    });

    // Seed: Product
    await prisma.product.create({
      data: {
        id: TEST_PRODUCT_ID,
        internalCode: 'E2E-SALE-PROD-001',
        commercialName: 'E2E Sale Test Product',
        genericName: 'E2E Test Generic',
        activePrinciple: 'E2E Active Principle',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: 'e2e-admin-user-id',
      },
    });

    // Seed: Product price history
    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        id: 'e2e-sale-price-hist-001',
        productId: TEST_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        createdById: 'e2e-admin-user-id',
      },
    });
    productPriceId = priceHistory.id;

    // Seed: Product tax history
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        id: 'e2e-sale-tax-hist-001',
        productId: TEST_PRODUCT_ID,
        taxSchemeId: TEST_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        createdById: 'e2e-admin-user-id',
      },
    });
    productTaxId = taxHistory.id;

    // Update product with current pointers
    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: {
        currentPriceId: productPriceId,
        currentTaxHistoryId: productTaxId,
      },
    });

    // Seed: Lot with stock
    await prisma.lot.create({
      data: {
        id: TEST_LOT_ID,
        batchNumber: 'E2E-BATCH-001',
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
        internalCode: 'E2E-CASH',
        name: 'E2E Cash',
        category: 'CASH',
        isCash: true,
      },
    });

    await prisma.paymentMethod.create({
      data: {
        id: TEST_DEBIT_PM_ID,
        internalCode: 'E2E-DEBIT',
        name: 'E2E Debit Card',
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
      // Cleanup test data
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
      await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-cashier-user-id', 'e2e-admin-user-id'] } } });
      await prisma.user.deleteMany({ where: { username: { in: [TEST_CASHIER_USERNAME, TEST_ADMIN_USERNAME] } } });
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  describe('Step 1: Login as CASHIER', () => {
    it('should return tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_CASHIER_USERNAME, password: TEST_CASHIER_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user.role).toBe('CASHIER');

      cashierToken = res.body.accessToken;
    });
  });

  describe('Step 2: Open a cash shift', () => {
    it('should create a cash shift with OPEN state', async () => {
      const res = await request(app.getHttpServer())
        .post('/cash-shifts')
        .set('Authorization', `Bearer ${cashierToken}`)
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .send({ openingBalance: '50000.00' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.state).toBe('OPEN');
      expect(res.body.openingBalance).toBe('50000.00');
      expect(res.body.workstationId).toBe(TEST_WORKSTATION_ID);

      shiftId = res.body.id;
    });
  });

  describe('Step 3: Create a sale (IN_PROGRESS)', () => {
    it('should create a sale in IN_PROGRESS state', async () => {
      const res = await request(app.getHttpServer())
        .post('/sales-pos')
        .set('Authorization', `Bearer ${cashierToken}`)
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

      expect(res.body).toHaveProperty('id');
      expect(res.body.operationalState).toBe('IN_PROGRESS');
      expect(res.body.cashShiftId).toBe(shiftId);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].productId).toBe(TEST_PRODUCT_ID);
      expect(res.body.items[0].quantity).toBe(SALE_QUANTITY);

      saleId = res.body.id;
    });
  });

  describe('Step 4: Confirm the sale (CONFIRMED)', () => {
    it('should confirm the sale and reduce stock', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sales-pos/${saleId}/confirm`)
        .set('Authorization', `Bearer ${cashierToken}`)
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
      expect(res.body.confirmedAt).toBeDefined();
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.payments[0].paymentMethodId).toBe(TEST_CASH_PM_ID);
    });

    it('should have reduced lot stock after confirmation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory-lots/lots/${TEST_LOT_ID}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.currentStock).toBe(INITIAL_LOT_STOCK - SALE_QUANTITY);
      expect(res.body.state).toBe('ACTIVE');
    });
  });

  describe('Step 5: Annul the sale (ANNULLED)', () => {
    it('should annul the sale and restore stock', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sales-pos/${saleId}/annul`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          annulmentReason: 'Cliente canceló la compra',
        })
        .expect(200);

      expect(res.body.operationalState).toBe('ANNULLED');
      expect(res.body.annulledAt).toBeDefined();
      expect(res.body.annulmentReason).toBe('Cliente canceló la compra');
    });

    it('should have restored lot stock after annulment', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory-lots/lots/${TEST_LOT_ID}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.currentStock).toBe(INITIAL_LOT_STOCK);
      expect(res.body.state).toBe('ACTIVE');
    });
  });

  describe('Step 6: Close the cash shift', () => {
    it('should register cash count and close the shift', async () => {
      // Register cash count for the shift
      await request(app.getHttpServer())
        .post(`/cash-shifts/${shiftId}/cash-counts`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          countType: 'CLOSING',
          counts: [
            {
              paymentMethodId: TEST_CASH_PM_ID,
              declaredAmount: (SALE_QUANTITY * parseFloat(UNIT_PRICE)).toFixed(2),
            },
          ],
        })
        .expect(201);

      // Close the shift
      const res = await request(app.getHttpServer())
        .post(`/cash-shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          closingNotes: 'E2E test shift closure',
        })
        .expect(200);

      // Sale was annulled, so expected closing amount should reflect that
      expect(res.body.state).toBe('CLOSED');
      expect(res.body.closedAt).toBeDefined();
    });
  });
});
