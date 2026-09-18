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

const TEST_WORKSTATION_ID = uuidFrom('e2e-ws-fifo-001');
const TEST_ADMIN_USERNAME = 'e2e-admin@fifo.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_PRODUCT_ID = uuidFrom('e2e-fifo-product-id-001');
const TEST_TAX_SCHEME_ID = uuidFrom('e2e-fifo-tax-scheme-001');
const TEST_LOT_A_ID = uuidFrom('e2e-fifo-lot-a-001');
const TEST_LOT_B_ID = uuidFrom('e2e-fifo-lot-b-001');
const TEST_CASH_PM_ID = uuidFrom('e2e-fifo-pm-cash-001');
const LOT_A_STOCK = 10;
const LOT_B_STOCK = 5;
const SALE_QUANTITY = 12; // 10 from Lot A, 2 from Lot B
const UNIT_PRICE = '5000.00';

describe('FIFO stock consumption (e2e)', () => {
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
    const subscriptionId = await seedSubscription(prisma, 'fifo');

    // Clean up any leftover data
    await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: [TEST_LOT_A_ID, TEST_LOT_B_ID] } } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: { in: [TEST_LOT_A_ID, TEST_LOT_B_ID] } } });
    await prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.purchaseReceptionItem.deleteMany({ where: { purchaseReceptionId: uuidFrom('e2e-fifo-reception-001') } });
    await prisma.purchaseReception.deleteMany({ where: { supplierId: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.supplier.deleteMany({ where: { id: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.purchaseReceptionItem.deleteMany({ where: { purchaseReceptionId: uuidFrom('e2e-fifo-reception-001') } });
    await prisma.purchaseReception.deleteMany({ where: { supplierId: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.supplier.deleteMany({ where: { id: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.lot.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({ where: { id: TEST_CASH_PM_ID } });
    await prisma.auditLog.deleteMany({ where: { userId: 'e2e-fifo-admin-id' } });
    await prisma.userSession.deleteMany({ where: { userId: 'e2e-fifo-admin-id' } });
    await prisma.user.deleteMany({ where: { username: TEST_ADMIN_USERNAME } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E FIFO Test Workstation',
        code: 'WS-E2E-FIFO-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Admin user
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-fifo-admin-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E FIFO Admin',
        passwordHash: adminHash,
        passwordAlgorithm: 'argon2',
        role: 'ADMIN',
        subscriptionId,
        isActive: true,
      },
    });

    // Seed: Tax scheme (required for product)
    await prisma.taxScheme.create({
      data: {
        createdById: 'e2e-fifo-admin-id',
        subscriptionId,
        id: TEST_TAX_SCHEME_ID,
        code: 'IVA0',
        name: 'IVA 0%',
        taxType: 'EXENTO',
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
        internalCode: 'E2E-FIFO-PROD-001',
        commercialName: 'E2E FIFO Test Product',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: 'e2e-fifo-admin-id',
      },
    });

    // Seed: Product price history
    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-fifo-price-hist-001',
        productId: TEST_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: 'e2e-fifo-admin-id',
        changedAt: new Date(),
      },
    });

    // Seed: Product tax history
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-fifo-tax-hist-001',
        productId: TEST_PRODUCT_ID,
        taxSchemeId: TEST_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: 'e2e-fifo-admin-id',
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

    // Seed: Lot A (older entry date, 10 units)
    await prisma.lot.create({
      data: {
        subscriptionId,
        id: TEST_LOT_A_ID,
        batchNumber: 'E2E-FIFO-BATCH-A',
        expirationDate: new Date('2026-12-31'),
        entryDate: new Date('2024-01-15'),
        state: 'ACTIVE',
        currentStock: LOT_A_STOCK,
        version: 0,
        productId: TEST_PRODUCT_ID,
      },
    });

    // Seed: Lot B (newer entry date, 5 units)
    await prisma.lot.create({
      data: {
        subscriptionId,
        id: TEST_LOT_B_ID,
        batchNumber: 'E2E-FIFO-BATCH-B',
        expirationDate: new Date('2027-06-30'),
        entryDate: new Date('2024-06-15'),
        state: 'ACTIVE',
        currentStock: LOT_B_STOCK,
        version: 0,
        productId: TEST_PRODUCT_ID,
      },
    });

    // Seed: Purchase reception giving the lots a real unit cost. The sale
    // confirmation consumes stock via FIFO and requires
    // PurchaseReceptionItem.realUnitCost; without it the flow fails with
    // LotCostUnavailableException.
    const supplier = await prisma.supplier.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-fifo-supplier-001'),
        identificationType: 'NIT',
        identificationNumber: '900123456-2',
        businessName: 'E2E FIFO Supplier SA',
        createdById: 'e2e-fifo-admin-id',
      },
    });
    const reception = await prisma.purchaseReception.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-fifo-reception-001'),
        sequentialNumber: 1,
        state: 'CONFIRMED',
        receivedAt: new Date('2024-06-15'),
        createdById: 'e2e-fifo-admin-id',
        supplierId: supplier.id,
      },
    });
    await prisma.purchaseReceptionItem.createMany({
      data: [
        {
          subscriptionId,
          id: uuidFrom('e2e-fifo-reception-item-a-001'),
          purchaseReceptionId: reception.id,
          productId: TEST_PRODUCT_ID,
          lotId: TEST_LOT_A_ID,
          receivedQuantity: LOT_A_STOCK,
          lotNumber: 'E2E-FIFO-BATCH-A',
          expirationDate: new Date('2026-12-31'),
          realUnitCost: new Prisma.Decimal('2000.00'),
          taxSchemeId: TEST_TAX_SCHEME_ID,
          taxRate: new Prisma.Decimal('0.0000'),
          subtotal: new Prisma.Decimal('20000.00'),
          total: new Prisma.Decimal('20000.00'),
        },
        {
          subscriptionId,
          id: uuidFrom('e2e-fifo-reception-item-b-001'),
          purchaseReceptionId: reception.id,
          productId: TEST_PRODUCT_ID,
          lotId: TEST_LOT_B_ID,
          receivedQuantity: LOT_B_STOCK,
          lotNumber: 'E2E-FIFO-BATCH-B',
          expirationDate: new Date('2027-06-30'),
          realUnitCost: new Prisma.Decimal('2100.00'),
          taxSchemeId: TEST_TAX_SCHEME_ID,
          taxRate: new Prisma.Decimal('0.0000'),
          subtotal: new Prisma.Decimal('10500.00'),
          total: new Prisma.Decimal('10500.00'),
        },
      ],
    });

    // Seed: Fiscal resolution + allocation for the workstation. Confirming a
    // sale allocates an INVOICE document number for the sale's workstation.
    const resolution = await prisma.fiscalResolution.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-fifo-fiscal-resolution-001'),
        resolutionNumber: 'E2E-FIFO-RES-001',
        documentType: 'INVOICE',
        prefix: 'E2EFIFO',
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
        id: uuidFrom('e2e-fifo-fiscal-allocation-001'),
        resolutionId: resolution.id,
        workstationId: TEST_WORKSTATION_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date('2024-01-01'),
        allocatedByUserId: 'e2e-fifo-admin-id',
      },
    });

    // Seed: Payment method
    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: TEST_CASH_PM_ID,
        internalCode: 'E2E-FIFO-CASH',
        name: 'E2E FIFO Cash',
        category: 'CASH',
        isCash: true,
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
      // Cleanup test data
      await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: [TEST_LOT_A_ID, TEST_LOT_B_ID] } } });
      await prisma.saleItemLot.deleteMany({ where: { lotId: { in: [TEST_LOT_A_ID, TEST_LOT_B_ID] } } });
      await prisma.saleItem.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
      await prisma.salePayment.deleteMany({ where: { sale: { cashShift: { workstationId: TEST_WORKSTATION_ID } } } });
      await prisma.sale.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.purchaseReceptionItem.deleteMany({ where: { purchaseReceptionId: uuidFrom('e2e-fifo-reception-001') } });
    await prisma.purchaseReception.deleteMany({ where: { supplierId: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.supplier.deleteMany({ where: { id: uuidFrom('e2e-fifo-supplier-001') } });
    await prisma.lot.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
      await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
      await prisma.paymentMethod.deleteMany({ where: { id: TEST_CASH_PM_ID } });
      await prisma.auditLog.deleteMany({ where: { userId: 'e2e-fifo-admin-id' } });
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-fifo-admin-id' } });
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
    it('should open a shift', async () => {
      const res = await request(app.getHttpServer())
        .post('/cash-shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .send({ openingBalance: '0' })
        .expect(201);

      shiftId = res.body.id;
    });
  });

  describe('Step 3: Create and confirm a sale that spans both lots', () => {
    it('should create a sale of 12 units', async () => {
      const res = await request(app.getHttpServer())
        .post('/sales-pos')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .send({
          saleType: 'FREE_SALE',
          cashShiftId: shiftId,
          items: [{
            productId: TEST_PRODUCT_ID,
            quantity: SALE_QUANTITY,
            unitPrice: UNIT_PRICE,
          }],
        })
        .expect(201);

      saleId = res.body.id;
    });

    it('should confirm the sale', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sales-pos/${saleId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          payments: [{
            paymentMethodId: TEST_CASH_PM_ID,
            amount: SALE_QUANTITY * parseFloat(UNIT_PRICE),
          }],
        })
        .expect(200);

      expect(res.body.operationalState).toBe('CONFIRMED');
    });
  });

  describe('Step 4: Verify FIFO consumption', () => {
    it('should have consumed all stock from Lot A (oldest first)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory-lots/lots/${TEST_LOT_A_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Lot A had 10 units, all consumed by FIFO (oldest entry date)
      expect(res.body.currentStock).toBe(0);
    });

    it('should have consumed 2 units from Lot B', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory-lots/lots/${TEST_LOT_B_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Lot B had 5 units, consumed 2 (the remaining of the 12 needed)
      expect(res.body.currentStock).toBe(LOT_B_STOCK - (SALE_QUANTITY - LOT_A_STOCK));
    });
  });

  describe('Step 5: Verify inventory movements', () => {
    it('should have movement records for both lots', async () => {
      const res = await request(app.getHttpServer())
        .get('/inventory-lots/movements')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ lotId: TEST_LOT_A_ID })
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].movementType).toBe('SALE');
      // The ledger stores SALE quantity as a positive magnitude; direction is
      // previousStock > resultingStock.
      expect(res.body.data[0].quantity).toBe(LOT_A_STOCK); // All 10 consumed
    });

    it('should have a sale movement for Lot B', async () => {
      const res = await request(app.getHttpServer())
        .get('/inventory-lots/movements')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ lotId: TEST_LOT_B_ID })
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].movementType).toBe('SALE');
      expect(res.body.data[0].quantity).toBe(SALE_QUANTITY - LOT_A_STOCK);
    });
  });
});
