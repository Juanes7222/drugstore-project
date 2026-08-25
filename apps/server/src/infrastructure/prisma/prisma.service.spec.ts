// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockTransaction = jest.fn();

// The PrismaClient stub keeps the lifecycle hooks as spies: this suite
// asserts on $connect/$disconnect/$transaction directly.
jest.mock('@pharmacy/database', () => ({
  ...createPrismaDatabaseMock(),
  PrismaClient: class MockPrismaClient {
    $connect = mockConnect;
    $disconnect = mockDisconnect;
    $transaction = mockTransaction;
  },
}));

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let tenantContext: {
    getTx: jest.Mock;
    setTx: jest.Mock;
    clearTx: jest.Mock;
    drainAfterCommit: jest.Mock;
    runWithTenant: jest.Mock;
  };

  const createService = (): PrismaService => {
    tenantContext = {
      getTx: jest.fn(() => null),
      setTx: jest.fn(),
      clearTx: jest.fn(),
      drainAfterCommit: jest.fn().mockResolvedValue(undefined),
      runWithTenant: jest.fn(
        (_subscriptionId: string, fn: () => unknown) => fn(),
      ),
    };
    return new PrismaService(tenantContext);
  };

  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockTransaction.mockReset();
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('should call $connect when the module initializes', async () => {
      const service = createService();
      await service.onModuleInit();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should not call $connect before onModuleInit is called', () => {
      const service = createService();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('should call $disconnect when the module is destroyed', async () => {
      const service = createService();
      await service.onModuleDestroy();
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('runWithTenant', () => {
    it('binds the tx to the tenant context around the callback and drains after commit', async () => {
      const service = createService();
      const fakeTx = { sale: { findMany: jest.fn() }, $executeRaw: jest.fn() };

      mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(fakeTx);
        return 'done';
      });

      let observedTx: unknown = null;
      await service.runWithTenant('sub-1', async (tx) => {
        observedTx = tx;
      });

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(observedTx).toBe(fakeTx);
      expect(tenantContext.setTx).toHaveBeenCalledWith(fakeTx);
      expect(tenantContext.clearTx).toHaveBeenCalled();
      expect(tenantContext.setTx.mock.invocationCallOrder[0]).toBeLessThan(
        tenantContext.clearTx.mock.invocationCallOrder[0],
      );
      expect(tenantContext.drainAfterCommit).toHaveBeenCalledTimes(1);
    });

    it('clears the tx and skips afterCommit when the transaction rolls back', async () => {
      const service = createService();
      const fakeTx = { $executeRaw: jest.fn() };
      // Work runs inside the transaction, then the commit itself fails.
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(fakeTx);
        throw new Error('boom');
      });

      await expect(
        service.runWithTenant('sub-1', async () => undefined),
      ).rejects.toThrow('boom');

      expect(tenantContext.setTx).toHaveBeenCalledWith(fakeTx);
      expect(tenantContext.clearTx).toHaveBeenCalled();
      expect(tenantContext.drainAfterCommit).not.toHaveBeenCalled();
    });

    it('withTenant binds the subscriptionId and flows into the real runWithTenant', async () => {
      const service = createService();
      const fakeTx = { $executeRaw: jest.fn() };
      mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback(fakeTx);
        return 'ok';
      });
      const inner = jest.fn(async () => undefined);

      await service.withTenant('sub-9', inner);

      expect(tenantContext.runWithTenant).toHaveBeenCalledWith(
        'sub-9',
        expect.any(Function),
      );
      // The wrapped callback reaches the real runWithTenant → $transaction,
      // which invokes the user work with the request tx.
      expect(inner).toHaveBeenCalledTimes(1);
      expect(tenantContext.setTx).toHaveBeenCalledWith(fakeTx);
      expect(tenantContext.drainAfterCommit).toHaveBeenCalledTimes(1);
    });
  });
});
