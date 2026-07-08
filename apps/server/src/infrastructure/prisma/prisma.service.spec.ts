// Mock @pharmacy/database before any imports that depend on it
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);

jest.mock('@pharmacy/database', () => {
  return {
    PrismaClient: class MockPrismaClient {
      $connect = mockConnect;
      $disconnect = mockDisconnect;
    },
  };
});

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
  });

  describe('onModuleInit', () => {
    it('should call $connect when the module initializes', async () => {
      const service = new PrismaService();
      await service.onModuleInit();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should not call $connect before onModuleInit is called', () => {
      const service = new PrismaService();
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call $disconnect when the module is destroyed', async () => {
      const service = new PrismaService();
      await service.onModuleDestroy();
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });
  });
});
