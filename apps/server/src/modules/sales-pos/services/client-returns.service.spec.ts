import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma } from '@prisma/client';
import { ClientReturnsService } from './client-returns.service';
import { ClientReturnNotFoundException } from '../exceptions/client-return-not-found.exception';
import { ClientReturnNotDraftException } from '../exceptions/client-return-not-draft.exception';
import { ClientReturnCannotBeAnnulledException } from '../exceptions/client-return-cannot-be-annulled.exception';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';
import { SaleNotConfirmedException } from '../exceptions/sale-not-confirmed.exception';
import { CashShiftNotOpenForWorkstationException } from '../exceptions/cash-shift-not-open-for-workstation.exception';
import { ReturnQuantityExceedsAvailableException } from '../exceptions/return-quantity-exceeds-available.exception';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { ClientReturnCalculatorService } from './client-return-calculator.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(),
  ClientReturnState: { DRAFT: 'DRAFT', PENDING_PICKUP: 'PENDING_PICKUP', CONFIRMED: 'CONFIRMED', REJECTED: 'REJECTED', ANNULLED: 'ANNULLED' },
  ShiftState: { OPEN: 'OPEN', CLOSED: 'CLOSED' },
  SaleOperationalState: { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' },
  Prisma: {
    Decimal: class Decimal {
      constructor(private val: number | string | { value: number }) {
        if (typeof val === 'object' && 'value' in val) this.val = val.value;
      }
      get value(): number { return typeof this.val === 'string' ? parseFloat(this.val) : typeof this.val === 'number' ? this.val : 0; }
      times(o: any): Decimal { return new Decimal(this.value * (o instanceof Decimal ? o.value : o)); }
      dividedBy(o: any): Decimal { return new Decimal(this.value / (o instanceof Decimal ? o.value : o)); }
      plus(o: any): Decimal { return new Decimal(this.value + (o instanceof Decimal ? o.value : o)); }
      minus(o: any): Decimal { return new Decimal(this.value - (o instanceof Decimal ? o.value : o)); }
      toNumber(): number { return this.value; }
      equals(o: any): boolean { return this.value === (o instanceof Decimal ? o.value : o); }
      greaterThan(o: any): boolean { return this.value > (o instanceof Decimal ? o.value : o); }
    },
  },
}));

describe('ClientReturnsService', () => {
  let service: ClientReturnsService;
  let prisma: DeepMockProxy<PrismaClient>;
  let lotsService: DeepMockProxy<LotsService>;
  let calc: DeepMockProxy<ClientReturnCalculatorService>;
  let fiscalDocumentsService: DeepMockProxy<FiscalDocumentsService>;

  const mockSale = {
    id: 'sale-1',
    operationalState: 'CONFIRMED',
    clientId: 'client-1',
    workstationId: 'ws-1',
  };

  const mockCashShift = {
    id: 'shift-1',
    workstationId: 'ws-1',
    state: 'OPEN',
  };

  const mockReturn = {
    id: 'return-1',
    state: 'DRAFT',
    saleId: 'sale-1',
    clientId: 'client-1',
    refundAmount: new Prisma.Decimal(15000),
    subtotalReturned: new Prisma.Decimal(12605),
    taxReturned: new Prisma.Decimal(2395),
    items: [
      {
        id: 'ri-1',
        saleItemId: 'si-1',
        quantity: 3,
        lots: [{ id: 'ril-1', lotId: 'lot-1', quantity: 3 }],
      },
    ],
  };

  function setupTransactionMock(): void {
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(prisma);
      return cb; // for parallel transaction arrays
    });
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    lotsService = mockDeep<LotsService>();
    calc = mockDeep<ClientReturnCalculatorService>();
    fiscalDocumentsService = mockDeep<FiscalDocumentsService>();
    service = new ClientReturnsService(prisma as any, lotsService as any, calc as any, fiscalDocumentsService as any);
  });

  function mockFindUniqueReturn(returnData: any): void {
    (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue(returnData);
  }

  describe('findAll', () => {
    it('returns paginated client returns', async () => {
      const returns = [mockReturn];
      (prisma.$transaction as jest.Mock).mockResolvedValue([returns, 1]);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result.data).toEqual(returns);
      expect(result.total).toBe(1);
    });

    it('filters by state when provided', async () => {
      (prisma.$transaction as jest.Mock).mockResolvedValue([[], 0]);

      const result = await service.findAll({ page: 1, pageSize: 20, state: 'DRAFT' });

      expect(result).toEqual({ data: [], total: 0, page: 1, pageSize: 20 });
    });
  });

  describe('findOne', () => {
    it('returns the client return when found', async () => {
      mockFindUniqueReturn(mockReturn);

      const result = await service.findOne('return-1');

      expect(result).toEqual(mockReturn);
    });

    it('throws ClientReturnNotFoundException when not found', async () => {
      mockFindUniqueReturn(null);

      await expect(service.findOne('unknown')).rejects.toThrow(ClientReturnNotFoundException);
    });
  });

  describe('create', () => {
    it('creates a client return with items and lot assignments', async () => {
      setupTransactionMock();
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue(mockSale);
      (prisma.cashShift.findFirst as jest.Mock).mockResolvedValue(mockCashShift);
      (calc.getDefaultRefundMethod as jest.Mock).mockResolvedValue('pm-cash');
      (calc.prepareReturnItem as jest.Mock).mockResolvedValue({
        saleItemId: 'si-1',
        quantity: 3,
        unitPriceAtSale: new Prisma.Decimal(5000),
        unitPriceAtReturn: new Prisma.Decimal(5500),
        taxAmount: new Prisma.Decimal(3135),
        totalAmount: new Prisma.Decimal(19635),
        lots: [{ lotId: 'lot-1', quantity: 3 }],
      });
      (calc.getNextSequentialNumber as jest.Mock).mockResolvedValue(1);
      (prisma.clientReturn.create as jest.Mock).mockResolvedValue(mockReturn);

      const result = await service.create(
        { saleId: 'sale-1', items: [{ saleItemId: 'si-1', quantity: 3 }] },
        'user-1',
        'ws-1',
      );

      expect(result).toEqual(mockReturn);
      expect(prisma.clientReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            saleId: 'sale-1',
            sequentialNumber: 1,
          }),
        }),
      );
    });

    it('throws SaleNotFoundException when sale does not exist', async () => {
      setupTransactionMock();
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create({ saleId: 'unknown', items: [{ saleItemId: 'si-1', quantity: 1 }] }, 'user-1', 'ws-1'),
      ).rejects.toThrow(SaleNotFoundException);
    });

    it('throws SaleNotConfirmedException when sale is not CONFIRMED', async () => {
      setupTransactionMock();
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue({ ...mockSale, operationalState: 'IN_PROGRESS' });

      await expect(
        service.create({ saleId: 'sale-1', items: [{ saleItemId: 'si-1', quantity: 1 }] }, 'user-1', 'ws-1'),
      ).rejects.toThrow(SaleNotConfirmedException);
    });

    it('throws CashShiftNotOpenForWorkstationException when no open cash shift', async () => {
      setupTransactionMock();
      (prisma.sale.findUnique as jest.Mock).mockResolvedValue(mockSale);
      (prisma.cashShift.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create({ saleId: 'sale-1', items: [{ saleItemId: 'si-1', quantity: 1 }] }, 'user-1', 'ws-1'),
      ).rejects.toThrow(CashShiftNotOpenForWorkstationException);
    });
  });

  describe('markPendingPickup', () => {
    it('sets state to PENDING_PICKUP when current state is DRAFT', async () => {
      mockFindUniqueReturn({ ...mockReturn, state: 'DRAFT' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'PENDING_PICKUP' });

      const result = await service.markPendingPickup('return-1');

      expect(result.state).toBe('PENDING_PICKUP');
      expect(prisma.clientReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'return-1' },
          data: { state: 'PENDING_PICKUP' },
        }),
      );
    });

    it('throws ClientReturnNotDraftException when state is not DRAFT', async () => {
      mockFindUniqueReturn({ ...mockReturn, state: 'CONFIRMED' });

      await expect(service.markPendingPickup('return-1')).rejects.toThrow(ClientReturnNotDraftException);
    });
  });

  describe('confirm', () => {
    it('confirms a draft return, calls receiveStock and creates fiscal document', async () => {
      setupTransactionMock();
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        ...mockReturn,
        state: 'DRAFT',
        items: [
          {
            id: 'ri-1',
            saleItemId: 'si-1',
            quantity: 3,
            lots: [{ id: 'ril-1', lotId: 'lot-1', quantity: 3 }],
          },
        ],
      });
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue({ quantity: 10 });
      (calc.getAlreadyReturnedQuantity as jest.Mock).mockResolvedValue(0);
      (fiscalDocumentsService.createPendingDocumentForClientReturn as jest.Mock).mockResolvedValue({ id: 'fd-1' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'CONFIRMED' });

      const result = await service.confirm('return-1', 'user-1');

      expect(result.state).toBe('CONFIRMED');
      expect(lotsService.receiveStockFromClientReturn).toHaveBeenCalledWith(
        expect.objectContaining({ lotId: 'lot-1', quantity: 3 }),
      );
      expect(fiscalDocumentsService.createPendingDocumentForClientReturn).toHaveBeenCalledWith(
        expect.objectContaining({ clientReturnId: 'return-1' }),
      );
      expect(fiscalDocumentsService.enqueueGenerationJob).toHaveBeenCalledWith('fd-1');
    });

    it('throws ClientReturnNotDraftException when state is CONFIRMED', async () => {
      setupTransactionMock();
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'CONFIRMED' });

      await expect(service.confirm('return-1', 'user-1')).rejects.toThrow(ClientReturnNotDraftException);
    });

    it('throws ClientReturnNotDraftException when state is REJECTED', async () => {
      setupTransactionMock();
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'REJECTED' });

      await expect(service.confirm('return-1', 'user-1')).rejects.toThrow(ClientReturnNotDraftException);
    });

    it('throws ReturnQuantityExceedsAvailableException when return quantity exceeds available', async () => {
      setupTransactionMock();
      (prisma.clientReturn.findUnique as jest.Mock).mockResolvedValue({
        ...mockReturn,
        state: 'DRAFT',
        items: [{ id: 'ri-1', saleItemId: 'si-1', quantity: 20, lots: [{ id: 'ril-1', lotId: 'lot-1', quantity: 20 }] }],
      });
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue({ quantity: 10 });
      (calc.getAlreadyReturnedQuantity as jest.Mock).mockResolvedValue(0);

      await expect(service.confirm('return-1', 'user-1')).rejects.toThrow(ReturnQuantityExceedsAvailableException);
    });
  });

  describe('reject', () => {
    it('sets state to REJECTED', async () => {
      mockFindUniqueReturn({ ...mockReturn, state: 'DRAFT' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'REJECTED' });

      const result = await service.reject('return-1', { reason: 'Items damaged' });

      expect(result.state).toBe('REJECTED');
      expect(prisma.clientReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'return-1' },
          data: expect.objectContaining({ state: 'REJECTED', reason: 'Items damaged' }),
        }),
      );
    });

    it('throws ClientReturnNotFoundException when not found', async () => {
      mockFindUniqueReturn(null);

      await expect(service.reject('unknown', { reason: 'test' })).rejects.toThrow(ClientReturnNotFoundException);
    });
  });

  describe('annul', () => {
    it('sets state to ANNULLED for a DRAFT return', async () => {
      mockFindUniqueReturn({ ...mockReturn, state: 'DRAFT' });
      (prisma.clientReturn.update as jest.Mock).mockResolvedValue({ ...mockReturn, state: 'ANNULLED' });

      const result = await service.annul('return-1', 'user-1', { annulmentReason: 'Cancelled' });

      expect(result.state).toBe('ANNULLED');
      expect(prisma.clientReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'return-1' },
          data: expect.objectContaining({
            state: 'ANNULLED',
            annulledById: 'user-1',
            annulmentReason: 'Cancelled',
          }),
        }),
      );
    });

    it('throws ClientReturnCannotBeAnnulledException when state is CONFIRMED', async () => {
      mockFindUniqueReturn({ ...mockReturn, state: 'CONFIRMED' });

      await expect(
        service.annul('return-1', 'user-1', { annulmentReason: 'test' }),
      ).rejects.toThrow(ClientReturnCannotBeAnnulledException);
    });

    it('throws ClientReturnNotFoundException when not found', async () => {
      mockFindUniqueReturn(null);

      await expect(
        service.annul('unknown', 'user-1', { annulmentReason: 'test' }),
      ).rejects.toThrow(ClientReturnNotFoundException);
    });
  });
});
