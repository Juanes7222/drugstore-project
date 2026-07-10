jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PharmaceuticalFormsController } from './pharmaceutical-forms.controller';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

describe('PharmaceuticalFormsController (integration)', () => {
  let controller: PharmaceuticalFormsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PharmaceuticalFormsController],
      providers: [{ provide: PharmaceuticalFormsService, useValue: mockService }],
    }).compile();

    controller = module.get<PharmaceuticalFormsController>(PharmaceuticalFormsController);
    service = module.get(PharmaceuticalFormsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /pharmaceutical-forms', () => {
    it('should call findAll and return result', async () => {
      const expected = [{ id: 'f-1', name: 'Tableta' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });

    it('should return empty array when no forms exist', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('GET /pharmaceutical-forms/:id', () => {
    it('should call findById with the id and return result', async () => {
      const expected = { id: 'f-1', name: 'Tableta' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('f-1');

      expect(service.findById).toHaveBeenCalledWith('f-1');
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not found', async () => {
      service.findById.mockRejectedValue(new Error('PharmaceuticalForm f-1 not found'));

      await expect(controller.findById('f-1')).rejects.toThrow('not found');
    });
  });

  describe('POST /pharmaceutical-forms', () => {
    it('should call create with DTO and return 201', async () => {
      const dto = { name: 'Cápsula', description: 'Cápsula dura' };
      const expected = { id: 'f-2', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('PATCH /pharmaceutical-forms/:id', () => {
    it('should call update with id and DTO', async () => {
      const dto = { name: 'Cápsula blanda' };
      const expected = { id: 'f-2', name: 'Cápsula blanda' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('f-2', dto as any);

      expect(service.update).toHaveBeenCalledWith('f-2', dto);
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not found', async () => {
      service.update.mockRejectedValue(new Error('not found'));

      await expect(controller.update('bad-id', {} as any)).rejects.toThrow('not found');
    });
  });
});
