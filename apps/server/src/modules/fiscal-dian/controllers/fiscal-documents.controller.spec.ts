jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { FiscalDocumentsController } from './fiscal-documents.controller';
import { FiscalDocumentsService } from '../services/fiscal-documents.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  getXmlPayload: jest.fn(),
  retry: jest.fn(),
  enqueueGenerationJob: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'ACCOUNTANT', workstationId: 'ws-1' };

describe('FiscalDocumentsController (integration)', () => {
  let controller: FiscalDocumentsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalDocumentsController],
      providers: [{ provide: FiscalDocumentsService, useValue: mockService }],
    }).compile();

    controller = module.get<FiscalDocumentsController>(FiscalDocumentsController);
    service = module.get(FiscalDocumentsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /fiscal-dian/documents', () => {
    it('should call findAll with query', async () => {
      const query = { fiscalState: 'PENDING_GENERATION', page: 1, pageSize: 20 };
      const expected = [{ id: 'fd-1' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });

    it('should call findAll with empty query', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll({} as any);

      expect(service.findAll).toHaveBeenCalledWith({});
      expect(result).toEqual([]);
    });
  });

  describe('GET /fiscal-dian/documents/:id', () => {
    it('should call findById with the id', async () => {
      const expected = { id: 'fd-1', fiscalState: 'VALIDATED' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('fd-1');

      expect(service.findById).toHaveBeenCalledWith('fd-1');
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not found', async () => {
      service.findById.mockRejectedValue(new Error('Document fd-1 not found'));

      await expect(controller.findById('fd-1')).rejects.toThrow('not found');
    });
  });

  describe('GET /fiscal-dian/documents/:id/xml', () => {
    it('should call getXmlPayload with the id', async () => {
      const expected = { xmlContent: '<invoice>...</invoice>' };
      service.getXmlPayload.mockResolvedValue(expected);

      const result = await controller.getXmlPayload('fd-1');

      expect(service.getXmlPayload).toHaveBeenCalledWith('fd-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /fiscal-dian/documents/:id/retry', () => {
    it('should call retry then enqueueGenerationJob', async () => {
      service.retry.mockResolvedValue({ id: 'fd-1' });
      service.enqueueGenerationJob.mockResolvedValue(undefined);

      const result = await controller.retryDocument('fd-1', mockUser as any);

      expect(service.retry).toHaveBeenCalledWith('fd-1', mockUser.workstationId);
      expect(service.enqueueGenerationJob).toHaveBeenCalledWith('fd-1');
      expect(result).toEqual({ id: 'fd-1' });
    });

    it('should not enqueue if retry fails', async () => {
      service.retry.mockRejectedValue(new Error('Document not retryable'));

      await expect(controller.retryDocument('fd-1', mockUser as any)).rejects.toThrow('not retryable');

      expect(service.enqueueGenerationJob).not.toHaveBeenCalled();
    });

    it('should propagate when enqueue fails', async () => {
      service.retry.mockResolvedValue({ id: 'fd-1' });
      service.enqueueGenerationJob.mockRejectedValue(new Error('Queue unavailable'));

      await expect(controller.retryDocument('fd-1', mockUser as any)).rejects.toThrow('Queue unavailable');
    });
  });
});
