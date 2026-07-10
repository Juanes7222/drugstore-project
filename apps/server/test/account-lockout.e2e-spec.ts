import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-ws-lock-001';
const TEST_USERNAME = 'e2e-lockout@test.test';
const TEST_PASSWORD = 'ValidPass123!';

describe('Account lockout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data
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

    // Seed: User with 4 failed attempts (one away from lockout threshold of 5)
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
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (prisma) {
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-lockout-user-id' } });
      await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  describe('Step 1: 5th failed attempt triggers lockout', () => {
    it('should return 401 for each of the first 4 attempts (pre-seeded)', async () => {
      // The user is pre-seeded with 4 failedLoginAttempts.
      // A 5th failed attempt should trigger lockout.
      // First, verify a wrong password returns 401.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_USERNAME, password: 'WrongPassword!' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });

    it('should lock the account and return 423 or 403 on 6th attempt', async () => {
      // After the 5th failed attempt (step above), the account is locked.
      // Even correct password should be rejected.
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID);

      // Either 423 (Locked) or 403 (Forbidden) depending on implementation
      expect([403, 423]).toContain(res.status);
      expect(res.body).toHaveProperty('message');
    });
  });

  describe('Step 2: Clear lock via DB and verify login works', () => {
    it('should allow login after lock is cleared', async () => {
      // Directly update the DB to clear the lockout
      await prisma.user.update({
        where: { username: TEST_USERNAME },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      // Now login should succeed
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user.username).toBe(TEST_USERNAME);
    });
  });
});
