import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma } from '@pharmacy/database';
import { CashShiftService } from './cash-shift.service';
import { ShiftAlreadyOpenException } from './exceptions/shift-already-open.exception';
import { ShiftNotOpenException } from './exceptions/shift-not-open.exception';
import { MissingClosingCashCountsException } from './exceptions/missing-closing-cash-counts.exception';
import { InvalidCashCountForNonCashMethodException } from './exceptions/invalid-cash-count-for-non-cash-method.exception';
import { PaymentMethodNotFoundException } from './exceptions/payment-method-not-found.exception';

jest.mock('@pharmacy/database', () => {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const DecimalMock = jest.fn().mockImplementation((v: any) => ({
    toString: () => String(v),
    toNumber: () => Number(v),
    minus: function (other: any) { return new DecimalMock(Number(v) - Number(other)); },
    plus: function (other: any) { return new DecimalMock(Number(v) + Number(other)); },
    equals: function (other: any) { return Number(v) === Number(other); },
    greaterThan: function (other: any) { return Number(v) > Number(other); },
  }));
  return {
    PrismaClient: jest.fn(),
    Prisma: {
      Decimal: DecimalMock,
      DbNull: 'DB_NULL',
      PrismaClientKnownRequestError: class extends Error { constructor(m: string, public code: string, public meta?: any) { super(m); } },
    },
  };
});

describe('CashShiftService', () => {
  let service: CashShiftService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new CashShiftService(prisma as any);
  });

  const mockShift = {
    id: 'shift-1',
    workstationId: 'ws-1',
    userId: 'user-1',
    openingBalance: new Prisma.Decimal(50000),
    openingNotes: null,
    openedAt: new Date(),
    state: 'OPEN',
    closedAt: null,
    closedByUserId: null,
    expectedClosingAmount: null,
    actualClosingAmount: null,
    closingDifference: null,
    closingNotes: null,
    forcedClose: false,
    hasExtendedAlert: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPaymentMethod = {
    id: 'pm-cash',
    name: 'Efectivo',
    isCash: true,
    category: 'CASH',
    isActive: true,
    internalCode: 'CASH',
    sortOrder: 1,
    dianCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockNonCashPaymentMethod = {
    ...mockPaymentMethod,
    id: 'pm-card',
    name: 'Tarjeta Débito',
    isCash: false,
    internalCode: 'CARD',
  };

  function buildCashCount(overrides: any = {}) {
    return {
      id: 'cc-1',
      cashShiftId: 'shift-1',
      countType: 'CLOSING',
      paymentMethodId: overrides.paymentMethodId || 'pm-cash',
      paymentMethodIsCash: overrides.paymentMethodIsCash ?? true,
      expectedAmount: overrides.expectedAmount || new Prisma.Decimal(0),
      declaredAmount: overrides.declaredAmount || new Prisma.Decimal(0),
      difference: new Prisma.Decimal(0),
      denominationsBreakdown: null,
      createdById: 'user-1',
      createdAt: new Date(),
      paymentMethod: { ...mockPaymentMethod },
      ...overrides,
    };
  }

  describe('openShift', () => {
    it('creates a new OPEN cash shift when no open shift exists', async () => {
      (prisma.cashShift.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.cashShift.create as jest.Mock).mockResolvedValue(mockShift);

      const result = await service.openShift('ws-1', 'user-1', { openingBalance: new Prisma.Decimal(50000) });

      expect(result).toEqual(mockShift);
      expect(prisma.cashShift.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workstationId: 'ws-1',
            userId: 'user-1',
            openingBalance: expect.any(Object),
            state: 'OPEN',
          }),
        }),
      );
    });

    it('throws ShiftAlreadyOpenException when an open shift exists', async () => {
      (prisma.cashShift.findFirst as jest.Mock).mockResolvedValue(mockShift);

      await expect(
        service.openShift('ws-1', 'user-1', { openingBalance: new Prisma.Decimal(50000) }),
      ).rejects.toThrow(ShiftAlreadyOpenException);
    });
  });

  describe('registerCashCount', () => {
    it('registers a cash count for a cash payment method', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue(mockPaymentMethod);
      (prisma.shiftCashCount.create as jest.Mock).mockResolvedValue({});

      await service.registerCashCount('shift-1', 'user-1', {
        countType: 'CLOSING' as any,
        paymentMethodId: 'pm-cash',
        expectedAmount: new Prisma.Decimal(48000),
        declaredAmount: new Prisma.Decimal(50000),
        denominationsBreakdown: { '50000': 1 },
      });

      expect(prisma.shiftCashCount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cashShiftId: 'shift-1',
            paymentMethodId: 'pm-cash',
            countType: 'CLOSING',
            difference: expect.any(Object),
          }),
        }),
      );
    });

    it('throws PaymentMethodNotFoundException when payment method does not exist', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.registerCashCount('shift-1', 'user-1', {
          countType: 'PARTIAL' as any,
          paymentMethodId: 'unknown',
          expectedAmount: new Prisma.Decimal(0),
          declaredAmount: new Prisma.Decimal(0),
        }),
      ).rejects.toThrow(PaymentMethodNotFoundException);
    });

    it('throws InvalidCashCountForNonCashMethodException when denominations provided for non-cash method', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue(mockNonCashPaymentMethod);

      await expect(
        service.registerCashCount('shift-1', 'user-1', {
          countType: 'CLOSING' as any,
          paymentMethodId: 'pm-card',
          expectedAmount: new Prisma.Decimal(1000),
          declaredAmount: new Prisma.Decimal(1000),
          denominationsBreakdown: { '1000': 1 },
        }),
      ).rejects.toThrow(InvalidCashCountForNonCashMethodException);
    });

    it('allows non-cash method without denominations', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue(mockNonCashPaymentMethod);
      (prisma.shiftCashCount.create as jest.Mock).mockResolvedValue({});

      await service.registerCashCount('shift-1', 'user-1', {
        countType: 'CLOSING' as any,
        paymentMethodId: 'pm-card',
        expectedAmount: new Prisma.Decimal(1000),
        declaredAmount: new Prisma.Decimal(1000),
      });

      expect(prisma.shiftCashCount.create).toHaveBeenCalled();
    });

    it('throws ShiftNotOpenException when shift is not OPEN', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue({ ...mockShift, state: 'CLOSED' });

      await expect(
        service.registerCashCount('shift-1', 'user-1', {
          countType: 'PARTIAL' as any,
          paymentMethodId: 'pm-cash',
          expectedAmount: new Prisma.Decimal(0),
          declaredAmount: new Prisma.Decimal(0),
        }),
      ).rejects.toThrow(ShiftNotOpenException);
    });
  });

  describe('closeShift', () => {
    it('closes the shift when all payment methods have closing counts', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.shiftCashCount.findMany as jest.Mock).mockResolvedValue([
        buildCashCount({ expectedAmount: new Prisma.Decimal(40000), declaredAmount: new Prisma.Decimal(42000) }),
        buildCashCount({ paymentMethodId: 'pm-card', paymentMethodIsCash: false, expectedAmount: new Prisma.Decimal(10000), declaredAmount: new Prisma.Decimal(10000) }),
      ]);
      (prisma.salePayment.findMany as jest.Mock).mockResolvedValue([
        { id: 'sp-1', createdAt: new Date(), saleId: 'sale-1', batchNumber: null, amount: new Prisma.Decimal(50000), transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, processorResponseCode: null, paymentMethodId: 'pm-cash' },
        { id: 'sp-2', createdAt: new Date(), saleId: 'sale-1', batchNumber: null, amount: new Prisma.Decimal(10000), transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, processorResponseCode: null, paymentMethodId: 'pm-card' },
      ]);
      (prisma.cashShift.update as jest.Mock).mockResolvedValue({ ...mockShift, state: 'CLOSED' });

      const result = await service.closeShift('shift-1', 'user-1', { closingNotes: 'Notes' });

      expect(result.state).toBe('CLOSED');
      expect(prisma.cashShift.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'shift-1' },
          data: expect.objectContaining({
            state: 'CLOSED',
            closedByUserId: 'user-1',
            closingNotes: 'Notes',
          }),
        }),
      );
    });

    it('throws MissingClosingCashCountsException when a payment method has no closing count', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.shiftCashCount.findMany as jest.Mock).mockResolvedValue([
        buildCashCount({}),
      ]);
      (prisma.salePayment.findMany as jest.Mock).mockResolvedValue([
        { id: 'sp-1', createdAt: new Date(), saleId: 'sale-1', batchNumber: null, amount: new Prisma.Decimal(50000), transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, processorResponseCode: null, paymentMethodId: 'pm-cash' },
        { id: 'sp-2', createdAt: new Date(), saleId: 'sale-1', batchNumber: null, amount: new Prisma.Decimal(10000), transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, processorResponseCode: null, paymentMethodId: 'pm-card' },
      ]);

      await expect(
        service.closeShift('shift-1', 'user-1', {}),
      ).rejects.toThrow(MissingClosingCashCountsException);
    });

    it('throws ShiftNotOpenException when shift is not OPEN', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.closeShift('unknown', 'user-1', {}),
      ).rejects.toThrow(ShiftNotOpenException);
    });
  });

  describe('forceCloseShift', () => {
    it('force closes the shift with FORCED_CLOSE state', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(mockShift);
      (prisma.shiftCashCount.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.cashShift.update as jest.Mock).mockResolvedValue({ ...mockShift, state: 'FORCED_CLOSE' });

      const result = await service.forceCloseShift('shift-1', 'user-1', { closingNotes: 'Emergency close' });

      expect(result.state).toBe('FORCED_CLOSE');
      expect(prisma.cashShift.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'shift-1' },
          data: expect.objectContaining({
            state: 'FORCED_CLOSE',
            forcedClose: true,
            closedByUserId: 'user-1',
          }),
        }),
      );
    });

    it('throws ShiftNotOpenException when shift is not OPEN', async () => {
      (prisma.cashShift.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.forceCloseShift('unknown', 'user-1', { closingNotes: 'test' }),
      ).rejects.toThrow(ShiftNotOpenException);
    });
  });

  describe('flagExtendedShifts', () => {
    it('marks open shifts older than threshold as extended', async () => {
      (prisma.cashShift.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await service.flagExtendedShifts();

      expect(prisma.cashShift.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            state: 'OPEN',
            hasExtendedAlert: false,
            openedAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
          data: { hasExtendedAlert: true },
        }),
      );
    });
  });
});
