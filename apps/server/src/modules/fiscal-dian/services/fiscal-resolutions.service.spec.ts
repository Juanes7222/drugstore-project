jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalResolutionsService } from './fiscal-resolutions.service';
import { InvalidResolutionRangeException } from '../exceptions/invalid-resolution-range.exception';
import { OverlappingActiveResolutionException } from '../exceptions/overlapping-active-resolution.exception';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';

describe('FiscalResolutionsService', () => {
  let service: FiscalResolutionsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new FiscalResolutionsService(prisma as any);
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    const mockResolutions = [
      { id: 'res-1', resolutionNumber: 'RES-001', state: 'ACTIVE' },
    ];

    it('returns paginated results', async () => {
      (prisma.fiscalResolution.findMany as jest.Mock).mockResolvedValue(mockResolutions);
      (prisma.fiscalResolution.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        data: mockResolutions,
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(prisma.fiscalResolution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('filters by state when provided', async () => {
      (prisma.fiscalResolution.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalResolution.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, state: 'ACTIVE' });

      expect(prisma.fiscalResolution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: 'ACTIVE' },
        }),
      );
    });

    it('computes skip correctly for page 2', async () => {
      (prisma.fiscalResolution.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fiscalResolution.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 2, pageSize: 10 });

      expect(prisma.fiscalResolution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  // ── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the resolution when found', async () => {
      const mockResolution = { id: 'res-1', resolutionNumber: 'RES-001' };
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(mockResolution);

      const result = await service.findById('res-1');

      expect(result).toEqual(mockResolution);
      expect(prisma.fiscalResolution.findUnique).toHaveBeenCalledWith({ where: { id: 'res-1' } });
    });

    it('returns null when not found (no exception)', async () => {
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = new CreateFiscalResolutionDto({
      resolutionNumber: 'RES-2024-001',
      documentType: 'INVOICE',
      prefix: 'PRE',
      rangeFrom: 1,
      rangeTo: 1000,
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2024-12-31T23:59:59.000Z',
      workstationId: 'ws-1',
    });

    it('creates a resolution with valid range', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue(null); // no overlap
      (prisma.fiscalResolution.create as jest.Mock).mockResolvedValue({
        id: 'res-new',
        resolutionNumber: 'RES-2024-001',
      });

      const result = await service.create(validDto);

      expect(result).toBeDefined();
      expect(prisma.fiscalResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionNumber: 'RES-2024-001',
            documentType: 'INVOICE',
            prefix: 'PRE',
            state: 'ACTIVE',
          }),
        }),
      );
    });

    it('throws InvalidResolutionRangeException when rangeFrom > rangeTo', async () => {
      const invalidDto = new CreateFiscalResolutionDto({
        resolutionNumber: 'RES-INVALID',
        documentType: 'INVOICE',
        prefix: 'INV',
        rangeFrom: 100,
        rangeTo: 1,
        validFrom: '2024-01-01T00:00:00.000Z',
        validTo: '2024-12-31T23:59:59.000Z',
        workstationId: 'ws-1',
      });

      await expect(service.create(invalidDto)).rejects.toThrow(InvalidResolutionRangeException);
    });

    it('throws OverlappingActiveResolutionException when an active resolution exists on same tuple', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue({
        id: 'overlapping',
        state: 'ACTIVE',
      });

      await expect(service.create(validDto)).rejects.toThrow(OverlappingActiveResolutionException);
    });

    it('allows creation when workstationId is null and existing has null workstationId', async () => {
      const dtoWithNullWs = new CreateFiscalResolutionDto({
        resolutionNumber: 'RES-NULLWS',
        documentType: 'INVOICE',
        prefix: 'NUL',
        rangeFrom: 1,
        rangeTo: 100,
        validFrom: '2024-01-01T00:00:00.000Z',
        validTo: '2024-12-31T23:59:59.000Z',
        workstationId: null,
      });
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.fiscalResolution.create as jest.Mock).mockResolvedValue({ id: 'res-nullws' });

      const result = await service.create(dtoWithNullWs);

      expect(result).toBeDefined();
      expect(prisma.fiscalResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workstationId: null }),
        }),
      );
    });
  });
});
