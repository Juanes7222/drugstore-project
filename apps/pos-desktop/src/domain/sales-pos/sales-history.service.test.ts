/**
 * Unit tests for SalesHistoryService.
 *
 * Uses a mocked PrismaClient and LocalAdjustmentService so the tests focus on
 * projection logic, filtering, and the CLIENT_CHANGE operational override.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient, SaleOperationalState } from '@pharmacy/database/local';
import {
  createSalesHistoryService,
  type SaleHistoryFilters,
  type SaleHistoryListItem,
  type SaleHistoryDetail,
} from './sales-history.service';
import type { LocalAdjustmentService } from './local-adjustment.service';
import type {
  OperationalInvoiceView,
  AdjustmentHistoryEntry,
} from './local-adjustment.types';
import type { InvoiceModel } from './fiscal-types';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const createSaleListItem = (
  overrides: Partial<SaleHistoryListItem> = {},
): SaleHistoryListItem => ({
  saleId: 'sale-1',
  localNumber: '100',
  confirmedAt: '2026-07-20T10:00:00.000Z',
  totalAmount: '119.00',
  clientName: 'Juan Pérez',
  clientIdentificationNumber: '123456',
  invoiceId: 'inv-1',
  invoiceNumber: 'FE0001',
  invoiceStatus: 'TRANSMITTED_AUTHORIZED',
  invoiceType: 'ELECTRONIC_INVOICE',
  hasAdjustments: false,
  ...overrides,
});

const createSaleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1',
  localNumber: 100n,
  operationalState: 'CONFIRMED',
  startedAt: new Date('2026-07-20T09:55:00Z'),
  confirmedAt: new Date('2026-07-20T10:00:00Z'),
  clientId: 'client-1',
  clientNameSnapshot: 'Juan Pérez',
  clientIdentificationTypeSnapshot: 'CC',
  clientIdentificationNumberSnapshot: '123456',
  subtotal: '100.00',
  totalDiscount: '0.00',
  totalTax: '19.00',
  totalAmount: '119.00',
  changeAmount: '0.00',
  cashShiftId: 'cs-1',
  workstationId: 'ws-1',
  userId: 'user-1',
  sourceWorkstationId: 'ws-1',
  items: [],
  payments: [
    {
      id: 'pay-1',
      paymentMethodId: 'pm-cash',
      paymentMethod: { name: 'Efectivo' },
      amount: '119.00',
      transactionReference: null,
      authorizationCode: null,
      cardBrand: null,
      cardLastFour: null,
    },
  ],
  ...overrides,
});

const createInvoiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  saleId: 'sale-1',
  workstationId: 'ws-1',
  invoiceType: 'ELECTRONIC_INVOICE',
  invoiceNumber: 'FE0001',
  contingencyNumber: null,
  status: 'TRANSMITTED_AUTHORIZED',
  cufeProvisional: 'cufe-1',
  cufeOfficial: null,
  issuedAt: new Date('2026-07-20T10:00:00Z'),
  transmittedAt: new Date('2026-07-20T10:05:00Z'),
  expiresAt: new Date('2026-08-20T10:00:00Z'),
  fiscalXml: null,
  fiscalPdfPath: null,
  relatedInvoiceId: null,
  contingencyEventId: null,
  techKeySnapshot: 'tech-1',
  fullData: {
    buyer: {
      name: 'Juan Pérez',
      identificationType: 'CC',
      identificationNumber: '123456',
      email: null,
      phone: null,
      address: null,
    },
    seller: {
      nit: '123456789',
      name: 'Droguería Prueba',
      address: null,
      phone: null,
      resolutionNumber: null,
      resolutionDate: null,
      resolutionPrefix: 'FE',
    },
    lineItems: [],
    taxSummaries: [],
    payments: [],
    subtotal: '100.00',
    totalDiscount: '0.00',
    totalTax: '19.00',
    totalAmount: '119.00',
    changeAmount: '0.00',
    issuedAt: '2026-07-20T10:00:00.000Z',
    currency: 'COP',
    prescriptionNumber: null,
    workstationCode: 'WS-01',
    contingencyNumber: null,
    relatedInvoiceNumber: null,
    invoiceType: 'ELECTRONIC_INVOICE',
    invoiceNumber: 'FE0001',
  },
  ...overrides,
});

const createSaleItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'si-1',
  saleId: 'sale-1',
  productId: 'prod-1',
  productInternalCodeSnapshot: 'P001',
  productCommercialNameSnapshot: 'Ibuprofeno 400mg',
  productGenericNameSnapshot: 'Ibuprofeno',
  productConcentrationSnapshot: '400mg',
  quantity: 1,
  unitPrice: '100.00',
  unitCost: '50.00',
  taxRate: '0.19',
  taxAmount: '19.00',
  discountPercentage: '0.00',
  discountAmount: '0.00',
  discountReason: null,
  subtotal: '100.00',
  total: '119.00',
  requiresPrescription: false,
  saleItemPrescriptionId: null,
  ...overrides,
});

const createOperationalView = (
  client: Partial<OperationalInvoiceView['operational']['client']> = {},
  hasDifferences = false,
): OperationalInvoiceView => ({
  fiscal: {
    id: 'inv-1',
    invoiceNumber: 'FE0001',
    invoiceType: 'ELECTRONIC_INVOICE',
    status: 'TRANSMITTED_AUTHORIZED',
    cufeProvisional: 'cufe-1',
    cufeOfficial: null,
    issuedAt: '2026-07-20T10:00:00.000Z',
    fullData: {} as unknown as OperationalInvoiceView['fiscal']['fullData'],
  },
  operational: {
    client: {
      clientId: null,
      name: null,
      identificationType: null,
      identificationNumber: null,
      ...client,
    },
    payments: [],
    notes: [],
    contactInfo: { email: null, phone: null, address: null },
    tags: [],
    customFields: {},
    deliveryInfo: null,
    hasDifferences,
  },
});

// ---------------------------------------------------------------------------
// Mock Prisma + adjustment service
// ---------------------------------------------------------------------------

type MockPrisma = {
  sale: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  invoice: {
    findMany: ReturnType<typeof vi.fn>;
  };
  invoiceLocalAdjustment: {
    groupBy: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    sale: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
    },
    invoiceLocalAdjustment: {
      groupBy: vi.fn(),
    },
  };
}

function createMockAdjustmentService(): LocalAdjustmentService {
  return {
    applyAdjustment: vi.fn(),
    reverseAdjustment: vi.fn(),
    getAdjustmentHistory: vi.fn(),
    resolveOperationalView: vi.fn(),
    isAdjustmentAllowed: vi.fn(),
    getAllowableAdjustmentTypes: vi.fn(),
    exportAdjustmentLogAsCsv: vi.fn(),
    exportBulkAdjustmentLogAsCsv: vi.fn(),
    getLocalAdjustmentSummary: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SalesHistoryService', () => {
  let prisma: MockPrisma;
  let adjustmentService: LocalAdjustmentService;
  let service: ReturnType<typeof createSalesHistoryService>;

  beforeEach(() => {
    prisma = createMockPrisma();
    adjustmentService = createMockAdjustmentService();
    service = createSalesHistoryService({
      prisma: prisma as unknown as PrismaClient,
      adjustmentService,
    });
  });

  describe('listConfirmedSales', () => {
    it('returns confirmed sales with invoice and adjustment flags', async () => {
      prisma.sale.findMany.mockResolvedValue([createSaleRow()]);
      prisma.sale.count.mockResolvedValue(1);
      prisma.invoice.findMany.mockResolvedValue([createInvoiceRow()]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([]);

      const result = await service.listConfirmedSales();

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          saleId: 'sale-1',
          localNumber: '100',
          clientName: 'Juan Pérez',
          clientIdentificationNumber: '123456',
          invoiceNumber: 'FE0001',
          invoiceStatus: 'TRANSMITTED_AUTHORIZED',
          hasAdjustments: false,
        }),
      );
      expect(result.total).toBe(1);
    });

    it('limits the number of returned sales', async () => {
      prisma.sale.findMany.mockResolvedValue([]);
      prisma.sale.count.mockResolvedValue(0);
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([]);

      await service.listConfirmedSales({ limit: 10, offset: 5 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 }),
      );
    });

    it('filters by date range', async () => {
      const since = new Date('2026-07-01T00:00:00Z');
      const until = new Date('2026-07-31T23:59:59Z');
      prisma.sale.findMany.mockResolvedValue([]);
      prisma.sale.count.mockResolvedValue(0);
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([]);

      await service.listConfirmedSales({ since, until });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operationalState: SaleOperationalState.CONFIRMED,
            confirmedAt: { gte: since, lte: until },
          }),
        }),
      );
    });

    it('filters by clientId', async () => {
      prisma.sale.findMany.mockResolvedValue([]);
      prisma.sale.count.mockResolvedValue(0);
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([]);

      await service.listConfirmedSales({ clientId: 'client-1' });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clientId: 'client-1' }),
        }),
      );
    });

    it('marks sales whose invoice has adjustments', async () => {
      prisma.sale.findMany.mockResolvedValue([createSaleRow()]);
      prisma.sale.count.mockResolvedValue(1);
      prisma.invoice.findMany.mockResolvedValue([createInvoiceRow()]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([
        { invoiceId: 'inv-1', _count: { invoiceId: 2 } },
      ]);

      const result = await service.listConfirmedSales();

      expect(result.items[0]?.hasAdjustments).toBe(true);
    });

    it('falls back to startedAt when confirmedAt is missing', async () => {
      prisma.sale.findMany.mockResolvedValue([
        createSaleRow({ confirmedAt: null }),
      ]);
      prisma.sale.count.mockResolvedValue(1);
      prisma.invoice.findMany.mockResolvedValue([createInvoiceRow()]);
      prisma.invoiceLocalAdjustment.groupBy.mockResolvedValue([]);

      const result = await service.listConfirmedSales();

      expect(result.items[0]?.confirmedAt).toBe(
        new Date('2026-07-20T09:55:00Z').toISOString(),
      );
    });
  });

  describe('getSaleHistoryDetail', () => {
    it('returns null when the sale does not exist', async () => {
      prisma.sale.findUnique.mockResolvedValue(null);

      const detail = await service.getSaleHistoryDetail('missing-sale');

      expect(detail).toBeNull();
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });

    it('returns the fiscal invoice and the operational view', async () => {
      const sale = createSaleRow({
        items: [createSaleItem()],
      });
      const invoice = createInvoiceRow();
      const opView = createOperationalView();
      const history: AdjustmentHistoryEntry[] = [];

      prisma.sale.findUnique.mockResolvedValue(sale);
      prisma.invoice.findMany.mockResolvedValue([invoice]);
      adjustmentService.resolveOperationalView.mockResolvedValue(opView);
      adjustmentService.getAdjustmentHistory.mockResolvedValue(history);

      const detail = await service.getSaleHistoryDetail('sale-1');

      expect(detail).not.toBeNull();
      expect(detail?.sale.id).toBe('sale-1');
      expect(detail?.sale.items).toHaveLength(1);
      expect(detail?.invoices[0]?.invoiceNumber).toBe('FE0001');
      expect(detail?.mainInvoiceOperationalView).toEqual(opView);
      expect(detail?.adjustmentHistory).toEqual(history);
    });

    it('returns the correct client override when a CLIENT_CHANGE adjustment exists', async () => {
      const sale = createSaleRow();
      const invoice = createInvoiceRow();
      const opView = createOperationalView(
        { clientId: 'client-2', name: 'Ana Gómez', identificationType: 'CC', identificationNumber: '654321' },
        true,
      );

      prisma.sale.findUnique.mockResolvedValue(sale);
      prisma.invoice.findMany.mockResolvedValue([invoice]);
      adjustmentService.resolveOperationalView.mockResolvedValue(opView);
      adjustmentService.getAdjustmentHistory.mockResolvedValue([
        {
          id: 'adj-client',
          createdAt: '2026-07-21T10:00:00Z',
          actorName: 'Admin',
          actorId: 'user-1',
          adjustmentType: 'CLIENT_CHANGE',
          previousValue: null,
          newValue: { clientId: 'client-2', name: 'Ana Gómez' },
          reason: 'Corrección de cliente',
          isReversed: false,
          reversalOfAdjustmentId: null,
          replacedByAdjustmentId: null,
        },
      ]);

      const detail = await service.getSaleHistoryDetail('sale-1');

      expect(detail?.mainInvoiceOperationalView?.operational.client?.name).toBe(
        'Ana Gómez',
      );
      expect(
        detail?.mainInvoiceOperationalView?.operational.hasDifferences,
      ).toBe(true);
    });

    it('returns the original fiscal client when no override exists', async () => {
      const sale = createSaleRow();
      const invoice = createInvoiceRow();
      const opView = createOperationalView(
        { clientId: 'client-1', name: 'Juan Pérez', identificationType: 'CC', identificationNumber: '123456' },
        false,
      );

      prisma.sale.findUnique.mockResolvedValue(sale);
      prisma.invoice.findMany.mockResolvedValue([invoice]);
      adjustmentService.resolveOperationalView.mockResolvedValue(opView);
      adjustmentService.getAdjustmentHistory.mockResolvedValue([]);

      const detail = await service.getSaleHistoryDetail('sale-1');

      expect(detail?.mainInvoiceOperationalView?.operational.client?.name).toBe(
        'Juan Pérez',
      );
      expect(
        detail?.mainInvoiceOperationalView?.operational.hasDifferences,
      ).toBe(false);
    });
  });
});
