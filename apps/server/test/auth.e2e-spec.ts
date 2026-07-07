import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-test-ws-001';
const TEST_USERNAME = 'e2e-test-user@pharmacy.test';
const TEST_PASSWORD = 'TestPass123!';
const TEST_FULL_NAME = 'E2E Test User';
const TEST_ROLE = 'ADMIN';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Seed test data directly in the database
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data from previous test runs
    await prisma.userSession.deleteMany({ where: { userId: 'e2e-test-user-id-001' } });
    await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
    await prisma.user.deleteMany({ where: { id: 'e2e-test-user-id-001' } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    const passwordHash = await argon2.hash(TEST_PASSWORD);

    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E Test Workstation',
        code: 'WS-E2E-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    await prisma.user.create({
      data: {
        id: 'e2e-test-user-id-001',
        username: TEST_USERNAME,
        fullName: TEST_FULL_NAME,
        passwordHash,
        passwordAlgorithm: 'argon2',
        role: TEST_ROLE,
        isActive: true,
      },
    });

    // Compile and start the NestJS app
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

    // Cleanup test data
    if (prisma) {
      const testUser = await prisma.user.findUnique({ where: { username: TEST_USERNAME } });
      if (testUser) {
        await prisma.userSession.deleteMany({ where: { userId: testUser.id } });
        await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
      }
      await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });
      await prisma.$disconnect();
    }
  });

  let accessToken: string;
  let refreshToken: string;

  describe('POST /auth/login', () => {
    it('should return 200 and tokens with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('expiresAt');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.username).toBe(TEST_USERNAME);
      expect(res.body.user.fullName).toBe(TEST_FULL_NAME);
      expect(res.body.user.role).toBe(TEST_ROLE);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user).not.toHaveProperty('passwordAlgorithm');

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('should return 401 with wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: TEST_USERNAME, password: 'WrongPassword!' })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(401);

      expect(res.body).toHaveProperty('errorCode');
      expect(res.body).toHaveProperty('message');
    });

    it('should return 401 with non-existent user', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'noone@pharmacy.test', password: TEST_PASSWORD })
        .set('x-workstation-id', TEST_WORKSTATION_ID)
        .expect(401);

      expect(res.body).toHaveProperty('errorCode');
      expect(res.body).toHaveProperty('message');
    });
  });

  describe('GET /auth/me', () => {
    it('should return the current user with a valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.username).toBe(TEST_USERNAME);
      expect(res.body.fullName).toBe(TEST_FULL_NAME);
      expect(res.body.role).toBe(TEST_ROLE);
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('passwordAlgorithm');
    });

    it('should return 401 without a token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });

    it('should return 401 with an invalid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token-here')
        .expect(401);

      expect(res.body).toHaveProperty('message');
    });
  });

  describe('POST /auth/logout', () => {
    it('should return 501 (not implemented for this phase)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(501);

      expect(res.body.errorCode).toBe('NOT_IMPLEMENTED_FOR_PHASE');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should return 501 (not implemented for this phase)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(501);

      expect(res.body.errorCode).toBe('NOT_IMPLEMENTED_FOR_PHASE');
    });
  });
});
