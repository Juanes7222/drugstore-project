import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ValidationPipe } from '@nestjs/common';
import { TenantContextInterceptor } from '../src/modules/tenant/tenant-context.interceptor';

const TEST_WORKSTATION_ID = 'e2e-ws-lock-001';
const TEST_USERNAME = 'e2e-lockout@test.test';
const TEST_PASSWORD = 'ValidPass123!';

describe('Account lockout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
    await prisma.$connect();

    // Clean up any leftover data
    await prisma.auditLog.deleteMany({ where: { userId: 'e2e-lockout-user-id' } });
    await prisma.userSession.deleteMany({ where: { userId: 'e2e-lockout-user-id' } });
    await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Lockout Test Workstation',
        code: 'WS-E2E-LOCK-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: User with 4 failed attempts (threshold of 5 is one away)
    const passwordHash = await argon2.hash(TEST_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-lockout-user-id',
        username: TEST_USERNAME,
        fullName: 'E2E Lockout Test User',
        passwordHash,
        passwordAlgorithm: 'argon2',
        role: 'CASHIER',
        isActive: true,
        failedLoginAttempts: 4,
        lockedUntil: null,
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
      await prisma.auditLog.deleteMany({ where: { userId: 'e2e-lockout-user-id' } });
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-lockout-user-id' } });
      await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  describe('Step 1: 5th failed attempt triggers lockout', () => {
    it('should lock the account when the 5th failed attempt happens (403)', async () => {
      // The 5th failed attempt itself is rejected with the lock exception:
      // the counter is incremented first, the threshold is crossed, and the
      // handler throws before the generic invalid-credentials error.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_USERNAME, secret: 'WrongPassword!', sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(403);

      expect(res.body).toHaveProperty('message');
    });

    it('should reject even the correct password while locked (403)', async () => {
      // The account is now locked. Even correct password must be rejected.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_USERNAME, secret: TEST_PASSWORD, sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(403);

      expect(res.body).toHaveProperty('message');
    });
  });

  describe('Step 2: Clear lock via DB and verify login works', () => {
    it('should allow login after lock is cleared', async () => {
      // Directly update the DB to clear the lockout
      await prisma.user.updateMany({
        where: { username: TEST_USERNAME },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Now login should succeed
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: TEST_USERNAME, secret: TEST_PASSWORD, sessionType: 'PASSWORD' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user.username).toBe(TEST_USERNAME);
    });
  });
});
