// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockDecimal {
    constructor(public value: string) {}
  }
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient, Prisma: { Decimal: MockDecimal } };
});

import { SyncOperationDispatcherService } from './sync-operation-dispatcher.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CashShiftService } from '@/modules/cash-shift/cash-shift.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { SalesService } from '@/modules/sales-pos/services/sales.service';
import { ClientReturnsService } from '@/modules/sales-pos/services/client-returns.service';
import { InventoryAdjustmentsService } from '@/modules/inventory-lots/services/inventory-adjustments.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

// These mocks are set up before instantiation since the constructor uses them
const mockSalesService = {
  create: jest.fn(),
  confirm: jest.fn(),
} as unknown as SalesService;

const mockCashShiftService = {
  registerCashCount: jest.fn(),
  closeShift: jest.fn(),
} as unknown as CashShiftService;

const mockClientsService = {
  create: jest.fn(),
} as unknown as ClientsService;

const mockClientReturnsService = {
  create: jest.fn(),
} as unknown as ClientReturnsService;

const mockInventoryAdjustmentsService = {
  create: jest.fn(),
} as unknown as InventoryAdjustmentsService;

const mockFiscalDocumentsService = {
  createPendingDocumentForContingency: jest.fn(),
  enqueueGenerationJob: jest.fn(),
} as unknown as FiscalDocumentsService;

const mockSyncOperationOutcome = {
  create: jest.fn(),
};

const mockPrisma = {
  syncOperationOutcome: mockSyncOperationOutcome,
  $transaction: jest.fn(),
} as unknown as PrismaService;

/** Build a minimal SyncQueue entry with sensible defaults. */
function buildEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    operationUuid: 'uuid-1',
    operationType: 'SALE_CONFIRMATION',
    sourceWorkstationId: 'ws-1',
    status: 'PENDING',
    payload: JSON.stringify({}),
    ...overrides,
  } as any;
}

/** Valid UUID v4 for invoice transmission tests. */
const UUID = '00000000-0000-4000-8000-000000000001';
/** Valid 64-char hex string (simulates SHA-384). */
const CUFE = 'a'.repeat(64);
/** Minimal FullInvoiceData that passes the Zod schema. */
const MINIMAL_FULL_INVOICE_DATA = {
  invoiceType: 'ELECTRONIC_INVOICE',
  invoiceNumber: 'F001-1',
  seller: { nit: '123', name: 'Seller' },
  buyer: {},
  lineItems: [
    {
      internalCode: 'P001',
      commercialName: 'Product',
      quantity: 1,
      unitPrice: '100000',
      taxRate: '19',
      taxAmount: '19000',
      subtotal: '100000',
      total: '119000',
    },
  ],
  taxSummaries: [
    { scheme: 'IVA', rate: '19', taxableAmount: '100000', taxAmount: '19000' },
  ],
  payments: [{ paymentMethodName: 'Cash', amount: '119000' }],
  subtotal: '100000',
  totalDiscount: '0',
  totalTax: '19000',
  totalAmount: '119000',
  changeAmount: '0',
  issuedAt: '2026-07-09T10:00:00.000Z',
  currency: 'COP',
};

describe('SyncOperationDispatcherService', () => {
  let service: SyncOperationDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SyncOperationDispatcherService(
      mockPrisma,
      mockCashShiftService,
      mockClientsService,
      mockSalesService,
      mockClientReturnsService,
      mockInventoryAdjustmentsService,
      mockFiscalDocumentsService,
    );
  });

  // ── dispatch: outcome recording ───────────────────────────────────────

  describe('dispatch', () => {
    it('records ACCEPTED outcome after a successful handler', async () => {
      mockSalesService.create.mockResolvedValue({ id: 'sale-1' });
      mockSalesService.confirm.mockResolvedValue(undefined);
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(
        buildEntry({
          operationType: 'SALE_CONFIRMATION',
          payload: JSON.stringify({ userId: 'u-1', createSaleDto: {}, confirmSaleDto: {} }),
        }),
      );

      expect(mockSyncOperationOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          operationUuid: 'uuid-1',
          workstationId: 'ws-1',
          outcome: 'ACCEPTED',
          failureCategory: null,
        }),
      });
    });

    it('records REJECTED outcome when the handler throws and re-throws', async () => {
      mockSalesService.create.mockRejectedValue(new Error('validation failed'));
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await expect(
        service.dispatch(
          buildEntry({
            operationType: 'SALE_CONFIRMATION',
            payload: JSON.stringify({ userId: 'u-1', createSaleDto: {}, confirmSaleDto: {} }),
          }),
        ),
      ).rejects.toThrow('validation failed');

      expect(mockSyncOperationOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'REJECTED',
          failureCategory: 'VALIDATION',
        }),
      });
    });

    it('does not throw when recordOutcome insert fails (best-effort)', async () => {
      mockSalesService.create.mockResolvedValue({ id: 's-1' });
      mockSalesService.confirm.mockResolvedValue(undefined);
      mockSyncOperationOutcome.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.dispatch(
          buildEntry({
            operationType: 'SALE_CONFIRMATION',
            payload: JSON.stringify({ userId: 'u-1', createSaleDto: {}, confirmSaleDto: {} }),
          }),
        ),
      ).resolves.not.toThrow();
    });
  });

  // ── SALE_CONFIRMATION ─────────────────────────────────────────────────

  describe('SALE_CONFIRMATION', () => {
    const salePayload = JSON.stringify({
      userId: 'u-1',
      workstationId: 'ws-1',
      createSaleDto: { items: [{ productId: 'p1', quantity: 2 }] },
      confirmSaleDto: { paymentMethodId: 'pm-1' },
    });

    it('calls salesService.create and salesService.confirm', async () => {
      mockSalesService.create.mockResolvedValue({ id: 'sale-1' });
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'SALE_CONFIRMATION',
        payload: salePayload,
      }));

      expect(mockSalesService.create).toHaveBeenCalledTimes(1);
      expect(mockSalesService.confirm).toHaveBeenCalledWith(
        'sale-1',
        expect.objectContaining({ paymentMethodId: 'pm-1' }),
        'u-1',
      );
    });
  });

  // ── SHIFT_CLOSURE ─────────────────────────────────────────────────────

  describe('SHIFT_CLOSURE', () => {
    const shiftPayload = JSON.stringify({
      userId: 'u-1',
      shiftId: 'shift-1',
      cashCounts: [
        {
          countType: 'MANUAL',
          paymentMethodId: 'pm-1',
          expectedAmount: '50000',
          declaredAmount: '52000',
        },
      ],
      closingNotes: 'end of day',
    });

    it('calls registerCashCount for each count then closeShift', async () => {
      mockCashShiftService.registerCashCount.mockResolvedValue(undefined);
      mockCashShiftService.closeShift.mockResolvedValue(undefined);
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'SHIFT_CLOSURE',
        payload: shiftPayload,
      }));

      expect(mockCashShiftService.registerCashCount).toHaveBeenCalledTimes(1);
      expect(mockCashShiftService.registerCashCount).toHaveBeenCalledWith(
        'shift-1', 'u-1',
        expect.objectContaining({ countType: 'MANUAL' }),
      );
      expect(mockCashShiftService.closeShift).toHaveBeenCalledWith(
        'shift-1', 'u-1',
        { closingNotes: 'end of day' },
      );
    });

    it('handles closure with zero cash counts', async () => {
      mockCashShiftService.closeShift.mockResolvedValue(undefined);
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'SHIFT_CLOSURE',
        payload: JSON.stringify({ userId: 'u-1', shiftId: 'shift-1' }),
      }));

      expect(mockCashShiftService.registerCashCount).not.toHaveBeenCalled();
      expect(mockCashShiftService.closeShift).toHaveBeenCalledTimes(1);
    });
  });

  // ── CLIENT_CREATION ───────────────────────────────────────────────────

  describe('CLIENT_CREATION', () => {
    const clientPayload = JSON.stringify({
      userId: 'u-1',
      createClientDto: { identificationType: 'CC', identificationNumber: '123' },
      localClientId: 'local-client-uuid',
    });

    it('calls clientsService.create with localClientId', async () => {
      mockClientsService.create.mockResolvedValue({ id: 'client-1' });
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'CLIENT_CREATION',
        payload: clientPayload,
      }));

      expect(mockClientsService.create).toHaveBeenCalledWith(
        { identificationType: 'CC', identificationNumber: '123' },
        'u-1',
        'local-client-uuid',
      );
    });
  });

  // ── CLIENT_RETURN ─────────────────────────────────────────────────────

  describe('CLIENT_RETURN', () => {
    const returnPayload = JSON.stringify({
      createdById: 'u-1',
      workstationId: 'ws-1',
      saleId: 'sale-1',
      refundMethodId: 'rm-1',
      reason: 'Damaged',
      items: [
        {
          saleItemId: 'si-1',
          quantity: 1,
          lots: [{ lotId: 'lot-1', quantity: 1 }],
        },
      ],
      metadata: { localReturnId: 'local-ret-uuid' },
    });

    it('calls clientReturnsService.create with mapped DTO', async () => {
      mockClientReturnsService.create.mockResolvedValue({ id: 'return-1' });
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'CLIENT_RETURN',
        payload: returnPayload,
      }));

      expect(mockClientReturnsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          saleId: 'sale-1',
          refundMethodId: 'rm-1',
          reason: 'Damaged',
        }),
        'u-1',
        'ws-1',
      );
    });
  });

  // ── INVENTORY_ADJUSTMENT ──────────────────────────────────────────────

  describe('INVENTORY_ADJUSTMENT', () => {
    const adjPayload = JSON.stringify({
      userId: 'u-1',
      createAdjustmentDto: { productId: 'p1', quantity: 10, reason: 'Count correction' },
    });

    it('calls inventoryAdjustmentsService.create', async () => {
      mockInventoryAdjustmentsService.create.mockResolvedValue({ id: 'adj-1' });
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'INVENTORY_ADJUSTMENT',
        payload: adjPayload,
      }));

      expect(mockInventoryAdjustmentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'p1' }),
        'u-1',
      );
    });
  });

  // ── PRESCRIPTION_REGISTRATION ────────────────────────────────────────

  describe('PRESCRIPTION_REGISTRATION', () => {
    it('logs and records ACCEPTED without calling any service', async () => {
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'PRESCRIPTION_REGISTRATION',
        payload: JSON.stringify({
          saleItemId: 'si-1',
          prescriptionId: 'rx-1',
          isControlledSubstance: true,
        }),
      }));

      expect(mockSyncOperationOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ outcome: 'ACCEPTED' }),
      });
    });
  });

  // ── INVOICE_TRANSMISSION ──────────────────────────────────────────────

  describe('INVOICE_TRANSMISSION', () => {
    const validInvoicePayload = JSON.stringify({
      invoiceId: UUID,
      invoiceNumber: 'F001-1',
      saleId: UUID,
      provisionalCufe: CUFE,
      workstationId: 'ws-1',
      fullInvoiceData: MINIMAL_FULL_INVOICE_DATA,
    });

    it('creates a CONTINGENCY fiscal document and enqueues generation job', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => cb(mockPrisma));
      mockFiscalDocumentsService.createPendingDocumentForContingency
        .mockResolvedValue({ id: 'fd-1' });
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await service.dispatch(buildEntry({
        operationType: 'INVOICE_TRANSMISSION',
        payload: validInvoicePayload,
      }));

      expect(mockFiscalDocumentsService.createPendingDocumentForContingency)
        .toHaveBeenCalledWith({
          saleId: UUID,
          workstationId: 'ws-1',
          provisionalCufe: CUFE,
          tx: mockPrisma,
        });
      expect(mockFiscalDocumentsService.enqueueGenerationJob)
        .toHaveBeenCalledWith('fd-1');
    });

    it('throws VALIDATION error when payload fails Zod schema', async () => {
      const badPayload = JSON.stringify({ saleId: UUID }); // missing required fields

      mockSyncOperationOutcome.create.mockResolvedValue({});

      await expect(
        service.dispatch(buildEntry({
          operationType: 'INVOICE_TRANSMISSION',
          payload: badPayload,
        })),
      ).rejects.toThrow(/INVOICE_TRANSMISSION validation failed/);

      expect(mockFiscalDocumentsService.createPendingDocumentForContingency)
        .not.toHaveBeenCalled();
    });
  });

  // ── classifyServerError ───────────────────────────────────────────────

  describe('classifyServerError (via dispatch)', () => {
    it.each([
      ['validation error', 'VALIDATION'],
      ['schema mismatch', 'VALIDATION'],
      ['malformed request', 'VALIDATION'],
      ['conflict detected', 'CONFLICT'],
      ['data mismatch', 'CONFLICT'],
      ['already exists', 'CONFLICT'],
      ['unauthorized', 'AUTH'],
      ['authentication required', 'AUTH'],
      ['forbidden', 'AUTH'],
      ['prescription expired', 'BUSINESS_RULE'],
      ['shift is closed', 'BUSINESS_RULE'],
      ['not allowed in current state', 'BUSINESS_RULE'],
      ['insufficient stock', 'BUSINESS_RULE'],
      ['business rule violation', 'BUSINESS_RULE'],
      ['unknown database error', 'UNKNOWN'],
      ['', 'UNKNOWN'],
    ])('maps error message "%s" to category "%s"', async (msg, category) => {
      mockSalesService.create.mockRejectedValue(new Error(msg));
      mockSyncOperationOutcome.create.mockResolvedValue({});

      await expect(
        service.dispatch(buildEntry({
          operationType: 'SALE_CONFIRMATION',
          payload: JSON.stringify({ userId: 'u-1', createSaleDto: {}, confirmSaleDto: {} }),
        })),
      ).rejects.toThrow(msg);

      expect(mockSyncOperationOutcome.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          outcome: 'REJECTED',
          failureCategory: category,
        }),
      });
    });
  });
});
