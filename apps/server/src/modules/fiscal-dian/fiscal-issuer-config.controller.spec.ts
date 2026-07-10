jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { FiscalIssuerConfigController } from './fiscal-issuer-config.controller';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';

const mockService = {
  find: jest.fn(),
  upsert: jest.fn(),
};

describe('FiscalIssuerConfigController (integration)', () => {
  let controller: FiscalIssuerConfigController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalIssuerConfigController],
      providers: [{ provide: FiscalIssuerConfigService, useValue: mockService }],
    }).compile();

    controller = module.get<FiscalIssuerConfigController>(FiscalIssuerConfigController);
    service = module.get(FiscalIssuerConfigService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /fiscal-dian/issuer-config', () => {
    it('should call find and return config', async () => {
      const expected = { nit: '900123456', businessName: 'Farmacia Ltda.' };
      service.find.mockResolvedValue(expected);

      const result = await controller.find();

      expect(service.find).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not configured', async () => {
      service.find.mockRejectedValue(new Error('Issuer config not set'));

      await expect(controller.find()).rejects.toThrow('not set');
    });
  });

  describe('PATCH /fiscal-dian/issuer-config', () => {
    it('should call upsert with DTO and userId', async () => {
      const dto = { nit: '900123456', businessName: 'Farmacia Ltda.' };
      const user = { id: 'user-1' };
      const expected = { id: 'config-1', ...dto };
      service.upsert.mockResolvedValue(expected);

      const result = await controller.upsert(dto as any, user as any);

      expect(service.upsert).toHaveBeenCalledWith(dto, user.id);
      expect(result).toEqual(expected);
    });
  });
});
