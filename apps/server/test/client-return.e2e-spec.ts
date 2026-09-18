import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedSubscription } from './helpers/subscription-seed';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ValidationPipe } from '@nestjs/common';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';

// API DTOs validate ids as UUIDs (z.uuid()); these constants are derived
// deterministically from the legacy names so reruns reuse the same rows.
const uuidFrom = (seed: string): string => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const h = createHash('sha256').update(seed).digest('hex');
  // Force RFC 4122 v4 shape (zod validates version/variant bits).
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `8${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
};

const TEST_WORKSTATION_ID = uuidFrom('e2e-ws-ret-001');
const TEST_USERNAME = 'e2e-cashier@return.test';
const TEST_PASSWORD = 'CashierPass123!';
const TEST_ADMIN_USERNAME = 'e2e-admin@return.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_PRODUCT_ID = uuidFrom('e2e-ret-product-id-001');
const TEST_TAX_SCHEME_ID = uuidFrom('e2e-ret-tax-scheme-001');
const TEST_LOT_ID = uuidFrom('e2e-ret-lot-id-001');
const TEST_CASH_PM_ID = uuidFrom('e2e-ret-pm-cash-001');
const TEST_SALE_ID = uuidFrom('e2e-ret-sale-id-001');
const TEST_SALE_ITEM_ID = uuidFrom('e2e-ret-sale-item-001');
const TEST_SALE_ITEM_LOT_ID = uuidFrom('e2e-ret-sale-item-lot-001');
const INITIAL_LOT_STOCK = 50;
const SALE_QUANTITY = 5;
const RETURN_QUANTITY = 2;
const UNIT_PRICE = '12000.00';

describe('Client return (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let cashierToken: string;
  let adminToken: string;
  let shiftId: string;
  let clientReturnId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    // Multi-tenant schema: every operational row requires a subscription.
    const subscriptionId = await seedSubscription(prisma, 'clientret');

    // Clean up any leftover data
    await prisma.inventoryMovement.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.clientReturnItemLot.deleteMany({ where: { clientReturnItem: { clientReturn: { workstationId: TEST_WORKSTATION_ID } } } });
    await prisma.clientReturnItem.deleteMany({ where: { clientReturn: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.clientReturn.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.saleItemLot.deleteMany({ where: { lotId: TEST_LOT_ID } });
    await prisma.saleItem.deleteMany({ where: { saleId: TEST_SALE_ID } });
    await prisma.salePayment.deleteMany({ where: { saleId: TEST_SALE_ID } });
    await prisma.fiscalDocument.deleteMany({ where: { saleId: TEST_SALE_ID } });
    await prisma.sale.deleteMany({ where: { id: TEST_SALE_ID } });
    await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
    await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
    await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
    await prisma.client.deleteMany({ where: { id: uuidFrom('e2e-ret-client-001') } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID] } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ['e2e-ret-cashier-id', 'e2e-ret-admin-id'] } } });
    // Fiscal allocation references the user and workstation.
    await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
    await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
    await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-ret-cashier-id', 'e2e-ret-admin-id'] } } });
    await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, TEST_ADMIN_USERNAME] } } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Return Test Workstation',
        code: 'WS-E2E-RET-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Cashier user
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-ret-cashier-id',
        username: TEST_USERNAME,
        fullName: 'E2E Return Cashier',
        passwordHash,
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        subscriptionId,
        isActive: true,
      },
    });

    // Seed: Admin user — lot stock assertions read GET /inventory-lots/lots/:id,
    // which requires INVENTORY_ASSISTANT/MANAGER/ADMIN; a CASHIER is denied by design.
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-ret-admin-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E Return Admin',
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
        subscriptionId,
        id: TEST_TAX_SCHEME_ID,
        code: 'IVA19',
        name: 'IVA 19%',
        taxType: 'IVA',
        rate: new Prisma.Decimal('0.1900'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
        createdById: 'e2e-ret-cashier-id',
      },
    });

    // Seed: Product
    await prisma.product.create({
      data: {
        subscriptionId,
        id: TEST_PRODUCT_ID,
        internalCode: 'E2E-RET-PROD-001',
        commercialName: 'E2E Return Test Product',
        laboratory: 'E2E Lab',
        saleType: 'FREE_SALE',
        isActive: true,
        createdById: 'e2e-ret-cashier-id',
      },
    });

    // Seed: Product price history
    const priceHistory = await prisma.productPriceHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-ret-price-hist-001',
        productId: TEST_PRODUCT_ID,
        price: new Prisma.Decimal(UNIT_PRICE),
        effectiveFrom: new Date(),
        changedById: 'e2e-admin-user-id',
        changedAt: new Date(),
      },
    });

    // Seed: Product tax history
    const taxHistory = await prisma.productTaxHistory.create({
      data: {
        subscriptionId,
        id: 'e2e-ret-tax-hist-001',
        productId: TEST_PRODUCT_ID,
        taxSchemeId: TEST_TAX_SCHEME_ID,
        effectiveFrom: new Date(),
        changedById: 'e2e-admin-user-id',
        changedAt: new Date(),
      },
    });

    // Update product with current pointers
    await prisma.product.update({
      where: { id: TEST_PRODUCT_ID },
      data: {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      },
    });

    // Seed: Lot with stock (initial stock before sale)
    await prisma.lot.create({
      data: {
        subscriptionId,
        id: TEST_LOT_ID,
        batchNumber: 'E2E-RET-BATCH-001',
        expirationDate: new Date('2027-12-31'),
        entryDate: new Date('2024-06-01'),
        state: 'ACTIVE',
        currentStock: INITIAL_LOT_STOCK - SALE_QUANTITY, // After the sale, stock has been reduced
        version: 1,
        productId: TEST_PRODUCT_ID,
      },
    });

    // Seed: Payment method
    await prisma.paymentMethod.create({
      data: {
        subscriptionId,
        id: TEST_CASH_PM_ID,
        internalCode: 'E2E-RET-CASH',
        name: 'E2E Return Cash',
        category: 'CASH',
        isCash: true,
      },
    });

    // Seed: fiscal resolution + allocation, then a validated INVOICE fiscal
    // document for the sale — confirming the return creates a CREDIT_NOTE
    // which requires a validated INVOICE.
    await prisma.fiscalResolution.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-ret-fiscal-resolution-001'),
        resolutionNumber: 'E2E-RET-RES-001',
        documentType: 'INVOICE',
        prefix: 'E2ER',
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2099-12-31'),
        state: 'ACTIVE',
        workstationId: TEST_WORKSTATION_ID,
      },
    });
    // The credit note gets its own number from a CREDIT_NOTE resolution.
    await prisma.fiscalResolution.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-ret-fiscal-resolution-cn-001'),
        resolutionNumber: 'E2E-RET-RES-CN-001',
        documentType: 'CREDIT_NOTE',
        prefix: 'E2ERC',
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
        id: uuidFrom('e2e-ret-fiscal-allocation-cn-001'),
        resolutionId: uuidFrom('e2e-ret-fiscal-resolution-cn-001'),
        workstationId: TEST_WORKSTATION_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date('2024-01-01'),
        allocatedByUserId: 'e2e-ret-cashier-id',
      },
    });
    await prisma.fiscalResolutionAllocation.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-ret-fiscal-allocation-001'),
        resolutionId: uuidFrom('e2e-ret-fiscal-resolution-001'),
        workstationId: TEST_WORKSTATION_ID,
        rangeFrom: 1,
        rangeTo: 1000,
        allocatedAt: new Date('2024-01-01'),
        allocatedByUserId: 'e2e-ret-cashier-id',
      },
    });
    await prisma.fiscalDocument.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-ret-fiscal-doc-001'),
        documentType: 'INVOICE',
        consecutiveNumber: 1,
        fullNumber: 'E2ER-1',
        issueDate: new Date(),
        cufeCude: uuidFrom('e2e-ret-cufe-001'),
        cufeCudeAlgorithm: 'SHA384',
        fiscalState: 'VALIDATED',
        retryCount: 0,
        subtotal: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
        totalTax: new Prisma.Decimal('0'),
        totalAmount: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
        issuerNitSnapshot: '900123456-1',
        resolutionId: uuidFrom('e2e-ret-fiscal-resolution-001'),
        saleId: TEST_SALE_ID,
      },
    });

    // Seed: a client for the sale (ClientReturn.clientId is NOT NULL).
    const client = await prisma.client.create({
      data: {
        subscriptionId,
        id: uuidFrom('e2e-ret-client-001'),
        identificationType: 'CC',
        identificationNumber: '1010202030',
        fullName: 'E2E Return Client',
        createdById: 'e2e-ret-cashier-id',
      },
    });

    // Seed: Open cash shift
    const shift = await prisma.cashShift.create({
      data: {
        subscriptionId,
        id: 'e2e-ret-shift-id-001',
        workstationId: TEST_WORKSTATION_ID,
        userId: 'e2e-ret-cashier-id',
        state: 'OPEN',
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal('0'),
      },
    });
    shiftId = shift.id;

    // Seed: Confirmed sale
    const now = new Date();
    await prisma.sale.create({
      data: {
        subscriptionId,
        id: TEST_SALE_ID,
        localNumber: 1001n,
        operationalState: 'CONFIRMED',
        startedAt: new Date(now.getTime() - 3600000),
        lastModifiedAt: now,
        confirmedAt: new Date(now.getTime() - 1800000),
        subtotal: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
        totalAmount: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
        totalTax: new Prisma.Decimal('0'),
        totalDiscount: new Prisma.Decimal('0'),
        totalCost: new Prisma.Decimal('0'),
        changeAmount: new Prisma.Decimal('0'),
        clientId: client.id,
        cashShiftId: shiftId,
        workstationId: TEST_WORKSTATION_ID,
        userId: 'e2e-ret-cashier-id',
        sourceWorkstationId: TEST_WORKSTATION_ID,
        items: {
          create: [
            {
              id: TEST_SALE_ITEM_ID,
              subscriptionId,
              productId: TEST_PRODUCT_ID,
              productInternalCodeSnapshot: 'E2E-RET-PROD-001',
              productCommercialNameSnapshot: 'E2E Return Test Product',
              productGenericNameSnapshot: 'E2E Return Generic',
              quantity: SALE_QUANTITY,
              unitPrice: new Prisma.Decimal(UNIT_PRICE),
              unitCost: new Prisma.Decimal('8000.00'),
              taxRate: new Prisma.Decimal('0.1900'),
              taxAmount: new Prisma.Decimal('0'),
              discountPercentage: new Prisma.Decimal('0'),
              discountAmount: new Prisma.Decimal('0'),
              subtotal: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
              total: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
              lots: {
                create: [
                  {
                    id: TEST_SALE_ITEM_LOT_ID,
                            subscriptionId,
                    lotId: TEST_LOT_ID,
                    quantity: SALE_QUANTITY,
                    unitCostAtSale: new Prisma.Decimal('8000.00'),
                  },
                ],
              },
            },
          ],
        },
        payments: {
          create: [
            {
              id: 'e2e-ret-payment-001',
              subscriptionId,
              paymentMethodId: TEST_CASH_PM_ID,
              amount: new Prisma.Decimal(Number(UNIT_PRICE) * SALE_QUANTITY),
            },
          ],
        },
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
      await prisma.clientReturnItemLot.deleteMany({ where: { clientReturnItem: { clientReturn: { workstationId: TEST_WORKSTATION_ID } } } });
      await prisma.clientReturnItem.deleteMany({ where: { clientReturn: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.clientReturn.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.saleItemLot.deleteMany({ where: { lotId: TEST_LOT_ID } });
      await prisma.saleItem.deleteMany({ where: { saleId: TEST_SALE_ID } });
      await prisma.salePayment.deleteMany({ where: { saleId: TEST_SALE_ID } });
      await prisma.fiscalDocument.deleteMany({ where: { saleId: TEST_SALE_ID } });
      await prisma.sale.deleteMany({ where: { id: TEST_SALE_ID } });
      await prisma.shiftCashCount.deleteMany({ where: { cashShift: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.cashShift.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.lot.deleteMany({ where: { id: TEST_LOT_ID } });
      await prisma.productTaxHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productPriceHistory.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.productBarcode.deleteMany({ where: { productId: TEST_PRODUCT_ID } });
      await prisma.product.deleteMany({ where: { id: TEST_PRODUCT_ID } });
      await prisma.client.deleteMany({ where: { id: uuidFrom('e2e-ret-client-001') } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
      await prisma.paymentMethod.deleteMany({ where: { id: { in: [TEST_CASH_PM_ID] } } });
      await prisma.auditLog.deleteMany({ where: { userId: 'e2e-ret-cashier-id' } });
      // Fiscal allocation references the user and workstation.
      await prisma.fiscalDocument.deleteMany({ where: { resolution: { workstationId: TEST_WORKSTATION_ID } } });
      await prisma.fiscalResolutionAllocation.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.fiscalResolution.deleteMany({ where: { workstationId: TEST_WORKSTATION_ID } });
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-ret-cashier-id' } });
      await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  describe('Step 1: Login as CASHIER', () => {
    it('should return tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_USERNAME, secret: TEST_PASSWORD, sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body.user.role).toBe('CASHIER');
      cashierToken = res.body.accessToken;
    });
  });

  describe('Step 1b: Login as ADMIN', () => {
    it('should return tokens for valid admin credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_ADMIN_USERNAME, secret: TEST_ADMIN_PASSWORD, sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body.user.role).toBe('ADMIN');
      adminToken = res.body.accessToken;
    });
  });

  describe('Step 2: Create a client return (DRAFT)', () => {
    it('should create a return with DRAFT state', async () => {
      const res = await request(app.getHttpServer())
        .post('/sales-pos/client-returns')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          saleId: TEST_SALE_ID,
          reason: 'Producto defectuoso',
          items: [
            {
              saleItemId: TEST_SALE_ITEM_ID,
              quantity: RETURN_QUANTITY,
              lots: [
                {
                  lotId: TEST_LOT_ID,
                  quantity: RETURN_QUANTITY,
                },
              ],
            },
          ],
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.state).toBe('DRAFT');
      expect(res.body.saleId).toBe(TEST_SALE_ID);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(RETURN_QUANTITY);

      clientReturnId = res.body.id;
    });
  });

  describe('Step 3: Confirm the client return', () => {
    it('should confirm the return and increase lot stock', async () => {
      const res = await request(app.getHttpServer())
        .post(`/sales-pos/client-returns/${clientReturnId}/confirm`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.state).toBe('CONFIRMED');
    });

    it('should have increased lot stock after confirmation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/inventory-lots/lots/${TEST_LOT_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Stock was INITIAL_LOT_STOCK - SALE_QUANTITY before return.
      // After returning RETURN_QUANTITY items, stock should increase.
      const expectedStock = INITIAL_LOT_STOCK - SALE_QUANTITY + RETURN_QUANTITY;
      expect(res.body.currentStock).toBe(expectedStock);
    });
  });

  describe('Step 4: Look up the client return', () => {
    it('should return the client return with items and lots', async () => {
      const res = await request(app.getHttpServer())
        .get(`/sales-pos/client-returns/${clientReturnId}`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .expect(200);

      expect(res.body.id).toBe(clientReturnId);
      expect(res.body.state).toBe('CONFIRMED');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].lots).toHaveLength(1);
      expect(res.body.items[0].lots[0].lotId).toBe(TEST_LOT_ID);
    });
  });
});
