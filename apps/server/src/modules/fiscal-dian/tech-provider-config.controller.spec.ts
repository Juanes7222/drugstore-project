jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { TechProviderConfigController } from './tech-provider-config.controller';
import { TechProviderConfigService } from './tech-provider-config.service';

const mockService = {
  find: jest.fn(),
  upsert: jest.fn(),
};

describe('TechProviderConfigController (integration)', () => {
  let controller: TechProviderConfigController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TechProviderConfigController],
      providers: [{ provide: TechProviderConfigService, useValue: mockService }],
    }).compile();

    controller = module.get<TechProviderConfigController>(TechProviderConfigController);
    service = module.get(TechProviderConfigService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /fiscal-dian/tech-provider-config', () => {
    it('should call find and return config', async () => {
      const expected = { providerNit: '800123456', softwareId: 'SFT-001' };
      service.find.mockResolvedValue(expected);

      const result = await controller.find();

      expect(service.find).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not configured', async () => {
      service.find.mockRejectedValue(new Error('Tech provider config not set'));

      await expect(controller.find()).rejects.toThrow('not set');
    });
  });

  describe('PATCH /fiscal-dian/tech-provider-config', () => {
    it('should call upsert with DTO and userId', async () => {
      const dto = { providerNit: '800123456', softwareId: 'SFT-001' };
      const user = { id: 'user-1' };
      const expected = { id: 'config-1', ...dto };
      service.upsert.mockResolvedValue(expected);

      const result = await controller.upsert(dto as any, user as any);

      expect(service.upsert).toHaveBeenCalledWith(dto, user.id);
      expect(result).toEqual(expected);
    });
  });
});
