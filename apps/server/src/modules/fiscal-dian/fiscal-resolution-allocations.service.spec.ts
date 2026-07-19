jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalResolutionAllocationsService } from './fiscal-resolution-allocations.service';
import { AllocationRangeInvalidException } from './exceptions/allocation-range-invalid.exception';
import { CreateFiscalResolutionAllocationDto } from './dto/create-fiscal-resolution-allocation.dto';

describe('FiscalResolutionAllocationsService', () => {
  let service: FiscalResolutionAllocationsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new FiscalResolutionAllocationsService(prisma as any);
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    const mockAllocations = [
      { id: 'alloc-1', resolutionId: 'res-1', workstationId: 'ws-1' },
    ];

    it('returns paginated list with total count', async () => {
      (prisma.fiscalResolutionAllocation.findMany as jest.Mock).mockResolvedValue(mockAllocations);
      (prisma.fiscalResolutionAllocation.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll(1, 20);

      expect(result).toEqual({
        data: mockAllocations,
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(prisma.fiscalResolutionAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { allocatedAt: 'desc' },
        }),
      );
    });

    it('applies pagination offsets correctly', async () => {
      (prisma.fiscalResolutionAllocation.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalResolutionAllocation.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(3, 15);

      expect(prisma.fiscalResolutionAllocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 30, take: 15 }),
      );
    });
  });

  // ── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the allocation when found', async () => {
      const mockAllocation = { id: 'alloc-1', resolutionId: 'res-1' };
      (prisma.fiscalResolutionAllocation.findUnique as jest.Mock).mockResolvedValue(mockAllocation);

      const result = await service.findById('alloc-1');

      expect(result).toEqual(mockAllocation);
      expect(prisma.fiscalResolutionAllocation.findUnique).toHaveBeenCalledWith({
        where: { id: 'alloc-1' },
      });
    });

    it('returns null when not found (no exception)', async () => {
      (prisma.fiscalResolutionAllocation.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = new CreateFiscalResolutionAllocationDto({
      resolutionId: 'res-1',
      workstationId: 'ws-1',
      rangeFrom: 1,
      rangeTo: 100,
    });

    const mockResolution = {
      id: 'res-1',
      rangeFrom: 1,
      rangeTo: 1000,
    };

    it('creates an allocation with valid range inside resolution bounds', async () => {
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(mockResolution);
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue(null); // no overlap
      (prisma.fiscalResolutionAllocation.create as jest.Mock).mockResolvedValue({
        id: 'alloc-new',
        resolutionId: 'res-1',
        workstationId: 'ws-1',
      });

      const result = await service.create(validDto, 'user-1');

      expect(result).toBeDefined();
      expect(prisma.fiscalResolutionAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionId: 'res-1',
            workstationId: 'ws-1',
            allocatedByUserId: 'user-1',
            currentConsecutive: 0,
          }),
        }),
      );
    });

    it('throws AllocationRangeInvalidException when rangeFrom > rangeTo', async () => {
      const invalidDto = new CreateFiscalResolutionAllocationDto({
        resolutionId: 'res-1',
        workstationId: 'ws-1',
        rangeFrom: 100,
        rangeTo: 1,
      });

      await expect(service.create(invalidDto, 'user-1')).rejects.toThrow(AllocationRangeInvalidException);
    });

    it('throws AllocationRangeInvalidException when resolution does not exist', async () => {
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(AllocationRangeInvalidException);
    });

    it('throws AllocationRangeInvalidException when allocation range exceeds resolution bounds', async () => {
      const outOfBoundsDto = new CreateFiscalResolutionAllocationDto({
        resolutionId: 'res-1',
        workstationId: 'ws-1',
        rangeFrom: 1,
        rangeTo: 2000, // resolution only goes to 1000
      });
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(mockResolution);

      await expect(service.create(outOfBoundsDto, 'user-1')).rejects.toThrow(AllocationRangeInvalidException);
    });

    it('throws AllocationRangeInvalidException when range overlaps an existing allocation', async () => {
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(mockResolution);
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue({
        id: 'overlapping-alloc',
        rangeFrom: 50,
        rangeTo: 150,
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(AllocationRangeInvalidException);
    });

    it('sets currentConsecutive to rangeFrom minus one', async () => {
      const bigResolution = { id: 'res-big', rangeFrom: 1, rangeTo: 5000 };
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(bigResolution);
      (prisma.fiscalResolutionAllocation.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.fiscalResolutionAllocation.create as jest.Mock).mockResolvedValue({ id: 'alloc-new' });

      const dto = new CreateFiscalResolutionAllocationDto({
        resolutionId: 'res-big',
        workstationId: 'ws-1',
        rangeFrom: 500,
        rangeTo: 1500,
      });

      await service.create(dto, 'user-2');

      expect(prisma.fiscalResolutionAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentConsecutive: 499, // 500 - 1
          }),
        }),
      );
    });
  });
});
