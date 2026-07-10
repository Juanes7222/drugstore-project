// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  AdjustmentState: { DRAFT: 'DRAFT', PENDING_APPROVAL: 'PENDING_APPROVAL', APPROVED: 'APPROVED', REJECTED: 'REJECTED', APPLIED: 'APPLIED', ANNULLED: 'ANNULLED' },
  MovementType: { POSITIVE_ADJUSTMENT: 'POSITIVE_ADJUSTMENT', NEGATIVE_ADJUSTMENT: 'NEGATIVE_ADJUSTMENT' },
  LotState: { ACTIVE: 'ACTIVE', EXHAUSTED: 'EXHAUSTED' },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { AdjustmentNotFoundException } from '../exceptions/adjustment-not-found.exception';
import { AdjustmentNotDraftException } from '../exceptions/adjustment-not-draft.exception';
import { AdjustmentNotPendingApprovalException } from '../exceptions/adjustment-not-pending-approval.exception';
import { AdjustmentNotApprovedException } from '../exceptions/adjustment-not-approved.exception';
import { AdjustmentNotAnnullableException } from '../exceptions/adjustment-not-annullable.exception';
import { InsufficientStockForAdjustmentException } from '../exceptions/insufficient-stock-for-adjustment.exception';
import { StaleAdjustmentException } from '../exceptions/stale-adjustment.exception';
import { LotNotFoundException } from '../exceptions/lot-not-found.exception';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('InventoryAdjustmentsService', () => {
  let service: InventoryAdjustmentsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new InventoryAdjustmentsService(prisma as any);
  });

  // ── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated adjustments with total count', async () => {
      const mockData = [{ id: 'adj-1', reason: 'Test' }];
      (prisma.$transaction as jest.Mock).mockImplementation(async (promises: any) => Promise.all(promises));
      (prisma.inventoryAdjustmentDocument.findMany as jest.Mock).mockResolvedValue(mockData);
      (prisma.inventoryAdjustmentDocument.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockData, total: 1, page: 1, pageSize: 20 });
    });

    it('filters by state when provided', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (promises: any) => Promise.all(promises));
      (prisma.inventoryAdjustmentDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryAdjustmentDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, state: 'DRAFT' });

      expect(prisma.inventoryAdjustmentDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { state: 'DRAFT' } }),
      );
    });

    it('filters by date range when provided', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (promises: any) => Promise.all(promises));
      (prisma.inventoryAdjustmentDocument.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryAdjustmentDocument.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, createdAtFrom: '2026-01-01', createdAtTo: '2026-01-31' });

      const callWhere = (prisma.inventoryAdjustmentDocument.findMany as jest.Mock).mock.calls[0][0].where;
      expect(callWhere.createdAt).toBeDefined();
      expect(callWhere.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the adjustment with its movements when found', async () => {
      const mockDoc = { id: 'adj-1', reason: 'Test' };
      const mockMovements = [{ id: 'mov-1', lotId: UUID, movementType: 'POSITIVE_ADJUSTMENT' }];
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue(mockDoc);
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue(mockMovements);

      const result = await service.findById('adj-1');

      expect(result).toEqual({ ...mockDoc, movements: mockMovements });
    });

    it('throws AdjustmentNotFoundException when not found', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(/Adjustment.*not found/);
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    function createTxMock() {
      return {
        lot: { findUnique: jest.fn() },
        inventoryAdjustmentDocument: { create: jest.fn(), findFirst: jest.fn() },
        inventoryMovement: { create: jest.fn() },
      };
    }

    it('creates adjustment document with items in transaction', async () => {
      const txMock = createTxMock();
      const dto = {
        reason: 'Stock correction',
        items: [
          { lotId: UUID, movementType: 'POSITIVE_ADJUSTMENT' as const, quantity: 10 },
        ],
      };
      txMock.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 50 });
      txMock.inventoryAdjustmentDocument.findFirst.mockResolvedValue(null);
      txMock.inventoryAdjustmentDocument.create.mockResolvedValue({ id: 'new-adj', reason: 'Stock correction' });
      txMock.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => cb(txMock));

      const result = await service.create(dto, 'user-1');

      expect(result.id).toBe('new-adj');
      expect(txMock.inventoryMovement.create).toHaveBeenCalled();
    });

    it('throws LotNotFoundException when lot does not exist', async () => {
      const txMock = createTxMock();
      const dto = {
        reason: 'Test',
        items: [{ lotId: 'bad-lot', movementType: 'POSITIVE_ADJUSTMENT' as const, quantity: 5 }],
      };
      txMock.lot.findUnique.mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => cb(txMock));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(/Lot.*not found/);
    });

    it('throws InsufficientStockForAdjustmentException when negative adjustment exceeds stock', async () => {
      const txMock = createTxMock();
      const dto = {
        reason: 'Test',
        items: [{ lotId: UUID, movementType: 'NEGATIVE_ADJUSTMENT' as const, quantity: 100 }],
      };
      txMock.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 10 }); // only 10 in stock
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => cb(txMock));

      await expect(service.create(dto, 'user-1')).rejects.toThrow(/Insufficient stock/);
    });

    it('throws Error when items array is empty', async () => {
      await expect(service.create({ reason: 'Test', items: [] }, 'user-1')).rejects.toThrow(
        'At least one item is required',
      );
    });

    it('creates with physicalCountId when provided', async () => {
      const txMock = createTxMock();
      const dto = {
        reason: 'Physical count adjustment',
        items: [{ lotId: UUID, movementType: 'POSITIVE_ADJUSTMENT' as const, quantity: 5 }],
      };
      txMock.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 20 });
      txMock.inventoryAdjustmentDocument.findFirst.mockResolvedValue(null);
      txMock.inventoryAdjustmentDocument.create.mockResolvedValue({ id: 'new-adj' });
      txMock.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => cb(txMock));

      const result = await service.create(dto, 'user-1', 'pc-1');

      expect(txMock.inventoryAdjustmentDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ physicalCountId: 'pc-1' }) }),
      );
    });
  });

  // ── submit ───────────────────────────────────────────────────────────

  describe('submit', () => {
    it('transitions DRAFT to PENDING_APPROVAL', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'DRAFT' });
      const updated = { id: 'adj-1', state: 'PENDING_APPROVAL' };
      (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.submit('adj-1', 'user-1');

      expect(result.state).toBe('PENDING_APPROVAL');
    });

    it('throws AdjustmentNotFoundException when not found', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.submit('missing', 'user-1')).rejects.toThrow(/Adjustment.*not found/);
    });

    it('throws AdjustmentNotDraftException when not in DRAFT', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPROVED' });

      await expect(service.submit('adj-1', 'user-1')).rejects.toThrow(/not in DRAFT/);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────

  describe('approve', () => {
    it('transitions PENDING_APPROVAL to APPROVED', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'PENDING_APPROVAL' });
      (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPROVED' });

      const result = await service.approve('adj-1', 'user-1', { approvalNotes: 'Approved' });

      expect(result.state).toBe('APPROVED');
    });

    it('throws AdjustmentNotFoundException when not found', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.approve('missing', 'user-1', { approvalNotes: '' })).rejects.toThrow(/Adjustment.*not found/);
    });

    it('throws AdjustmentNotPendingApprovalException when not PENDING_APPROVAL', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'DRAFT' });

      await expect(service.approve('adj-1', 'user-1', { approvalNotes: '' })).rejects.toThrow(/not in PENDING_APPROVAL/);
    });
  });

  // ── reject ───────────────────────────────────────────────────────────

  describe('reject', () => {
    it('transitions PENDING_APPROVAL to REJECTED', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'PENDING_APPROVAL' });
      (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'REJECTED' });

      const result = await service.reject('adj-1', 'user-1', { rejectionReason: 'Invalid' });

      expect(result.state).toBe('REJECTED');
    });

    it('throws AdjustmentNotPendingApprovalException when not PENDING_APPROVAL', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPROVED' });

      await expect(service.reject('adj-1', 'user-1', { rejectionReason: 'No' })).rejects.toThrow(/not in PENDING_APPROVAL/);
    });
  });

  // ── apply ────────────────────────────────────────────────────────────

  describe('apply', () => {
    beforeEach(() => {
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: Function) => cb(prisma));
    });

    it('transitions APPROVED to APPLIED and updates stock', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'adj-1', state: 'APPROVED' })   // first call (apply)
        .mockResolvedValueOnce({ id: 'adj-1', state: 'APPROVED' });  // second call (verifyAndLoadLots — same doc)
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([
        { lotId: UUID, previousStock: 50, movementType: 'POSITIVE_ADJUSTMENT', quantity: 10 },
      ]);
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ id: UUID, currentStock: 50, version: 1, state: 'ACTIVE' });
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPLIED' });

      const result = await service.apply('adj-1', 'user-1');

      expect(result.state).toBe('APPLIED');
      expect(prisma.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: UUID, version: 1 },
          data: expect.objectContaining({ currentStock: 60 }),
        }),
      );
    });

    it('throws ConcurrentStockModificationException when version mismatch', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'adj-1', state: 'APPROVED' })
        .mockResolvedValueOnce({ id: 'adj-1', state: 'APPROVED' });
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([
        { lotId: UUID, previousStock: 50, movementType: 'POSITIVE_ADJUSTMENT', quantity: 10 },
      ]);
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ id: UUID, currentStock: 50, version: 1, state: 'ACTIVE' });
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // no rows updated

      await expect(service.apply('adj-1', 'user-1')).rejects.toThrow(/Concurrent modification/);
    });

    it('throws AdjustmentNotFoundException when not found', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.apply('missing', 'user-1')).rejects.toThrow(/Adjustment.*not found/);
    });

    it('throws AdjustmentNotApprovedException when not APPROVED', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'DRAFT' });

      await expect(service.apply('adj-1', 'user-1')).rejects.toThrow(/not in APPROVED/);
    });
  });

  // ── annul ────────────────────────────────────────────────────────────

  describe('annul', () => {
    it('annuls a non-APPLIED adjustment', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'DRAFT' });
      (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'ANNULLED' });

      const result = await service.annul('adj-1', 'user-1', { annulmentReason: 'Cancelled' });

      expect(result.state).toBe('ANNULLED');
    });

    it('throws AdjustmentNotAnnullableException when state is APPLIED', async () => {
      (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPLIED' });

      await expect(service.annul('adj-1', 'user-1', { annulmentReason: 'Oops' })).rejects.toThrow(/cannot be annulled/);
    });
  });
});
