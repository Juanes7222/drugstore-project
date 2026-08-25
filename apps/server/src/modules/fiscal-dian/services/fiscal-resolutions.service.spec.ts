import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalResolutionsService } from './fiscal-resolutions.service';
import { InvalidResolutionRangeException } from '../exceptions/invalid-resolution-range.exception';
import { OverlappingActiveResolutionException } from '../exceptions/overlapping-active-resolution.exception';
import { DianRangeConflictException } from '../exceptions/dian-range-conflict.exception';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';

describe('FiscalResolutionsService', () => {
  let service: FiscalResolutionsService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockTenantContext = {
    getSubscriptionId: jest.fn(() => 'test-subscription-id'),
    hasTenant: jest.fn(() => true),
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new FiscalResolutionsService(
      prisma as any,
      mockTenantContext as any,
    );
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    const mockResolutions = [
      { id: 'res-1', resolutionNumber: 'RES-001', state: 'ACTIVE' },
    ];

    it('returns paginated results', async () => {
      (prisma.fiscalResolution.findMany as jest.Mock).mockResolvedValue(
        mockResolutions,
      );
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
      (prisma.fiscalResolution.findUnique as jest.Mock).mockResolvedValue(
        mockResolution,
      );

      const result = await service.findById('res-1');

      expect(result).toEqual(mockResolution);
      expect(prisma.fiscalResolution.findUnique).toHaveBeenCalledWith({
        where: { id: 'res-1' },
      });
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

    it('creates a resolution with ACTIVE state and currentConsecutive=0', async () => {
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
            currentConsecutive: 0,
            rangeFrom: 1,
            rangeTo: 1000,
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

      await expect(service.create(invalidDto)).rejects.toThrow(
        InvalidResolutionRangeException,
      );
    });

    it('throws OverlappingActiveResolutionException when an active resolution exists on same tuple', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue({
        id: 'overlapping',
        state: 'ACTIVE',
      });

      await expect(service.create(validDto)).rejects.toThrow(
        OverlappingActiveResolutionException,
      );
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
      (prisma.fiscalResolution.create as jest.Mock).mockResolvedValue({
        id: 'res-nullws',
      });

      const result = await service.create(dtoWithNullWs);

      expect(result).toBeDefined();
      expect(prisma.fiscalResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workstationId: null }),
        }),
      );
    });
  });

  // ── applyDianRanges ───────────────────────────────────────────────────

  describe('applyDianRanges', () => {
    // Far-future window so ranges are never treated as expired by accident.
    const FUTURE_FROM = '2030-01-01T00:00:00Z';
    const FUTURE_TO = '2032-12-31T00:00:00Z';
    const PAST_TO = '2020-01-01T00:00:00Z';

    const range = (overrides: Record<string, unknown> = {}) => ({
      resolutionNumber: '9310000085419',
      prefix: 'F002',
      fromNumber: 1,
      toNumber: 99999999,
      validFrom: FUTURE_FROM,
      validTo: FUTURE_TO,
      technicalKey: 'FC8EAC422EBA16E22FFD8C6F94B3F40A6E38162C',
      ...overrides,
    });

    it('creates an ACTIVE master resolution (workstationId null) for a new range', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.fiscalResolution.create as jest.Mock).mockResolvedValue({
        id: 'res-created',
      });

      const result = await service.applyDianRanges([range()]);

      expect(result.created).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(prisma.fiscalResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionNumber: '9310000085419',
            prefix: 'F002',
            documentType: 'INVOICE',
            state: 'ACTIVE',
            currentConsecutive: 0,
            workstationId: null,
            subscriptionId: 'test-subscription-id',
          }),
        }),
      );
    });

    it.each([
      ['NS001', 'POS_TICKET'],
      ['NC01', 'CREDIT_NOTE'],
      ['ND02', 'DEBIT_NOTE'],
      ['FV1', 'INVOICE'],
    ])('maps prefix %s to %s', async (prefix, expectedType) => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.fiscalResolution.create as jest.Mock).mockResolvedValue({
        id: 'res-x',
      });

      await service.applyDianRanges([range({ prefix, resolutionNumber: `R-${prefix}` })]);

      expect(prisma.fiscalResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ documentType: expectedType }),
        }),
      );
    });

    it('skips IDENTICAL_EXISTS when the same ACTIVE resolution already exists', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue({
        id: 'res-existing',
        state: 'ACTIVE',
        prefix: 'F002',
        documentType: 'INVOICE',
        rangeFrom: 1,
        rangeTo: 99999999,
        validFrom: new Date(FUTURE_FROM),
        validTo: new Date(FUTURE_TO),
      });

      const result = await service.applyDianRanges([range()]);

      expect(result.skipped).toEqual([
        {
          resolutionNumber: '9310000085419',
          prefix: 'F002',
          reason: 'IDENTICAL_EXISTS',
        },
      ]);
      expect(prisma.fiscalResolution.create).not.toHaveBeenCalled();
    });

    it('skips EXPIRED ranges without creating rows', async () => {
      const result = await service.applyDianRanges([
        range({ validTo: PAST_TO }),
      ]);

      expect(result.skipped).toEqual([
        {
          resolutionNumber: '9310000085419',
          prefix: 'F002',
          reason: 'EXPIRED',
        },
      ]);
      expect(prisma.fiscalResolution.create).not.toHaveBeenCalled();
    });

    it('collects a conflict when the same resolution number exists with different data', async () => {
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue({
        id: 'res-diff',
        state: 'ACTIVE',
        prefix: 'F002',
        documentType: 'INVOICE',
        rangeFrom: 1,
        rangeTo: 500,
        validFrom: new Date(FUTURE_FROM),
        validTo: new Date(FUTURE_TO),
      });

      await expect(service.applyDianRanges([range()])).rejects.toThrow(
        DianRangeConflictException,
      );
      expect(prisma.fiscalResolution.create).not.toHaveBeenCalled();
    });

    it('collects a conflict when a different ACTIVE resolution occupies the tuple', async () => {
      // First findFirst (existing-by-number) → null; second (overlap check)
      // → an active row on the same (documentType, prefix).
      (prisma.fiscalResolution.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'res-overlap', state: 'ACTIVE' });

      await expect(service.applyDianRanges([range()])).rejects.toThrow(
        DianRangeConflictException,
      );
      expect(prisma.fiscalResolution.create).not.toHaveBeenCalled();
    });

    it('reports unparseable validity dates as conflicts', async () => {
      await expect(
        service.applyDianRanges([range({ validFrom: 'not-a-date' })]),
      ).rejects.toThrow(DianRangeConflictException);
      expect(prisma.fiscalResolution.findFirst).not.toHaveBeenCalled();
    });

    it('throws with all conflicts aggregated (all-or-nothing)', async () => {
      // Range A: same number different data. Range B: expired (skip, not conflict).
      (prisma.fiscalResolution.findFirst as jest.Mock).mockResolvedValue({
        id: 'res-diff',
        state: 'ACTIVE',
        prefix: 'OTHER',
        documentType: 'INVOICE',
        rangeFrom: 1,
        rangeTo: 500,
        validFrom: new Date(FUTURE_FROM),
        validTo: new Date(FUTURE_TO),
      });

      try {
        await service.applyDianRanges([range(), range({ validTo: PAST_TO })]);
        fail('expected DianRangeConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(DianRangeConflictException);
        expect((error as DianRangeConflictException).conflicts).toHaveLength(1);
      }
    });
  });
});
