// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PlansService } from './plans.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { mockDeep, mockReset } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { HttpStatus } from '@nestjs/common';
import type { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-uuid-1',
    code: 'PREMIUM',
    name: 'Premium Plan',
    description: null as string | null,
    pricingModel: 'FLAT',
    basePriceCents: 99000,
    currency: 'COP',
    billingPeriod: 'MONTHLY',
    maxLocations: 1,
    maxWorkstationsPerLocation: 1,
    includedWorkstations: 1,
    extraWorkstationPriceCents: null as number | null,
    features: [] as string[],
    displayOrder: 0,
    isActive: true,
    isPublic: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildCreatePlanDto(overrides: Partial<Record<string, unknown>> = {}): CreatePlanDto {
  return {
    code: 'PREMIUM',
    name: 'Premium Plan',
    pricingModel: 'FLAT',
    basePriceCents: 99000,
    ...overrides,
  } as unknown as CreatePlanDto;
}

function buildUpdatePlanDto(overrides: Partial<Record<string, unknown>> = {}): UpdatePlanDto {
  return {
    name: 'Updated Plan Name',
    ...overrides,
  } as unknown as UpdatePlanDto;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlansService', () => {
  let service: PlansService;

  beforeEach(async () => {
    mockReset(mockPrisma);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    it('creates a plan successfully with all defaults', async () => {
      const dto = buildCreatePlanDto();
      const expectedPlan = buildPlan();
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockPrisma.plan.create.mockResolvedValue(expectedPlan);

      const result = await service.create(dto);

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { code: dto.code },
      });
      expect(mockPrisma.plan.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          code: dto.code,
          name: dto.name,
          description: null,
          pricingModel: dto.pricingModel,
          basePriceCents: dto.basePriceCents,
          currency: 'COP',
          billingPeriod: 'MONTHLY',
          maxLocations: 1,
          maxWorkstationsPerLocation: 1,
          includedWorkstations: 1,
          extraWorkstationPriceCents: null,
          features: [],
          displayOrder: 0,
          isActive: true,
          isPublic: false,
        },
      });
      expect(result).toEqual(expectedPlan);
    });

    it('throws PLAN_CODE_EXISTS when code already exists', async () => {
      const existingPlan = buildPlan();
      mockPrisma.plan.findUnique.mockResolvedValue(existingPlan);
      const dto = buildCreatePlanDto({ code: 'PREMIUM' });

      await expect(service.create(dto)).rejects.toThrow(DomainException);
    });
  });

  // -----------------------------------------------------------------------
  // findAll
  // -----------------------------------------------------------------------
  describe('findAll', () => {
    it('returns all plans without filter', async () => {
      const plans = [buildPlan(), buildPlan({ id: 'plan-uuid-2', code: 'BASIC', name: 'Basic Plan' })];
      mockPrisma.plan.findMany.mockResolvedValue(plans);

      const result = await service.findAll();

      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { displayOrder: 'asc' },
      });
      expect(result).toEqual(plans);
    });

    it('filters by isActive', async () => {
      const activePlans = [buildPlan()];
      mockPrisma.plan.findMany.mockResolvedValue(activePlans);

      const result = await service.findAll({ isActive: true });

      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { displayOrder: 'asc' },
      });
      expect(result).toEqual(activePlans);
    });
  });

  // -----------------------------------------------------------------------
  // findPublic
  // -----------------------------------------------------------------------
  describe('findPublic', () => {
    it('returns only active and public plans', async () => {
      const publicPlans = [buildPlan({ isActive: true, isPublic: true })];
      mockPrisma.plan.findMany.mockResolvedValue(publicPlans);

      const result = await service.findPublic();

      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: { isActive: true, isPublic: true },
        orderBy: { displayOrder: 'asc' },
      });
      expect(result).toEqual(publicPlans);
    });
  });

  // -----------------------------------------------------------------------
  // findById
  // -----------------------------------------------------------------------
  describe('findById', () => {
    it('returns plan when found', async () => {
      const plan = buildPlan({ id: 'plan-uuid-1' });
      mockPrisma.plan.findUnique.mockResolvedValue(plan);

      const result = await service.findById('plan-uuid-1');

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
      });
      expect(result).toEqual(plan);
    });

    it('throws PLAN_NOT_FOUND when not found', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent-id')).rejects.toThrow(DomainException);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    it('updates plan fields', async () => {
      const existingPlan = buildPlan({ id: 'plan-uuid-1' });
      const updatedPlan = buildPlan({ id: 'plan-uuid-1', name: 'Updated Plan Name' });
      const dto = buildUpdatePlanDto({ name: 'Updated Plan Name' });
      mockPrisma.plan.findUnique.mockResolvedValue(existingPlan);
      mockPrisma.plan.update.mockResolvedValue(updatedPlan);

      const result = await service.update('plan-uuid-1', dto);

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
      });
      expect(mockPrisma.plan.update).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
        data: {
          name: 'Updated Plan Name',
        },
      });
      expect(result).toEqual(updatedPlan);
    });

    it('throws PLAN_NOT_FOUND when updating non-existent plan', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      const dto = buildUpdatePlanDto();

      await expect(service.update('nonexistent-id', dto)).rejects.toThrow(DomainException);
    });
  });

  // -----------------------------------------------------------------------
  // softDelete
  // -----------------------------------------------------------------------
  describe('softDelete', () => {
    it('sets isActive to false', async () => {
      const existingPlan = buildPlan({ id: 'plan-uuid-1' });
      const deletedPlan = buildPlan({ id: 'plan-uuid-1', isActive: false });
      mockPrisma.plan.findUnique.mockResolvedValue(existingPlan);
      mockPrisma.plan.update.mockResolvedValue(deletedPlan);

      const result = await service.softDelete('plan-uuid-1');

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
      });
      expect(mockPrisma.plan.update).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
        data: { isActive: false },
      });
      expect(result).toEqual(deletedPlan);
    });

    it('throws PLAN_NOT_FOUND for non-existent plan', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('nonexistent-id')).rejects.toThrow(DomainException);
    });
  });

  // -----------------------------------------------------------------------
  // getPlanLimitDetails
  // -----------------------------------------------------------------------
  describe('getPlanLimitDetails', () => {
    it('returns limit details from plan', async () => {
      const plan = buildPlan({
        id: 'plan-uuid-1',
        maxLocations: 5,
        maxWorkstationsPerLocation: 3,
        includedWorkstations: 10,
        extraWorkstationPriceCents: 5000,
      });
      mockPrisma.plan.findUnique.mockResolvedValue(plan);

      const result = await service.getPlanLimitDetails('plan-uuid-1');

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({
        where: { id: 'plan-uuid-1' },
      });
      expect(result).toEqual({
        maxLocations: 5,
        maxWorkstationsPerLocation: 3,
        includedWorkstations: 10,
        extraWorkstationPriceCents: 5000,
      });
    });
  });
});
