// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { SyncController } from './sync.controller';
import { SyncService } from '../services/sync.service';
import { SyncHealthService } from '../services/sync-health.service';
import { InvoiceTransmissionResultService } from '../services/invoice-transmission-result.service';
import { LocalNumberHintQuerySchema } from '../dto/local-number-hint-query.dto';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { SyncBatchSchema, SyncOperationSchema } from '../dto/sync-operation.schema';

const mockSyncService = {
  receiveBatch: jest.fn(),
  getStatus: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  retry: jest.fn(),
  getMaxClientSequence: jest.fn(),
};

const mockSyncHealthService = {
  getHealth: jest.fn(),
};

const mockInvoiceTransmissionResultService = {
  saveResult: jest.fn(),
  findResultsForWorkstation: jest.fn(),
};

function mockUser(overrides = {}) {
  return { id: 'u1', lastLoginWorkstationId: 'ws-1', role: 'ADMIN', ...overrides };
}

describe('SyncController', () => {
  let controller: SyncController;
  let service: jest.Mocked<typeof mockSyncService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: SyncService, useValue: mockSyncService },
        { provide: SyncHealthService, useValue: mockSyncHealthService },
        { provide: InvoiceTransmissionResultService, useValue: mockInvoiceTransmissionResultService },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
    service = module.get(SyncService) as jest.Mocked<typeof mockSyncService>;
  });

  // ── POST /sync/batch ─────────────────────────────────────────────────

  describe('POST /sync/batch', () => {
    it('receives a batch and returns the result', async () => {
      const operations: any[] = [];
      const result = { queued: 0, errors: [] };
      service.receiveBatch.mockResolvedValue(result);

      const response = await controller.receiveBatch(operations, mockUser());

      expect(response).toEqual(result);
      expect(service.receiveBatch).toHaveBeenCalledWith(
        expect.any(SyncBatchDto),
        'ws-1',
      );
    });

    it('uses empty string as fallback workstationId when not set on user', async () => {
      service.receiveBatch.mockResolvedValue({ queued: 0, errors: [] });

      await controller.receiveBatch([], mockUser({ lastLoginWorkstationId: undefined }));

      expect(service.receiveBatch).toHaveBeenCalledWith(expect.any(Object), '');
    });
  });

  // ── GET /sync/status ─────────────────────────────────────────────────

  describe('GET /sync/status', () => {
    it('returns sync status for the user workstation', async () => {
      const status = { pending: 5, inProgress: 2 };
      service.getStatus.mockResolvedValue(status);

      const result = await controller.getStatus(mockUser());

      expect(result).toEqual(status);
      expect(service.getStatus).toHaveBeenCalledWith('ws-1');
    });
  });

  // ── GET /sync/queue ──────────────────────────────────────────────────

  describe('GET /sync/queue', () => {
    it('returns paginated queue entries', async () => {
      const queueData = { data: [], total: 0, page: 1, pageSize: 20 };
      service.findAll.mockResolvedValue(queueData);

      const result = await controller.findAllQueue({ page: 1, pageSize: 20 });

      expect(result).toEqual(queueData);
      expect(service.findAll).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    });
  });

  // ── GET /sync/queue/:id ──────────────────────────────────────────────

  describe('GET /sync/queue/:id', () => {
    it('returns a single queue entry by id', async () => {
      const entry = { id: 'q-1', status: 'PENDING' };
      service.findOne.mockResolvedValue(entry);

      const result = await controller.findQueueById('q-1');

      expect(result).toEqual(entry);
      expect(service.findOne).toHaveBeenCalledWith('q-1');
    });
  });

  // ── POST /sync/queue/:id/retry ───────────────────────────────────────

  describe('POST /sync/queue/:id/retry', () => {
    it('retries a queue entry', async () => {
      const entry = { id: 'q-1', status: 'QUEUED' };
      service.retry.mockResolvedValue(entry);

      const result = await controller.retryQueueEntry('q-1');

      expect(result).toEqual(entry);
      expect(service.retry).toHaveBeenCalledWith('q-1');
    });
  });

  // ── GET /sync/health ─────────────────────────────────────────────────

  describe('GET /sync/health', () => {
    it('returns sync health', async () => {
      const health = { status: 'healthy' };
      mockSyncHealthService.getHealth.mockResolvedValue(health);

      const result = await controller.getHealth();

      expect(result).toEqual(health);
      expect(mockSyncHealthService.getHealth).toHaveBeenCalledWith(24);
    });
  });

  // ── GET /sync/local-number-hint ──────────────────────────────────────

  describe('GET /sync/local-number-hint', () => {
    it('returns the max local number for a workstation', async () => {
      service.getMaxClientSequence.mockResolvedValue(128);

      const result = await controller.getLocalNumberHint({
        workstationId: 'ws-1',
      });

      expect(result).toEqual({
        workstationId: 'ws-1',
        maxLocalNumber: 128,
      });
      expect(service.getMaxClientSequence).toHaveBeenCalledWith('ws-1');
    });

    it('returns null when the workstation has no queued operations', async () => {
      service.getMaxClientSequence.mockResolvedValue(null);

      const result = await controller.getLocalNumberHint({
        workstationId: 'ws-empty',
      });

      expect(result).toEqual({
        workstationId: 'ws-empty',
        maxLocalNumber: null,
      });
    });

    it('rejects an empty workstation id via the query schema', () => {
      const result = LocalNumberHintQuerySchema.safeParse({ workstationId: '' });

      expect(result.success).toBe(false);
      expect(service.getMaxClientSequence).not.toHaveBeenCalled();
    });
  });

  // ── GET /sync/invoice-results ────────────────────────────────────────

  describe('GET /sync/invoice-results', () => {
    it('returns invoice results for a workstation', async () => {
      const results = [{ id: 'r-1', invoiceId: 'inv-1', workstationId: 'ws-1', status: 'ACCEPTED' }];
      mockInvoiceTransmissionResultService.findResultsForWorkstation.mockResolvedValue(results);

      const result = await controller.getInvoiceResults({ workstationId: 'ws-1' });

      expect(result).toEqual(results);
      expect(mockInvoiceTransmissionResultService.findResultsForWorkstation)
        .toHaveBeenCalledWith('ws-1', expect.any(Date));
    });

    it('passes since parameter when provided', async () => {
      mockInvoiceTransmissionResultService.findResultsForWorkstation.mockResolvedValue([]);

      await controller.getInvoiceResults({ workstationId: 'ws-1', since: '2026-01-15T00:00:00Z' });

      expect(mockInvoiceTransmissionResultService.findResultsForWorkstation)
        .toHaveBeenCalledWith('ws-1', expect.any(Date));
    });
  });

  // ── Zod schema validation for SyncBatchSchema ─────────────────────────

  describe('SyncBatchSchema validation', () => {
    function validOperation(overrides = {}) {
      return {
        operationUuid: '550e8400-e29b-41d4-a716-446655440000',
        operationType: 'SALE_CONFIRMATION',
        payload: { amount: 100 },
        payloadHash: '4d4bbe59c6aad22442cde199a6a8a5f034405fcd78fb5a81c24ef249de1c45f1',
        sourceCreatedAt: '2024-01-01T00:00:00Z',
        clientSequence: 1,
        ...overrides,
      };
    }

    it('SYNCBATCH-001: accepts a plain array of operations (no wrapper object)', () => {
      const result = SyncBatchSchema.safeParse([validOperation()]);
      expect(result.success).toBe(true);
    });

    it('SYNCBATCH-002: rejects { operations: [...] } wrapper object', () => {
      const result = SyncBatchSchema.safeParse({ operations: [validOperation()] });
      expect(result.success).toBe(false);
    });

    it('SYNCBATCH-003: rejects empty array', () => {
      const result = SyncBatchSchema.safeParse([]);
      expect(result.success).toBe(false);
    });

    it('SYNCBATCH-004: rejects unknown operationType', () => {
      const result = SyncOperationSchema.safeParse(validOperation({ operationType: 'UNKNOWN_TYPE' }));
      expect(result.success).toBe(false);
    });

    it('SYNCBATCH-005: rejects missing required fields', () => {
      const result = SyncOperationSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('SYNCBATCH-006: rejects invalid UUID format', () => {
      const result = SyncOperationSchema.safeParse(validOperation({ operationUuid: 'not-a-uuid' }));
      expect(result.success).toBe(false);
    });
  });

  // ── New operation type validation ─────────────────────────────────

  describe('new operation types in SyncBatchSchema', () => {
    function buildOp(operationType: string) {
      return {
        operationUuid: '550e8400-e29b-41d4-a716-446655440000',
        operationType,
        payload: {},
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sourceCreatedAt: '2024-01-01T00:00:00Z',
        clientSequence: 1,
      };
    }

    it('NEWTYPE-001: accepts INVOICE_TRANSMISSION_RESULT', () => {
      const result = SyncOperationSchema.safeParse(buildOp('INVOICE_TRANSMISSION_RESULT'));
      expect(result.success).toBe(true);
    });

    it('NEWTYPE-002: accepts PRODUCT_CREATION', () => {
      const result = SyncOperationSchema.safeParse(buildOp('PRODUCT_CREATION'));
      expect(result.success).toBe(true);
    });

    it('NEWTYPE-003: accepts PRODUCT_UPDATE', () => {
      const result = SyncOperationSchema.safeParse(buildOp('PRODUCT_UPDATE'));
      expect(result.success).toBe(true);
    });

    it('NEWTYPE-004: all new operation types are accepted via SyncBatchSchema array', () => {
      const ops = [
        buildOp('INVOICE_TRANSMISSION_RESULT'),
        buildOp('PRODUCT_CREATION'),
        buildOp('PRODUCT_UPDATE'),
      ];
      const result = SyncBatchSchema.safeParse(ops);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
      }
    });

    it('NEWTYPE-005: original existing operation types still accepted', () => {
      const existingTypes = [
        'SALE_CONFIRMATION',
        'SHIFT_CLOSURE',
        'CLIENT_CREATION',
        'CLIENT_RETURN',
        'INVENTORY_ADJUSTMENT',
        'FISCAL_DOCUMENT_SYNC',
        'PRESCRIPTION_REGISTRATION',
        'RESOLUTION_ALLOCATION',
        'INVOICE_TRANSMISSION',
      ];
      for (const t of existingTypes) {
        const result = SyncOperationSchema.safeParse(buildOp(t));
        expect(result.success).toBe(true);
      }
    });
  });
});
