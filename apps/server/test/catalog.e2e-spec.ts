import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-ws-cat-001';
const TEST_ADMIN_USERNAME = 'e2e-admin@catalog.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_CASHIER_USERNAME = 'e2e-cashier@catalog.test';
const TEST_CASHIER_PASSWORD = 'CashierPass123!';
const TEST_TAX_SCHEME_ID = 'e2e-cat-tax-scheme-001';
const TEST_CATEGORY_ID = 'e2e-cat-category-001';

describe('Catalog management with RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminToken: string;
  let cashierToken: string;
  let createdProductId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data
    await prisma.productTaxHistory.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
    await prisma.productPriceHistory.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
    await prisma.productBarcode.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
    await prisma.product.deleteMany({ where: { createdById: 'e2e-cat-admin-id' } });
    await prisma.category.deleteMany({ where: { id: TEST_CATEGORY_ID } });
    await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
    await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-cat-admin-id', 'e2e-cat-cashier-id'] } } });
    await prisma.user.deleteMany({ where: { username: { in: [TEST_ADMIN_USERNAME, TEST_CASHIER_USERNAME] } } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Catalog Test Workstation',
        code: 'WS-E2E-CAT-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Admin user
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-cat-admin-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E Catalog Admin',
        passwordHash: adminHash,
        passwordAlgorithm: 'argon2',
        role: 'ADMIN',
        isActive: true,
      },
    });

    // Seed: Cashier user
    const cashierHash = await argon2.hash(TEST_CASHIER_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-cat-cashier-id',
        username: TEST_CASHIER_USERNAME,
        fullName: 'E2E Catalog Cashier',
        passwordHash: cashierHash,
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        isActive: true,
      },
    });

    // Seed: Tax scheme (required by CreateProductSchema)
    await prisma.taxScheme.create({
      data: {
        id: TEST_TAX_SCHEME_ID,
        code: 'IVA0',
        name: 'IVA 0%',
        taxType: 'EXEMPT',
        rate: new Prisma.Decimal('0.0000'),
        effectiveFrom: new Date('2024-01-01'),
        isActive: true,
        createdById: 'e2e-cat-admin-id',
      },
    });

    // Seed: Category
    await prisma.category.create({
      data: {
        id: TEST_CATEGORY_ID,
        name: 'E2E Test Category',
        isActive: true,
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
      await prisma.productTaxHistory.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
      await prisma.productPriceHistory.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
      await prisma.productBarcode.deleteMany({ where: { product: { createdById: 'e2e-cat-admin-id' } } });
      await prisma.product.deleteMany({ where: { createdById: 'e2e-cat-admin-id' } });
      await prisma.category.deleteMany({ where: { id: TEST_CATEGORY_ID } });
      await prisma.taxScheme.deleteMany({ where: { id: TEST_TAX_SCHEME_ID } });
      await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-cat-admin-id', 'e2e-cat-cashier-id'] } } });
      await prisma.user.deleteMany({ where: { username: { in: [TEST_ADMIN_USERNAME, TEST_CASHIER_USERNAME] } } });
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

      expect(res.body.user.role).toBe('ADMIN');
      adminToken = res.body.accessToken;
    });
  });

  describe('Step 2: Login as CASHIER', () => {
    it('should return cashier token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_CASHIER_USERNAME, password: TEST_CASHIER_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body.user.role).toBe('CASHIER');
      cashierToken = res.body.accessToken;
    });
  });

  describe('Step 3: ADMIN creates a product', () => {
    it('should create a product with all required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          internalCode: 'E2E-CAT-PROD-001',
          commercialName: 'E2E Catalog Test Product',
          genericName: 'E2E Catalog Generic',
          activePrinciple: 'E2E Principle',
          laboratory: 'E2E Lab',
          saleType: 'FREE_SALE',
          minimumStock: 10,
          initialPrice: '25000.00',
          initialTaxSchemeId: TEST_TAX_SCHEME_ID,
          categoryId: TEST_CATEGORY_ID,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.internalCode).toBe('E2E-CAT-PROD-001');
      expect(res.body.commercialName).toBe('E2E Catalog Test Product');
      expect(res.body.isActive).toBe(true);

      createdProductId = res.body.id;
    });
  });

  describe('Step 4: ADMIN reads the created product', () => {
    it('should return the product by ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/catalog/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(createdProductId);
      expect(res.body.commercialName).toBe('E2E Catalog Test Product');
      expect(res.body.saleType).toBe('FREE_SALE');
    });
  });

  describe('Step 5: ADMIN updates the product', () => {
    it('should update the commercial name', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/catalog/products/${createdProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          commercialName: 'E2E Updated Product Name',
        })
        .expect(200);

      expect(res.body.commercialName).toBe('E2E Updated Product Name');
    });
  });

  describe('Step 6: CASHIER cannot create a product (RBAC)', () => {
    it('should return 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/catalog/products')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({
          internalCode: 'E2E-CAT-PROD-FAKE',
          commercialName: 'Fake Product',
          genericName: 'Fake Generic',
          activePrinciple: 'Fake Principle',
          laboratory: 'Fake Lab',
          saleType: 'FREE_SALE',
          minimumStock: 5,
          initialPrice: '10000.00',
          initialTaxSchemeId: TEST_TAX_SCHEME_ID,
        })
        .expect(403);

      expect(res.body).toHaveProperty('message');
    });
  });

  describe('Step 7: ADMIN reads all products', () => {
    it('should return paginated products list', async () => {
      const res = await request(app.getHttpServer())
        .get('/catalog/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ isActive: true })
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
