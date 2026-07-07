// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { CashShiftController } from './cash-shift.controller';
import { CashShiftService } from './cash-shift.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'cashier1',
    role: 'CASHIER' as const,
    isActive: true,
    workstationId: 'ws-1',
    lastLoginWorkstationId: 'ws-1',
    ...overrides,
  };
}

function buildMockCashShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'shift-uuid-1',
    workstationId: 'ws-1',
    userId: 'user-uuid-1',
    state: 'OPEN' as const,
    openingBalance: 50000,
    openedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCashShiftService = {
  openShift: jest.fn(),
  registerCashCount: jest.fn(),
  closeShift: jest.fn(),
  forceCloseShift: jest.fn(),
  listCashCounts: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashShiftController (integration)', () => {
  let controller: CashShiftController;
  let service: jest.Mocked<typeof mockCashShiftService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashShiftController],
      providers: [
        { provide: CashShiftService, useValue: mockCashShiftService },
      ],
    }).compile();

    controller = module.get<CashShiftController>(CashShiftController);
    service = module.get(CashShiftService) as jest.Mocked<typeof mockCashShiftService>;
  });

  // -----------------------------------------------------------------------
  // POST /cash-shifts (openShift)
  // -----------------------------------------------------------------------
  describe('POST /cash-shifts', () => {
    const openDto = { openingBalance: 50000, openingNotes: 'Turno mañana' };

    it('should call openShift with workstationId, userId, and dto', async () => {
      const shift = buildMockCashShift({ id: 'new-shift-uuid' });
      service.openShift.mockResolvedValue(shift);

      const user = buildMockUser();
      const result = await controller.openShift(openDto, user as any, 'ws-1');

      expect(service.openShift).toHaveBeenCalledWith(
        'ws-1',
        user.id,
        openDto,
      );
      expect(result).toEqual(shift);
    });

    it('should propagate error when shift already open', async () => {
      service.openShift.mockRejectedValue(new Error('Shift already open'));

      await expect(
        controller.openShift(openDto, buildMockUser() as any),
      ).rejects.toThrow('Shift already open');
    });
  });

  // -----------------------------------------------------------------------
  // POST /cash-shifts/:id/cash-counts
  // -----------------------------------------------------------------------
  describe('POST /cash-shifts/:id/cash-counts', () => {
    const cashCountDto = {
      countType: 'CLOSING' as const,
      paymentMethodId: 'pm-cash-uuid',
      expectedAmount: 50000,
      declaredAmount: 50200,
    };

    it('should call registerCashCount with shiftId, userId, and dto', async () => {
      const count = { id: 'count-uuid-1', difference: 200 };
      service.registerCashCount.mockResolvedValue(count);

      const user = buildMockUser();
      const result = await controller.registerCashCount(
        'shift-123',
        cashCountDto,
        user as any,
      );

      expect(service.registerCashCount).toHaveBeenCalledWith(
        'shift-123',
        user.id,
        cashCountDto,
      );
      expect(result).toEqual(count);
    });
  });

  // -----------------------------------------------------------------------
  // GET /cash-shifts/:id/cash-counts
  // -----------------------------------------------------------------------
  describe('GET /cash-shifts/:id/cash-counts', () => {
    it('should call listCashCounts with shiftId', async () => {
      const counts = [
        { id: 'count-1', paymentMethodId: 'pm-cash-uuid', declaredAmount: 50200 },
      ];
      (service as any).listCashCounts.mockResolvedValue(counts);

      const result = await controller.listCashCounts('shift-123');

      expect((service as any).listCashCounts).toHaveBeenCalledWith('shift-123');
      expect(result).toEqual(counts);
    });
  });

  // -----------------------------------------------------------------------
  // POST /cash-shifts/:id/close
  // -----------------------------------------------------------------------
  describe('POST /cash-shifts/:id/close', () => {
    const closeDto = {
      closingNotes: 'Cierre normal',
    };

    it('should call closeShift with shiftId, userId, and dto', async () => {
      const closed = buildMockCashShift({
        id: 'shift-123',
        state: 'CLOSED',
        expectedClosingAmount: 11900,
        actualClosingAmount: 11900,
        closingDifference: 0,
      });
      service.closeShift.mockResolvedValue(closed);

      const user = buildMockUser();
      const result = await controller.closeShift('shift-123', closeDto, user as any);

      expect(service.closeShift).toHaveBeenCalledWith(
        'shift-123',
        user.id,
        closeDto,
      );
      expect(result).toEqual(closed);
    });

    it('should propagate error when missing closing counts', async () => {
      service.closeShift.mockRejectedValue(
        new Error('Missing closing counts for payment methods'),
      );

      await expect(
        controller.closeShift('shift-123', closeDto, buildMockUser() as any),
      ).rejects.toThrow('Missing closing counts for payment methods');
    });
  });

  // -----------------------------------------------------------------------
  // POST /cash-shifts/:id/force-close
  // -----------------------------------------------------------------------
  describe('POST /cash-shifts/:id/force-close', () => {
    const forceCloseDto = {
      closingNotes: 'Forzado por administrador',
    };

    it('should call forceCloseShift with shiftId, userId, and dto', async () => {
      const forced = buildMockCashShift({
        id: 'shift-123',
        state: 'FORCED_CLOSE',
        forcedClose: true,
      });
      service.forceCloseShift.mockResolvedValue(forced);

      const user = buildMockUser({ role: 'ADMIN' });
      const result = await controller.forceCloseShift(
        'shift-123',
        forceCloseDto,
        user as any,
      );

      expect(service.forceCloseShift).toHaveBeenCalledWith(
        'shift-123',
        user.id,
        forceCloseDto,
      );
      expect(result).toEqual(forced);
    });
  });
});
