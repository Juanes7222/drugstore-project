import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const TEST_WORKSTATION_ID = 'e2e-ws-hd-001';
const TEST_ADMIN_USERNAME = 'e2e-admin@hd.test';
const TEST_ADMIN_PASSWORD = 'AdminPass123!';
const TEST_CLIENT_ID = 'e2e-hd-client-id-001';

describe('Habeas Data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    await prisma.$connect();

    // Clean up any leftover data
    await prisma.userSession.deleteMany({ where: { userId: 'e2e-hd-admin-id' } });
    await prisma.user.deleteMany({ where: { username: TEST_ADMIN_USERNAME } });
    await prisma.client.deleteMany({ where: { id: TEST_CLIENT_ID } });
    await prisma.workstation.deleteMany({ where: { id: TEST_WORKSTATION_ID } });

    // Seed: Workstation
    await prisma.workstation.create({
      data: {
        id: TEST_WORKSTATION_ID,
        name: 'E2E HD Test Workstation',
        code: 'WS-E2E-HD-001',
        isActive: true,
        registeredAt: new Date(),
      },
    });

    // Seed: Admin user
    const adminHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    await prisma.user.create({
      data: {
        id: 'e2e-hd-admin-id',
        username: TEST_ADMIN_USERNAME,
        fullName: 'E2E HD Admin',
        passwordHash: adminHash,
        passwordAlgorithm: 'argon2',
        role: 'ADMIN',
        isActive: true,
      },
    });

    // Seed: Client with personal data
    await prisma.client.create({
      data: {
        id: TEST_CLIENT_ID,
        identificationType: 'CC',
        identificationNumber: 'HD1234567890',
        fullName: 'Juan Pérez Habeas Data',
        email: 'juan.perez@email.com',
        phone: '3101234567',
        address: 'Calle 123 #45-67',
        dataSubjectRequestStatus: 'NONE',
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
      await prisma.userSession.deleteMany({ where: { userId: 'e2e-hd-admin-id' } });
      await prisma.user.deleteMany({ where: { username: TEST_ADMIN_USERNAME } });
      await prisma.client.deleteMany({ where: { id: TEST_CLIENT_ID } });
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

  describe('Step 2: Request data erasure', () => {
    it('should set client status to PENDING_ERASURE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/clients/${TEST_CLIENT_ID}/data-subject-requests`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requestType: 'ERASURE' })
        .expect(200);

      expect(res.body.dataSubjectRequestStatus).toBe('PENDING_ERASURE');
    });

    it('should still have personal data visible while pending', async () => {
      const res = await request(app.getHttpServer())
        .get(`/clients/${TEST_CLIENT_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.fullName).toBe('Juan Pérez Habeas Data');
      expect(res.body.email).toBe('juan.perez@email.com');
    });
  });

  describe('Step 3: Resolve erasure request (APPROVE)', () => {
    it('should anonymize the client data', async () => {
      const res = await request(app.getHttpServer())
        .post(`/clients/${TEST_CLIENT_ID}/data-subject-requests/resolve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          resolution: 'APPROVE',
          resolutionNotes: 'E2E test erasure approved',
        })
        .expect(200);

      expect(res.body.dataSubjectRequestStatus).toBe('ERASURED');
    });

    it('should have anonymized personal data after erasure', async () => {
      const res = await request(app.getHttpServer())
        .get(`/clients/${TEST_CLIENT_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.fullName).toBe('ANONYMIZED');
      expect(res.body.email).toBeNull();
      expect(res.body.phone).toBeNull();
      expect(res.body.address).toBeNull();
      expect(res.body.identificationNumber).toBe('ANONYMIZED');
    });
  });
});
