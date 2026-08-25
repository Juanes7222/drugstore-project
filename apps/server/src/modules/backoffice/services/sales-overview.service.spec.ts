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

import { SalesOverviewService } from './sales-overview.service';
import { CsvBuilderService } from './csv-builder.service';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';
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

function fakeMoney(value: number) {
  return new FakeDecimal(value);
}

const SALES_CSV_HEADER_LINE =
  'Número interno,Número de local,Estado,Confirmada,Anulada,Motivo de anulación,Cliente,Cajero,Terminal,Subtotal,Descuento,IVA,Total';

describe('SalesOverviewService', () => {
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
  let service: SalesOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest
        .fn()
        .mockReturnValue({ cashShift: { subscriptionId: 'sub-1' } }),
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
    service = new SalesOverviewService(
      prisma as never,
      scope as never,
      actorLookup as never,
      csvBuilder,
    );

    prisma.sale.findMany.mockResolvedValue([]);
    prisma.sale.findFirst.mockResolvedValue(null);
    prisma.sale.count.mockResolvedValue(25);
    prisma.sale.aggregate.mockResolvedValue({
      _count: { id: 20 },
      _sum: {
        totalAmount: fakeMoney(1000),
        totalTax: fakeMoney(190),
        totalDiscount: fakeMoney(50),
      },
    });
  });

  describe('getSales', () => {
    it('uses default pagination of page 1 and pageSize 20', async () => {
      const result = await service.getSales(buildUser(), {});

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cashShift: { subscriptionId: 'sub-1' } },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(2);
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getSales(buildUser(), { page: 0 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getSales(buildUser(), { pageSize: 200 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('computes skip from page and pageSize', async () => {
      await service.getSales(buildUser(), { page: 3, pageSize: 10 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('merges from/to into a confirmedAt range on the where clause', async () => {
      await service.getSales(buildUser(), {
        from: '2026-01-01',
        to: '2026-01-31',
      });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.confirmedAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31'),
      });
    });

    it('sets only gte when only from is provided', async () => {
      await service.getSales(buildUser(), { from: '2026-01-01' });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.confirmedAt).toEqual({
        gte: new Date('2026-01-01'),
      });
      expect(callArgs.where.confirmedAt.lte).toBeUndefined();
    });

    it('merges state, userId and workstationId filters into the where clause', async () => {
      await service.getSales(buildUser(), {
        state: 'CONFIRMED',
        userId: 'u-9',
        workstationId: 'ws-4',
      });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toEqual({
        cashShift: { subscriptionId: 'sub-1' },
        operationalState: 'CONFIRMED',
        userId: 'u-9',
        workstationId: 'ws-4',
      });
    });

    it('attaches cashier and workstation display data via the actor lookup', async () => {
      prisma.sale.findMany.mockResolvedValue([
        {
          id: 'sale-1',
          localNumber: BigInt('7'),
          internalNumber: 100,
          operationalState: 'CONFIRMED',
          confirmedAt: new Date('2026-02-03T14:30:00Z'),
          annulledAt: null,
          subtotal: fakeMoney(500),
          totalDiscount: fakeMoney(0),
          totalTax: fakeMoney(95),
          totalAmount: fakeMoney(595),
          annulmentReason: null,
          clientNameSnapshot: null,
          userId: 'user-1',
          workstationId: 'ws-1',
        },
      ]);

      const result = await service.getSales(buildUser(), {});

      expect(actorLookup.loadUsersById).toHaveBeenCalledWith(['user-1']);
      expect(actorLookup.loadWorkstationsById).toHaveBeenCalledWith(['ws-1']);
      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'sale-1',
          user: { fullName: 'Ana Pérez', displayName: 'Ana' },
          workstation: { name: 'Principal', code: 'WS01' },
        }),
      ]);
    });

    it('counts rows with the same filtered where clause', async () => {
      await service.getSales(buildUser(), { state: 'CONFIRMED' });

      expect(prisma.sale.count).toHaveBeenCalledWith({
        where: {
          cashShift: { subscriptionId: 'sub-1' },
          operationalState: 'CONFIRMED',
        },
      });
    });

    it('runs the summary aggregation only over confirmed sales with the filters merged', async () => {
      await service.getSales(buildUser(), { state: 'CONFIRMED' });

      expect(prisma.sale.aggregate).toHaveBeenCalledWith({
        where: {
          cashShift: { subscriptionId: 'sub-1' },
          operationalState: 'CONFIRMED',
          confirmedAt: { not: null },
        },
        _count: { id: true },
        _sum: { totalAmount: true, totalTax: true, totalDiscount: true },
      });
    });

    it('serializes summary Decimals to strings', async () => {
      const result = await service.getSales(buildUser(), {});

      expect(result.summary).toEqual({
        count: 20,
        totalAmount: '1000',
        totalTax: '190',
        totalDiscount: '50',
      });
    });

    it('returns zero strings when the summary sums are empty', async () => {
      prisma.sale.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { totalAmount: null, totalTax: null, totalDiscount: null },
      });

      const result = await service.getSales(buildUser(), {});

      expect(result.summary).toEqual({
        count: 0,
        totalAmount: '0',
        totalTax: '0',
        totalDiscount: '0',
      });
    });
  });

  describe('getSaleDetail', () => {
    const detailSale = {
      id: 'sale-1',
      localNumber: BigInt('42'),
      internalNumber: 1001,
      operationalState: 'CONFIRMED',
      confirmedAt: new Date('2026-02-03T14:30:00Z'),
      annulledAt: null,
      annulmentReason: null,
      clientNameSnapshot: 'Juan Gómez',
      subtotal: fakeMoney(1000),
      totalDiscount: fakeMoney(50),
      totalTax: fakeMoney(190),
      totalAmount: fakeMoney(1140),
      userId: 'user-1',
      workstationId: 'ws-1',
      items: [
        {
          id: 'item-1',
          productCommercialNameSnapshot: 'Dolex 500mg',
          quantity: 2,
          unitPrice: fakeMoney(50),
          discountAmount: fakeMoney(0),
          taxAmount: fakeMoney(9.5),
          total: fakeMoney(109.5),
        },
      ],
    };

    it('returns the mapped sale with line items for a sale in scope', async () => {
      prisma.sale.findFirst.mockResolvedValue(detailSale);

      const result = await service.getSaleDetail(buildUser(), 'sale-1');

      expect(result).toEqual({
        id: 'sale-1',
        localNumber: 42,
        internalNumber: '1001',
        operationalState: 'CONFIRMED',
        confirmedAt: '2026-02-03T14:30:00.000Z',
        annulledAt: null,
        annulmentReason: null,
        clientNameSnapshot: 'Juan Gómez',
        subtotal: '1000',
        totalDiscount: '50',
        totalTax: '190',
        totalAmount: '1140',
        user: { fullName: 'Ana Pérez', displayName: 'Ana' },
        workstation: { name: 'Principal', code: 'WS01' },
        items: [
          {
            id: 'item-1',
            productName: 'Dolex 500mg',
            quantity: 2,
            unitPrice: '50',
            lineDiscount: '0',
            lineTax: '9.5',
            lineTotal: '109.5',
          },
        ],
      });
    });

    it('maps a null internalNumber to null instead of an empty string', async () => {
      prisma.sale.findFirst.mockResolvedValue({
        ...detailSale,
        internalNumber: null,
      });

      const result = await service.getSaleDetail(buildUser(), 'sale-1');

      expect(result.internalNumber).toBeNull();
    });

    it('throws SaleNotFoundException when the sale does not exist', async () => {
      prisma.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.getSaleDetail(buildUser(), 'missing-sale'),
      ).rejects.toThrow(SaleNotFoundException);
    });

    it('folds the tenant scope into the same lookup, so out-of-scope reads are 404s', async () => {
      prisma.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.getSaleDetail(buildUser(), 'sale-1'),
      ).rejects.toThrow(SaleNotFoundException);

      expect(prisma.sale.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'sale-1',
          cashShift: { subscriptionId: 'sub-1' },
        },
        select: expect.anything(),
      });
    });

    it('throws SaleNotFoundException when the referenced user row is gone', async () => {
      prisma.sale.findFirst.mockResolvedValue(detailSale);
      actorLookup.loadUsersById.mockResolvedValue(new Map());

      await expect(
        service.getSaleDetail(buildUser(), 'sale-1'),
      ).rejects.toThrow(SaleNotFoundException);
    });
  });

  describe('getSalesCsv', () => {
    it('exports every matching sale without pagination', async () => {
      await service.getSalesCsv(buildUser(), { state: 'CONFIRMED' });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toEqual({
        cashShift: { subscriptionId: 'sub-1' },
        operationalState: 'CONFIRMED',
      });
      expect(callArgs.skip).toBeUndefined();
      expect(callArgs.take).toBeUndefined();
    });

    it('writes the BOM and the Spanish header row', async () => {
      prisma.sale.findMany.mockResolvedValue([]);

      const csv = await service.getSalesCsv(buildUser(), {});

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv.slice('\uFEFF'.length).split('\r\n')[0]).toBe(
        SALES_CSV_HEADER_LINE,
      );
    });

    it('escapes delimiter, quote and newline characters in cells', async () => {
      prisma.sale.findMany.mockResolvedValue([
        {
          internalNumber: 1001,
          localNumber: BigInt('42'),
          operationalState: 'CONFIRMED',
          confirmedAt: new Date('2026-03-05T09:07:00Z'),
          annulledAt: null,
          annulmentReason: null,
          clientNameSnapshot: 'Ana "La" Compradora,\nGerente',
          subtotal: fakeMoney(1000),
          totalDiscount: fakeMoney(50),
          totalTax: fakeMoney(190),
          totalAmount: fakeMoney(1140),
          userId: 'user-1',
          workstationId: 'ws-1',
        },
      ]);

      const csv = await service.getSalesCsv(buildUser(), {});
      const dataLine = csv.slice('\uFEFF'.length).split('\r\n')[1];

      expect(dataLine).toBe(
        '1001,42,CONFIRMED,2026-03-05 09:07,,,"Ana ""La"" Compradora,\nGerente",Ana,Principal,1000,50,190,1140',
      );
    });

    it('renders nulls as empty cells and falls back to fullName when displayName is null', async () => {
      actorLookup.loadUsersById.mockResolvedValue(
        new Map([['user-1', { fullName: 'Ana Pérez', displayName: null }]]),
      );
      prisma.sale.findMany.mockResolvedValue([
        {
          internalNumber: null,
          localNumber: BigInt('9'),
          operationalState: 'ANNULLED',
          confirmedAt: new Date('2026-03-05T09:07:00Z'),
          annulledAt: new Date('2026-03-06T10:11:00Z'),
          annulmentReason: null,
          clientNameSnapshot: null,
          subtotal: fakeMoney(10),
          totalDiscount: fakeMoney(0),
          totalTax: fakeMoney(2),
          totalAmount: fakeMoney(12),
          userId: 'user-1',
          workstationId: 'ws-1',
        },
      ]);

      const csv = await service.getSalesCsv(buildUser(), {});
      const dataLine = csv.slice('\uFEFF'.length).split('\r\n')[1];

      expect(dataLine).toBe(
        ',9,ANNULLED,2026-03-05 09:07,2026-03-06 10:11,,,Ana Pérez,Principal,10,0,2,12',
      );
    });
  });
});
