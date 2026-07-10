// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { InvoiceTransmissionResultService } from './invoice-transmission-result.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const mockSyncInvoiceResult = {
  findFirst: jest.fn(),
  upsert: jest.fn(),
  findMany: jest.fn(),
};

const mockPrisma = {
  syncInvoiceResult: mockSyncInvoiceResult,
} as unknown as PrismaService;

describe('InvoiceTransmissionResultService', () => {
  let service: InvoiceTransmissionResultService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InvoiceTransmissionResultService(mockPrisma);
  });

  // ── saveResult ─────────────────────────────────────────────────────────

  describe('saveResult', () => {
    it('creates a new result when none exists for the invoiceId', async () => {
      mockSyncInvoiceResult.findFirst.mockResolvedValue(null);
      mockSyncInvoiceResult.upsert.mockResolvedValue({});

      const id = await service.saveResult({
        invoiceId: 'inv-1',
        workstationId: 'ws-1',
        status: 'AUTHORIZED',
        cufeOfficial: 'abc123',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(mockSyncInvoiceResult.upsert).toHaveBeenCalled();

      const upsertCall = mockSyncInvoiceResult.upsert.mock.calls[0][0];
      expect(upsertCall.create.invoiceId).toBe('inv-1');
      expect(upsertCall.create.status).toBe('AUTHORIZED');
      expect(upsertCall.create.cufeOfficial).toBe('abc123');
      expect(upsertCall.update.cufeOfficial).toBe('abc123');
    });

    it('updates an existing result when one already exists for the invoiceId', async () => {
      mockSyncInvoiceResult.findFirst.mockResolvedValue({ id: 'existing-id' });
      mockSyncInvoiceResult.upsert.mockResolvedValue({});

      const id = await service.saveResult({
        invoiceId: 'inv-1',
        workstationId: 'ws-1',
        status: 'REJECTED',
        rejectionReason: 'DUPLICATE',
      });

      expect(id).toBe('existing-id');
      expect(mockSyncInvoiceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-id' },
          create: expect.objectContaining({ status: 'REJECTED' }),
          update: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'DUPLICATE' }),
        }),
      );
    });

    it('stores null for optional fields when not provided', async () => {
      mockSyncInvoiceResult.findFirst.mockResolvedValue(null);
      mockSyncInvoiceResult.upsert.mockResolvedValue({});

      await service.saveResult({
        invoiceId: 'inv-2',
        workstationId: 'ws-1',
        status: 'AUTHORIZED',
      });

      const upsertCall = mockSyncInvoiceResult.upsert.mock.calls[0][0];
      expect(upsertCall.create.cufeOfficial).toBeNull();
      expect(upsertCall.create.dianXml).toBeNull();
      expect(upsertCall.create.rejectionReason).toBeNull();
      expect(upsertCall.create.authorizedAt).toBeNull();
    });

    it('stores AUTHORIZED with authorization timestamp', async () => {
      const authDate = new Date('2026-07-10T12:00:00Z');
      mockSyncInvoiceResult.findFirst.mockResolvedValue(null);
      mockSyncInvoiceResult.upsert.mockResolvedValue({});

      await service.saveResult({
        invoiceId: 'inv-3',
        workstationId: 'ws-1',
        status: 'AUTHORIZED',
        authorizedAt: authDate,
        dianXml: '<xml/>',
      });

      const upsertCall = mockSyncInvoiceResult.upsert.mock.calls[0][0];
      expect(upsertCall.create.authorizedAt).toEqual(authDate);
      expect(upsertCall.create.dianXml).toBe('<xml/>');
    });
  });

  // ── findResultsForWorkstation ──────────────────────────────────────────

  describe('findResultsForWorkstation', () => {
    const mockResults = [
      { id: 'r1', invoiceId: 'inv-1', status: 'AUTHORIZED' },
      { id: 'r2', invoiceId: 'inv-2', status: 'REJECTED' },
    ];

    it('returns results without date filter when since is omitted', async () => {
      mockSyncInvoiceResult.findMany.mockResolvedValue(mockResults);

      const results = await service.findResultsForWorkstation('ws-1');

      expect(results).toEqual(mockResults);
      expect(mockSyncInvoiceResult.findMany).toHaveBeenCalledWith({
        where: { workstationId: 'ws-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('filters by createdAt when since is provided', async () => {
      const since = new Date('2026-07-10T00:00:00Z');
      mockSyncInvoiceResult.findMany.mockResolvedValue([]);

      const results = await service.findResultsForWorkstation('ws-1', since);

      expect(results).toEqual([]);
      expect(mockSyncInvoiceResult.findMany).toHaveBeenCalledWith({
        where: { workstationId: 'ws-1', createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns empty array when no results exist for workstation', async () => {
      mockSyncInvoiceResult.findMany.mockResolvedValue([]);

      const results = await service.findResultsForWorkstation('unknown-ws');

      expect(results).toEqual([]);
    });
  });
});
