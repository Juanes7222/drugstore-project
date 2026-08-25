import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { CashShiftOverviewService } from './cash-shift-overview.service';
import { CsvBuilderService } from './csv-builder.service';
import type { ActorSummary, WorkstationSummary } from './backoffice-actor-lookup.service';

class FakeDecimal {
  constructor(private readonly value: number) {}

  toString(): string {
    return String(this.value);
  }
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    subscriptionId: 'sub-1',
    role: RoleType.OWNER,
    isPlatformAdmin: false,
    email: 'owner@example.com',
    username: 'owner',
    displayName: 'Owner',
    avatarUrl: null,
    avatarColor: null,
    authMethod: 'PASSWORD_ONLY' as User['authMethod'],
    identificationType: null,
    identificationNumber: null,
    isActive: true,
    totpEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastLoginWorkstationId: null,
    lastPasswordChangeAt: null,
    status: 'ACTIVE' as User['status'],
    mustChangePassword: false,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const CASH_SHIFT_CSV_HEADER_LINE =
  'Abierto,Cerrado,Estado,Terminal,Cajero,Fondo inicial,Esperado,Contado,Diferencia,Cierre forzado,Notas';

describe('CashShiftOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let actorLookup: {
    loadUsersById: jest.Mock;
    loadWorkstationsById: jest.Mock;
  };
  let csvBuilder: CsvBuilderService;
  let service: CashShiftOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn(),
    };
    const users = new Map<string, ActorSummary>([
      ['user-1', { fullName: 'Ana Pérez', displayName: 'Ana' }],
    ]);
    const workstations = new Map<string, WorkstationSummary>([
      ['ws-1', { name: 'Principal', code: 'WS01' }],
    ]);
    actorLookup = {
      loadUsersById: jest.fn().mockResolvedValue(users),
      loadWorkstationsById: jest.fn().mockResolvedValue(workstations),
    };
    csvBuilder = new CsvBuilderService();
    service = new CashShiftOverviewService(
      prisma as never,
      scope as never,
      actorLookup as never,
      csvBuilder,
    );

    prisma.cashShift.findMany.mockResolvedValue([]);
    prisma.cashShift.count.mockResolvedValue(12);
    prisma.cashShift.aggregate.mockResolvedValue({
      _count: { id: 3 },
      _sum: { closingDifference: new FakeDecimal(45.5) },
    });
  });

  describe('getCashShifts', () => {
    it('uses default pagination and the tenant scope', async () => {
      const result = await service.getCashShifts(buildUser(), {});

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriptionId: 'sub-1' },
          orderBy: { openedAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getCashShifts(buildUser(), { page: -2 });

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getCashShifts(buildUser(), { pageSize: 250 });

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('merges from/to into an openedAt range on the where clause', async () => {
      await service.getCashShifts(buildUser(), {
        from: '2026-02-01',
        to: '2026-02-28',
      });

      const callArgs = (prisma.cashShift.findMany as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.where.openedAt).toEqual({
        gte: new Date('2026-02-01'),
        lte: new Date('2026-02-28'),
      });
    });

    it('merges state, workstationId and userId filters into the where clause', async () => {
      await service.getCashShifts(buildUser(), {
        state: 'OPEN',
        workstationId: 'ws-2',
        userId: 'u-3',
      });

      const callArgs = (prisma.cashShift.findMany as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.where).toEqual({
        subscriptionId: 'sub-1',
        state: 'OPEN',
        workstationId: 'ws-2',
        userId: 'u-3',
      });
    });

    it('attaches cashier and workstation display data via the actor lookup', async () => {
      prisma.cashShift.findMany.mockResolvedValue([
        {
          id: 'shift-1',
          workstationId: 'ws-1',
          userId: 'user-1',
          state: 'CLOSED',
          openedAt: new Date('2026-02-03T08:00:00Z'),
          closedAt: new Date('2026-02-03T20:00:00Z'),
          openingBalance: new FakeDecimal(200),
          expectedClosingAmount: new FakeDecimal(1000),
          actualClosingAmount: new FakeDecimal(995),
          closingDifference: new FakeDecimal(-5),
          closingNotes: null,
          forcedClose: false,
          hasExtendedAlert: false,
        },
      ]);

      const result = await service.getCashShifts(buildUser(), {});

      expect(actorLookup.loadUsersById).toHaveBeenCalledWith(['user-1']);
      expect(actorLookup.loadWorkstationsById).toHaveBeenCalledWith(['ws-1']);
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'shift-1',
          user: { fullName: 'Ana Pérez', displayName: 'Ana' },
          workstation: { name: 'Principal', code: 'WS01' },
        }),
      ]);
    });

    it('counts rows with the same filtered where clause', async () => {
      await service.getCashShifts(buildUser(), { state: 'OPEN' });

      expect(prisma.cashShift.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', state: 'OPEN' },
      });
    });

    it('summarizes closing differences only over non-zero differences', async () => {
      await service.getCashShifts(buildUser(), { state: 'CLOSED' });

      expect(prisma.cashShift.aggregate).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          state: 'CLOSED',
          closingDifference: { not: 0 },
        },
        _count: { id: true },
        _sum: { closingDifference: true },
      });
    });

    it('serializes the difference summary and returns the row count', async () => {
      const result = await service.getCashShifts(buildUser(), {});

      expect(result.summary).toEqual({
        differenceCount: 3,
        differenceAmount: '45.5',
      });
    });

    it('returns zero strings when the difference sums are empty', async () => {
      prisma.cashShift.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { closingDifference: null },
      });

      const result = await service.getCashShifts(buildUser(), {});

      expect(result.summary).toEqual({
        differenceCount: 0,
        differenceAmount: '0',
      });
    });
  });

  describe('getCashShiftsCsv', () => {
    it('exports every matching shift without pagination', async () => {
      await service.getCashShiftsCsv(buildUser(), { state: 'CLOSED' });

      const callArgs = (prisma.cashShift.findMany as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.where).toEqual({
        subscriptionId: 'sub-1',
        state: 'CLOSED',
      });
      expect(callArgs.skip).toBeUndefined();
      expect(callArgs.take).toBeUndefined();
    });

    it('writes the BOM and the Spanish header row', async () => {
      prisma.cashShift.findMany.mockResolvedValue([]);

      const csv = await service.getCashShiftsCsv(buildUser(), {});

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv.slice('\uFEFF'.length).split('\r\n')[0]).toBe(
        CASH_SHIFT_CSV_HEADER_LINE,
      );
    });

    it('renders Sí/No for forced close, empty cells for null dates/notes, and escapes commas in notes', async () => {
      prisma.cashShift.findMany.mockResolvedValue([
        {
          openedAt: new Date('2026-04-01T08:05:00Z'),
          closedAt: new Date('2026-04-01T20:09:00Z'),
          state: 'FORCED_CLOSE',
          forcedClose: true,
          openingBalance: new FakeDecimal(200),
          expectedClosingAmount: new FakeDecimal(1000),
          actualClosingAmount: new FakeDecimal(995.5),
          closingDifference: new FakeDecimal(-4.5),
          closingNotes: 'Faltante de, $4.50',
          userId: 'user-1',
          workstationId: 'ws-1',
        },
        {
          openedAt: new Date('2026-04-02T08:05:00Z'),
          closedAt: null,
          state: 'OPEN',
          forcedClose: false,
          openingBalance: new FakeDecimal(300),
          expectedClosingAmount: new FakeDecimal(0),
          actualClosingAmount: new FakeDecimal(0),
          closingDifference: new FakeDecimal(0),
          closingNotes: null,
          userId: 'user-1',
          workstationId: 'ws-1',
        },
      ]);

      const csv = await service.getCashShiftsCsv(buildUser(), {});
      const [, firstLine, secondLine] = csv
        .slice('\uFEFF'.length)
        .split('\r\n');

      expect(firstLine).toBe(
        '2026-04-01 08:05,2026-04-01 20:09,FORCED_CLOSE,Principal,Ana,200,1000,995.5,-4.5,Sí,"Faltante de, $4.50"',
      );
      expect(secondLine).toBe(
        '2026-04-02 08:05,,OPEN,Principal,Ana,300,0,0,0,No,',
      );
    });
  });
});
