import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());


import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { DevController } from './dev.controller';

describe('DevController', () => {
  let controller: DevController;
  let prisma: DeepMockProxy<PrismaClient>;
  let mockConfig: { get: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    mockConfig = { get: jest.fn().mockReturnValue('development') };
    controller = new DevController(mockConfig as any, prisma as any);
  });

  describe('exportTables', () => {
    it('returns 404 when NODE_ENV is not development', async () => {
      mockConfig.get.mockReturnValue('production');

      await expect(controller.exportTables('Product')).rejects.toThrow(NotFoundException);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('exports every whitelisted table when no tables param is given', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);

      const result = await controller.exportTables(undefined);

      expect(Object.keys(result)).toEqual([
        'Product',
        'Client',
        'TaxScheme',
        'Sale',
        'SaleItem',
        'SalePayment',
        'Supplier',
        'PurchaseOrder',
        'PurchaseReception',
        'Lot',
        'LotStock',
        'Category',
      ]);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(12);
    });

    it('exports only the requested whitelisted tables', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([]);

      await controller.exportTables('Product, Client');

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
      expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM "Product" ORDER BY (SELECT NULL) LIMIT 10000',
      );
      expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
        2,
        'SELECT * FROM "Client" ORDER BY (SELECT NULL) LIMIT 10000',
      );
    });

    it('converts nested BigInt values to strings so rows can be JSON-serialised', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([
        { id: 1n, name: 'x', nested: { quantity: 2n, ok: true } },
      ]);

      const result = await controller.exportTables('Product');

      expect(result.Product).toEqual([
        { id: '1', name: 'x', nested: { quantity: '2', ok: true } },
      ]);
    });

    it('returns 404 for tables outside the whitelist', async () => {
      await expect(controller.exportTables('User')).rejects.toThrow(NotFoundException);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('returns 500 when a table export fails', async () => {
      (prisma.$queryRawUnsafe as jest.Mock).mockRejectedValue(new Error('connection lost'));

      await expect(controller.exportTables('Product')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
