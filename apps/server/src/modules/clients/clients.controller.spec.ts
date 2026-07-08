// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { QueryClientDto } from './dto/query-client.dto';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'admin',
    role: 'ADMIN' as const,
    isActive: true,
    ...overrides,
  };
}

function buildMockClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'client-uuid-1',
    identificationType: 'CC' as const,
    identificationNumber: '1234567890',
    fullName: 'Juan Pérez',
    email: 'juan@email.com',
    phone: '3101234567',
    address: 'Calle 123',
    isActive: true,
    dataSubjectRequestStatus: 'NONE' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-uuid-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClientsService = {
  findAll: jest.fn(),
  findAllClassifications: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  registerConsent: jest.fn(),
  setClassification: jest.fn(),
  requestDataSubjectAction: jest.fn(),
  resolveDataSubjectRequest: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientsController (integration)', () => {
  let controller: ClientsController;
  let service: jest.Mocked<typeof mockClientsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        { provide: ClientsService, useValue: mockClientsService },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
    service = module.get(ClientsService) as jest.Mocked<typeof mockClientsService>;
  });

  // -----------------------------------------------------------------------
  // GET /clients
  // -----------------------------------------------------------------------
  describe('GET /clients', () => {
    it('should return all clients', async () => {
      const clients = [buildMockClient()];
      service.findAll.mockResolvedValue(clients);

      const query = new QueryClientDto();
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(clients);
    });
  });

  // -----------------------------------------------------------------------
  // GET /clients/classifications/all
  // -----------------------------------------------------------------------
  describe('GET /clients/classifications/all', () => {
    it('should return all classifications', async () => {
      const classifications = [
        { id: 'class-1', type: 'FREQUENT', discountPercentage: 5 },
      ];
      service.findAllClassifications.mockResolvedValue(classifications);

      const result = await controller.findAllClassifications();

      expect(service.findAllClassifications).toHaveBeenCalled();
      expect(result).toEqual(classifications);
    });
  });

  // -----------------------------------------------------------------------
  // GET /clients/:id
  // -----------------------------------------------------------------------
  describe('GET /clients/:id', () => {
    it('should return client by id', async () => {
      const client = buildMockClient({ id: 'client-123' });
      service.findById.mockResolvedValue(client);

      const result = await controller.findById('client-123');

      expect(service.findById).toHaveBeenCalledWith('client-123');
      expect(result).toEqual(client);
    });

    it('should propagate ClientNotFoundException', async () => {
      service.findById.mockRejectedValue(new Error('Client not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Client not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /clients
  // -----------------------------------------------------------------------
  describe('POST /clients', () => {
    const createDto = {
      identificationType: 'CC' as const,
      identificationNumber: '1234567890',
      fullName: 'Juan Pérez',
      email: 'juan@email.com',
      phone: '3101234567',
      address: 'Calle 123',
    };

    it('should call create with dto and userId', async () => {
      const created = buildMockClient({ id: 'new-client-uuid' });
      service.create.mockResolvedValue(created);

      const user = buildMockUser();
      const result = await controller.create(createDto, user as any);

      expect(service.create).toHaveBeenCalledWith(createDto, user.id);
      expect(result).toEqual(created);
    });

    it('should propagate DuplicateClientIdentificationException', async () => {
      service.create.mockRejectedValue(
        new Error('Duplicate client identification'),
      );

      await expect(
        controller.create(createDto, buildMockUser() as any),
      ).rejects.toThrow('Duplicate client identification');
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /clients/:id
  // -----------------------------------------------------------------------
  describe('PATCH /clients/:id', () => {
    const updateDto = { fullName: 'Juan Pérez Actualizado' };

    it('should call update with id, dto, and userId', async () => {
      const updated = buildMockClient({
        id: 'client-123',
        fullName: 'Juan Pérez Actualizado',
      });
      service.update.mockResolvedValue(updated);

      const user = buildMockUser();
      const result = await controller.update('client-123', updateDto, user as any);

      expect(service.update).toHaveBeenCalledWith('client-123', updateDto, user.id);
      expect(result).toEqual(updated);
    });
  });

  // -----------------------------------------------------------------------
  // POST /clients/:id/consent
  // -----------------------------------------------------------------------
  describe('POST /clients/:id/consent', () => {
    const consentDto = {
      consentVersion: 'v1',
      consentScope: ['MARKETING', 'HISTORY'],
    };

    it('should call registerConsent with id, dto, and userId', async () => {
      const updated = buildMockClient({ id: 'client-123', consentVersion: 'v1' });
      service.registerConsent.mockResolvedValue(updated);

      const user = buildMockUser();
      const result = await controller.registerConsent(
        'client-123',
        consentDto,
        user as any,
      );

      expect(service.registerConsent).toHaveBeenCalledWith(
        'client-123',
        consentDto,
        user.id,
      );
      expect(result).toEqual(updated);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /clients/:id/classification
  // -----------------------------------------------------------------------
  describe('PATCH /clients/:id/classification', () => {
    const classificationDto = { classificationId: 'class-uuid-1' };

    it('should call setClassification with id, dto, and userId', async () => {
      const updated = buildMockClient({
        id: 'client-123',
        classificationId: 'class-uuid-1',
      });
      service.setClassification.mockResolvedValue(updated);

      const user = buildMockUser();
      const result = await controller.setClassification(
        'client-123',
        classificationDto,
        user as any,
      );

      expect(service.setClassification).toHaveBeenCalledWith(
        'client-123',
        classificationDto,
        user.id,
      );
      expect(result).toEqual(updated);
    });
  });

  // -----------------------------------------------------------------------
  // POST /clients/:id/data-subject-requests
  // -----------------------------------------------------------------------
  describe('POST /clients/:id/data-subject-requests', () => {
    const dataSubjectDto = { requestType: 'ERASURE' as const };

    it('should call requestDataSubjectAction with id, dto, and userId', async () => {
      const updated = buildMockClient({
        id: 'client-123',
        dataSubjectRequestStatus: 'PENDING_ERASURE' as const,
      });
      service.requestDataSubjectAction.mockResolvedValue(updated);

      const user = buildMockUser();
      const result = await controller.requestDataSubjectAction(
        'client-123',
        dataSubjectDto,
        user as any,
      );

      expect(service.requestDataSubjectAction).toHaveBeenCalledWith(
        'client-123',
        dataSubjectDto,
        user.id,
      );
      expect(result).toEqual(updated);
    });

    it('should propagate DataSubjectRequestAlreadyPendingException', async () => {
      service.requestDataSubjectAction.mockRejectedValue(
        new Error('Already has a pending data subject request'),
      );

      await expect(
        controller.requestDataSubjectAction(
          'client-123',
          dataSubjectDto,
          buildMockUser() as any,
        ),
      ).rejects.toThrow('Already has a pending data subject request');
    });
  });

  // -----------------------------------------------------------------------
  // POST /clients/:id/data-subject-requests/resolve
  // -----------------------------------------------------------------------
  describe('POST /clients/:id/data-subject-requests/resolve', () => {
    const resolveDto = {
      resolution: 'APPROVE' as const,
      resolutionNotes: 'Solicitud aprobada',
    };

    it('should call resolveDataSubjectRequest with id, dto, and userId', async () => {
      const anonymized = buildMockClient({
        id: 'client-123',
        fullName: 'ANONYMIZED',
        email: null,
        phone: null,
        dataSubjectRequestStatus: 'ERASURED' as const,
        isActive: false,
      });
      service.resolveDataSubjectRequest.mockResolvedValue(anonymized);

      const user = buildMockUser();
      const result = await controller.resolveDataSubjectRequest(
        'client-123',
        resolveDto,
        user as any,
      );

      expect(service.resolveDataSubjectRequest).toHaveBeenCalledWith(
        'client-123',
        resolveDto,
        user.id,
      );
      expect(result).toEqual(anonymized);
    });

    it('should propagate NoPendingDataSubjectRequestException', async () => {
      service.resolveDataSubjectRequest.mockRejectedValue(
        new Error('No pending data subject request'),
      );

      await expect(
        controller.resolveDataSubjectRequest(
          'client-123',
          resolveDto,
          buildMockUser() as any,
        ),
      ).rejects.toThrow('No pending data subject request');
    });
  });
});
