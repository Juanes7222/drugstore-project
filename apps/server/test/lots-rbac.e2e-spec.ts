import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const WS_ID = 'e2e-ws-lots-rbac';
const ADMIN_USER = 'e2e-admin@lots-rbac.test';
const CASHIER_USER = 'e2e-cashier@lots-rbac.test';
const PWD = 'TestPass123!';

/**
 * RBAC regression for LotsController:
 * GET /inventory-lots/lots/sync and GET /inventory-lots/lots must allow CASHIER.
 * Previously only ADMIN/MANAGER/INVENTORY_ASSISTANT were allowed, so POS
 * startup sync received 403 for every cashier workstation.
 */
describe('LotsController RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let cashierToken: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    await prisma.$connect();

    await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-lots-rbac-admin', 'e2e-lots-rbac-cashier'] } } });
    await prisma.user.deleteMany({ where: { username: { in: [ADMIN_USER, CASHIER_USER] } } });
    await prisma.workstation.deleteMany({ where: { id: WS_ID } });

    await prisma.workstation.create({ data: { id: WS_ID, name: 'Lots RBAC WS', code: 'WS-LOTS-RBAC', isActive: true, registeredAt: new Date() } });

    await prisma.user.create({
      data: { id: 'e2e-lots-rbac-admin', username: ADMIN_USER, fullName: 'Admin RBAC', passwordHash: await argon2.hash(PWD), passwordAlgorithm: 'argon2', role: 'ADMIN', isActive: true },
    });
    await prisma.user.create({
      data: { id: 'e2e-lots-rbac-cashier', username: CASHIER_USER, fullName: 'Cashier RBAC', passwordHash: await argon2.hash(PWD), passwordAlgorithm: 'argon2', role: 'CASHIER', isActive: true },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const adminRes = await request(app.getHttpServer()).post('/auth/login').send({ username: ADMIN_USER, password: PWD }).set('x-workstation-id', WS_ID).expect(200);
    adminToken = adminRes.body.accessToken;
    const cashierRes = await request(app.getHttpServer()).post('/auth/login').send({ username: CASHIER_USER, password: PWD }).set('x-workstation-id', WS_ID).expect(200);
    cashierToken = cashierRes.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.userSession.deleteMany({ where: { userId: { in: ['e2e-lots-rbac-admin', 'e2e-lots-rbac-cashier'] } } });
      await prisma.user.deleteMany({ where: { username: { in: [ADMIN_USER, CASHIER_USER] } } });
      await prisma.workstation.deleteMany({ where: { id: WS_ID } });
      await prisma.$disconnect();
    }
  });

  it('GET /inventory-lots/lots/sync allows CASHIER (200, not 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/inventory-lots/lots/sync')
      .set('Authorization', `Bearer ${cashierToken}`)
      .query({ limit: '5' })
      .expect(200);

    // Should return a paginated response, not a ForbiddenException
    expect(res.body).toBeDefined();
  });

  it('GET /inventory-lots/lots allows CASHIER (200, not 403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/inventory-lots/lots')
      .set('Authorization', `Bearer ${cashierToken}`)
      .query({ page: 1, pageSize: 5 })
      .expect(200);

    expect(res.body).toBeDefined();
    expect(res.body).toHaveProperty('data');
  });

  it('still allows ADMIN to access sync', async () => {
    await request(app.getHttpServer())
      .get('/inventory-lots/lots/sync')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: '5' })
      .expect(200);
  });

  it('returns 401 when unauthenticated', async () => {
    await request(app.getHttpServer()).get('/inventory-lots/lots/sync').expect(401);
  });
});
