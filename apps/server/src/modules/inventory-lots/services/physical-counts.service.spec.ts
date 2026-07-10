// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  PhysicalCountState: { OPEN: 'OPEN', COUNTED: 'COUNTED', REVIEWED: 'REVIEWED', APPROVED: 'APPROVED', APPLIED: 'APPLIED', ANNULLED: 'ANNULLED' },
  AdjustmentState: { DRAFT: 'DRAFT', PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED', ANNULLED: 'ANNULLED' },
  MovementType: { POSITIVE_ADJUSTMENT: 'POSITIVE_ADJUSTMENT', NEGATIVE_ADJUSTMENT: 'NEGATIVE_ADJUSTMENT' },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PhysicalCountsService } from './physical-counts.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { PhysicalCountNotFoundException } from '../exceptions/physical-count-not-found.exception';
import { PhysicalCountNotOpenException } from '../exceptions/physical-count-not-open.exception';
import { PhysicalCountNotCountedException } from '../exceptions/physical-count-not-counted.exception';
import { PhysicalCountNotReviewedException } from '../exceptions/physical-count-not-reviewed.exception';
import { PhysicalCountNotApprovedException } from '../exceptions/physical-count-not-approved.exception';
import { PhysicalCountCannotBeAnnulledException } from '../exceptions/physical-count-cannot-be-annulled.exception';
import { LotNotFoundException } from '../exceptions/lot-not-found.exception';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('PhysicalCountsService', () => {
  let service: PhysicalCountsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let adjustmentsService: jest.Mocked<InventoryAdjustmentsService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    adjustmentsService = {
      create: jest.fn(),
      submit: jest.fn(),
      approve: jest.fn(),
      apply: jest.fn(),
      annul: jest.fn(),
    } as any;
    service = new PhysicalCountsService(prisma as any, adjustmentsService);
  });

  // ── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated physical counts with total', async () => {
      const mockData = [{ id: 'pc-1', state: 'OPEN' }];
      (prisma.$transaction as jest.Mock).mockImplementation(async (promises: any) => Promise.all(promises));
      (prisma.physicalCount.findMany as jest.Mock).mockResolvedValue(mockData);
      (prisma.physicalCount.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockData, total: 1, page: 1, pageSize: 20 });
    });

    it('filters by state', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (promises: any) => Promise.all(promises));
      (prisma.physicalCount.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.physicalCount.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, state: 'OPEN' });

      expect(prisma.physicalCount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { state: 'OPEN' } }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns count with enriched adjustment movements', async () => {
      const mockCount = {
        id: 'pc-1',
        adjustmentDocuments: [{ id: 'adj-1' }],
      };
      const mockMovements = [
        { id: 'mov-1', adjustmentDocumentId: 'adj-1', lot: { id: UUID } },
      ];
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(mockCount);
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue(mockMovements);

      const result = await service.findOne('pc-1');

      expect(result.adjustmentDocuments[0].movements).toHaveLength(1);
    });

    it('throws PhysicalCountNotFoundException when not found', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(/Physical count.*not found/);
    });
  });

  // ── start ────────────────────────────────────────────────────────────

  describe('start', () => {
    it('creates a new physical count with OPEN state', async () => {
      (prisma.physicalCount.findFirst as jest.Mock).mockResolvedValue(null);
      const created = { id: 'pc-1', state: 'OPEN' };
      (prisma.physicalCount.create as jest.Mock).mockResolvedValue(created);

      const result = await service.start({ notes: 'Monthly count' }, 'user-1');

      expect(result).toEqual(created);
    });
  });

  // ── registerCount ────────────────────────────────────────────────────

  describe('registerCount', () => {
    it('returns matched:true when countedQuantity equals expected stock', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'OPEN' });
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ id: UUID, currentStock: 10 });

      const result = await service.registerCount('pc-1', { lotId: UUID, countedQuantity: 10 }, 'user-1');

      expect(result).toEqual({ matched: true });
    });

    it('creates adjustment via InventoryAdjustmentsService when quantity differs', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'OPEN' });
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ id: UUID, currentStock: 10 });
      (prisma.inventoryAdjustmentDocument.findFirst as jest.Mock).mockResolvedValue(null);
      adjustmentsService.create.mockResolvedValue({ id: 'new-adj' });

      const result = await service.registerCount('pc-1', { lotId: UUID, countedQuantity: 15 }, 'user-1');

      expect(adjustmentsService.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 'new-adj' });
    });

    it('throws PhysicalCountNotFoundException when count does not exist', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.registerCount('pc-1', { lotId: UUID, countedQuantity: 5 }, 'user-1'))
        .rejects.toThrow(/Physical count.*not found/);
    });

    it('throws PhysicalCountNotOpenException when not OPEN', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'COUNTED' });

      await expect(service.registerCount('pc-1', { lotId: UUID, countedQuantity: 5 }, 'user-1'))
        .rejects.toThrow(/not in OPEN/);
    });

    it('throws LotNotFoundException when lot does not exist', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'OPEN' });
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.registerCount('pc-1', { lotId: 'bad-lot', countedQuantity: 5 }, 'user-1'))
        .rejects.toThrow(/Lot.*not found/);
    });
  });

  // ── finish ───────────────────────────────────────────────────────────

  describe('finish', () => {
    it('transitions OPEN to COUNTED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'OPEN' });
      (prisma.physicalCount.update as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'COUNTED' });

      const result = await service.finish('pc-1');

      expect(result.state).toBe('COUNTED');
    });

    it('throws PhysicalCountNotFoundException when not found', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.finish('missing')).rejects.toThrow(/Physical count.*not found/);
    });

    it('throws PhysicalCountNotOpenException when not OPEN', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'COUNTED' });

      await expect(service.finish('pc-1')).rejects.toThrow(/not in OPEN/);
    });
  });

  // ── review ───────────────────────────────────────────────────────────

  describe('review', () => {
    it('transitions COUNTED to REVIEWED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'COUNTED' });
      (prisma.physicalCount.update as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'REVIEWED' });

      const result = await service.review('pc-1');

      expect(result.state).toBe('REVIEWED');
    });

    it('throws PhysicalCountNotCountedException when not COUNTED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'OPEN' });

      await expect(service.review('pc-1')).rejects.toThrow(/not in COUNTED/);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────

  describe('approve', () => {
    it('submits and approves all DRAFT adjustment docs, transitions to APPROVED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({
        id: 'pc-1',
        state: 'REVIEWED',
        adjustmentDocuments: [{ id: 'adj-1' }, { id: 'adj-2' }],
      });
      adjustmentsService.submit.mockResolvedValue(undefined);
      adjustmentsService.approve.mockResolvedValue(undefined);
      (prisma.physicalCount.update as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'APPROVED' });

      const result = await service.approve('pc-1', 'user-1');

      expect(adjustmentsService.submit).toHaveBeenCalledTimes(2);
      expect(adjustmentsService.approve).toHaveBeenCalledTimes(2);
      expect(result.state).toBe('APPROVED');
    });

    it('throws PhysicalCountNotFoundException when not found', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.approve('missing', 'user-1')).rejects.toThrow(/Physical count.*not found/);
    });

    it('throws PhysicalCountNotReviewedException when not REVIEWED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'COUNTED', adjustmentDocuments: [] });

      await expect(service.approve('pc-1', 'user-1')).rejects.toThrow(/not in REVIEWED/);
    });
  });

  // ── apply ────────────────────────────────────────────────────────────

  describe('apply', () => {
    it('applies all APPROVED adjustment docs in transaction', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
        (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({
          id: 'pc-1',
          state: 'APPROVED',
          adjustmentDocuments: [{ id: 'adj-1' }],
        });
        (prisma.physicalCount.update as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'APPLIED' });
        return cb(prisma);
      });
      adjustmentsService.apply.mockResolvedValue(undefined);

      const result = await service.apply('pc-1', 'user-1');

      expect(adjustmentsService.apply).toHaveBeenCalledWith('adj-1', 'user-1', prisma);
      expect(result.state).toBe('APPLIED');
    });

    it('throws PhysicalCountNotFoundException when not found', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
        (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);
        return cb(prisma);
      });

      await expect(service.apply('missing', 'user-1')).rejects.toThrow(/Physical count.*not found/);
    });

    it('throws PhysicalCountNotApprovedException when not APPROVED', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => {
        (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'REVIEWED', adjustmentDocuments: [] });
        return cb(prisma);
      });

      await expect(service.apply('pc-1', 'user-1')).rejects.toThrow(/not in APPROVED/);
    });
  });

  // ── annul ────────────────────────────────────────────────────────────

  describe('annul', () => {
    it('annuls all non-annulled adjustment docs, transitions to ANNULLED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({
        id: 'pc-1',
        state: 'REVIEWED',
        adjustmentDocuments: [{ id: 'adj-1' }],
      });
      adjustmentsService.annul.mockResolvedValue(undefined);
      (prisma.physicalCount.update as jest.Mock).mockResolvedValue({ id: 'pc-1', state: 'ANNULLED' });

      const result = await service.annul('pc-1', 'user-1');

      expect(adjustmentsService.annul).toHaveBeenCalledWith('adj-1', 'user-1', expect.any(Object));
      expect(result.state).toBe('ANNULLED');
    });

    it('throws PhysicalCountNotFoundException when not found', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.annul('missing', 'user-1')).rejects.toThrow(/Physical count.*not found/);
    });

    it('throws PhysicalCountCannotBeAnnulledException when APPLIED', async () => {
      (prisma.physicalCount.findUnique as jest.Mock).mockResolvedValue({
        id: 'pc-1',
        state: 'APPLIED',
        adjustmentDocuments: [],
      });

      await expect(service.annul('pc-1', 'user-1')).rejects.toThrow(/cannot be annulled/);
    });
  });
});
