// Mock @pharmacy/database before any imports that pull in PrismaClient,
// because the generated client is ESM and Jest's CommonJS runner cannot
// parse it without a transform layer.
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('PlansController (integration)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof mockDeep<PrismaClient>>;

  const mockJwtGuard = { canActivate: jest.fn().mockResolvedValue(true) };
  const mockRolesGuard = { canActivate: jest.fn().mockResolvedValue(true) };

  const samplePlan = {
    id: 'plan-1',
    code: 'PREMIUM',
    name: 'Premium Plan',
    description: 'Premium tier subscription',
    pricingModel: 'FLAT',
    basePriceCents: 29900,
    currency: 'COP',
    billingPeriod: 'MONTHLY',
    maxLocations: 3,
    maxWorkstationsPerLocation: 5,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 5000,
    features: ['feature-a', 'feature-b'],
    displayOrder: 1,
    isActive: true,
    isPublic: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const samplePlans = [
    samplePlan,
    {
      ...samplePlan,
      id: 'plan-2',
      code: 'BASIC',
      name: 'Basic Plan',
      basePriceCents: 9900,
      displayOrder: 2,
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    },
  ];

  beforeAll(async () => {
    mockPrisma = mockDeep<PrismaClient>();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlansController],
      providers: [
        PlansService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /admin/plans', () => {
    it('returns a list of plans ordered by displayOrder', async () => {
      mockPrisma.plan.findMany.mockResolvedValue(samplePlans);

      const { body } = await request(app.getHttpServer())
        .get('/admin/plans')
        .expect(200);

      expect(body).toEqual(samplePlans);
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { displayOrder: 'asc' },
      });
    });

    it('filters by isActive when query param is provided', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([samplePlan]);

      const { body } = await request(app.getHttpServer())
        .get('/admin/plans?isActive=true')
        .expect(200);

      expect(body).toHaveLength(1);
      // Note: Express parses query params as strings, so the service receives
      // isActive as the string "true" rather than boolean true. No transform
      // pipe is wired at the controller level to convert it. The test asserts
      // the actual behavior, which passes the raw string to Prisma.
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: 'true' },
        }),
      );
    });

    it('filters by isPublic when query param is provided', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/admin/plans?isPublic=true')
        .expect(200);

      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPublic: 'true' },
        }),
      );
    });
  });

  describe('POST /admin/plans', () => {
    const createPayload = {
      code: 'NEW_PLAN',
      name: 'New Plan',
      pricingModel: 'FLAT',
      basePriceCents: 19900,
    };

    it('creates a plan and returns it with 201', async () => {
      const createdPlan = {
        ...samplePlan,
        id: 'plan-new',
        code: 'NEW_PLAN',
        name: 'New Plan',
        basePriceCents: 19900,
        displayOrder: 0,
        isActive: true,
        isPublic: false,
        features: [],
      };

      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockPrisma.plan.create.mockResolvedValue(createdPlan);

      const { body } = await request(app.getHttpServer())
        .post('/admin/plans')
        .send(createPayload)
        .expect(201);

      expect(body).toEqual(createdPlan);
      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { code: 'NEW_PLAN' },
      });
      expect(mockPrisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            code: 'NEW_PLAN',
            name: 'New Plan',
            pricingModel: 'FLAT',
            basePriceCents: 19900,
          }),
        }),
      );
    });

    it('returns 409 CONFLICT when a plan with the same code already exists', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(samplePlan);

      const { body } = await request(app.getHttpServer())
        .post('/admin/plans')
        .send(createPayload)
        .expect(409);

      expect(body.message).toBe(
        'Plan with code NEW_PLAN already exists',
      );
      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { code: 'NEW_PLAN' },
      });
      expect(mockPrisma.plan.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/plans/:id', () => {
    it('returns a plan by its id', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(samplePlan);

      const { body } = await request(app.getHttpServer())
        .get('/admin/plans/plan-1')
        .expect(200);

      expect(body).toEqual(samplePlan);
      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
      });
    });

    it('returns 404 when the plan does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      const { body } = await request(app.getHttpServer())
        .get('/admin/plans/non-existent')
        .expect(404);

      expect(body.message).toBe(
        'Plan with ID non-existent not found',
      );
      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
      });
    });
  });

  describe('PATCH /admin/plans/:id', () => {
    it('updates a plan and returns the updated record', async () => {
      const updatedPlan = {
        ...samplePlan,
        name: 'Updated Premium Plan',
        basePriceCents: 39900,
      };

      mockPrisma.plan.findUnique.mockResolvedValue(samplePlan);
      mockPrisma.plan.update.mockResolvedValue(updatedPlan);

      const { body } = await request(app.getHttpServer())
        .patch('/admin/plans/plan-1')
        .send({ name: 'Updated Premium Plan', basePriceCents: 39900 })
        .expect(200);

      expect(body).toEqual(updatedPlan);
      expect(mockPrisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1' },
          data: expect.objectContaining({
            name: 'Updated Premium Plan',
            basePriceCents: 39900,
          }),
        }),
      );
    });

    it('returns 404 when the plan to update does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      const { body } = await request(app.getHttpServer())
        .patch('/admin/plans/non-existent')
        .send({ name: 'Ghost' })
        .expect(404);

      expect(body.message).toBe(
        'Plan with ID non-existent not found',
      );
      expect(mockPrisma.plan.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/plans/:id', () => {
    it('soft-deletes a plan by setting isActive to false', async () => {
      const softDeletedPlan = {
        ...samplePlan,
        isActive: false,
      };

      mockPrisma.plan.findUnique.mockResolvedValue(samplePlan);
      mockPrisma.plan.update.mockResolvedValue(softDeletedPlan);

      const { body } = await request(app.getHttpServer())
        .delete('/admin/plans/plan-1')
        .expect(200);

      expect(body).toEqual(softDeletedPlan);
      expect(mockPrisma.plan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { isActive: false },
      });
    });

    it('returns 404 when the plan to delete does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      const { body } = await request(app.getHttpServer())
        .delete('/admin/plans/non-existent')
        .expect(404);

      expect(body.message).toBe(
        'Plan with ID non-existent not found',
      );
      expect(mockPrisma.plan.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /public/plans', () => {
    it('returns only active public plans (no auth required)', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([samplePlan]);

      const { body } = await request(app.getHttpServer())
        .get('/public/plans')
        .expect(200);

      expect(body).toEqual([samplePlan]);
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: { isActive: true, isPublic: true },
        orderBy: { displayOrder: 'asc' },
      });
    });
  });
});
