jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from '../services/configuration.service';
import { PosSettingsService } from '../services/pos-settings.service';
import { NotFoundException } from '@nestjs/common';

const mockConfigService = {
  findAll: jest.fn(),
  findByKey: jest.fn(),
  upsertByKey: jest.fn(),
};

const mockPosSettingsService = {
  getPosSettings: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'ADMIN' };

describe('ConfigurationController (integration)', () => {
  let controller: ConfigurationController;
  let configService: jest.Mocked<typeof mockConfigService>;
  let posSettingsService: jest.Mocked<typeof mockPosSettingsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigurationController],
      providers: [
        { provide: ConfigurationService, useValue: mockConfigService },
        { provide: PosSettingsService, useValue: mockPosSettingsService },
      ],
    }).compile();

    controller = module.get<ConfigurationController>(ConfigurationController);
    configService = module.get(ConfigurationService) as jest.Mocked<typeof mockConfigService>;
    posSettingsService = module.get(PosSettingsService) as jest.Mocked<typeof mockPosSettingsService>;
  });

  describe('GET /configuration/pos-settings', () => {
    it('should call getPosSettings and return result', async () => {
      const expected = { paymentMethods: [], discountLimits: {} };
      posSettingsService.getPosSettings.mockResolvedValue(expected);

      const result = await controller.getPosSettings();

      expect(posSettingsService.getPosSettings).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });

  describe('GET /configuration', () => {
    it('should call findAll with user', async () => {
      const expected = [{ key: 'APP_NAME', value: 'Droguería' }];
      configService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(mockUser as any);

      expect(configService.findAll).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /configuration/:key', () => {
    it('should call findByKey and return config when found', async () => {
      const expected = { key: 'APP_NAME', value: 'Droguería' };
      configService.findByKey.mockResolvedValue(expected);

      const result = await controller.findByKey('APP_NAME', mockUser as any);

      expect(configService.findByKey).toHaveBeenCalledWith('APP_NAME', mockUser);
      expect(result).toEqual(expected);
    });

    it('should throw NotFoundException when config not found', async () => {
      configService.findByKey.mockResolvedValue(null);

      await expect(controller.findByKey('NONEXISTENT', mockUser as any)).rejects.toThrow(NotFoundException);
      await expect(controller.findByKey('NONEXISTENT', mockUser as any)).rejects.toThrow(
        'Configuration key "NONEXISTENT" not found',
      );
    });

    it('should propagate service exceptions', async () => {
      configService.findByKey.mockRejectedValue(new Error('Service error'));

      await expect(controller.findByKey('APP_NAME', mockUser as any)).rejects.toThrow('Service error');
    });
  });

  describe('PATCH /configuration/:key', () => {
    it('should call upsertByKey with key, DTO, and user', async () => {
      const dto = { value: 'Nueva App', valueType: 'STRING', module: 'GENERAL' };
      const expected = { key: 'APP_NAME', value: 'Nueva App' };
      configService.upsertByKey.mockResolvedValue(expected);

      const result = await controller.upsertByKey('APP_NAME', dto as any, mockUser as any);

      expect(configService.upsertByKey).toHaveBeenCalledWith('APP_NAME', dto, mockUser);
      expect(result).toEqual(expected);
    });

    it('should propagate domain exceptions', async () => {
      configService.upsertByKey.mockRejectedValue(new Error('Immutable field'));

      await expect(controller.upsertByKey('APP_NAME', {} as any, mockUser as any)).rejects.toThrow('Immutable field');
    });
  });
});
