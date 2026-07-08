import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma } from '@pharmacy/database';
import { ClientsService } from './clients.service';
import { ClientNotFoundException } from './exceptions/client-not-found.exception';
import { DuplicateClientIdentificationException } from './exceptions/duplicate-client-identification.exception';
import { DataSubjectRequestAlreadyPendingException } from './exceptions/data-subject-request-already-pending.exception';
import { NoPendingDataSubjectRequestException } from './exceptions/no-pending-data-subject-request.exception';

jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      constructor(m: string, public code: string, public meta?: any) { super(m); }
    },
  },
}));

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ClientsService(prisma as any);
  });

  const mockClient = {
    id: 'client-1',
    fullName: 'Juan Pérez',
    identificationType: 'CC',
    identificationNumber: '1234567890',
    email: 'juan@email.com',
    phone: '3101234567',
    address: 'Calle 123',
    clientType: 'FINAL_CONSUMER',
    isActive: true,
    dataSubjectRequestStatus: null,
    dataSubjectRequestAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockClassification = {
    id: 'class-1',
    name: 'VIP',
    discountPercentage: 5,
  };

  describe('findById', () => {
    it('returns the client when found', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(mockClient);

      const result = await service.findById('client-1');

      expect(result).toEqual(mockClient);
      expect(prisma.client.findUnique).toHaveBeenCalledWith({ where: { id: 'client-1' } });
    });

    it('throws ClientNotFoundException when not found', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toThrow(ClientNotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns all clients', async () => {
      (prisma.client.findMany as jest.Mock).mockResolvedValue([mockClient]);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual([mockClient]);
    });
  });

  describe('findAllClassifications', () => {
    it('returns all classifications', async () => {
      (prisma.clientClassification.findMany as jest.Mock).mockResolvedValue([mockClassification]);

      const result = await service.findAllClassifications();

      expect(result).toEqual([mockClassification]);
    });
  });

  describe('create', () => {
    it('creates a client successfully', async () => {
      const dto = {
        fullName: 'Juan Pérez',
        identificationType: 'CC' as const,
        identificationNumber: '1234567890',
        email: 'juan@email.com',
        phone: '3101234567',
        address: 'Calle 123',
      };
      (prisma.client.create as jest.Mock).mockResolvedValue(mockClient);

      const result = await service.create(dto, 'user-1');

      expect(result).toMatchObject(dto);
      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fullName: 'Juan Pérez',
            identificationType: 'CC',
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('throws DuplicateClientIdentificationException on P2002', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('Unique constraint', 'P2002', {});
      (prisma.client.create as jest.Mock).mockRejectedValue(error);

      await expect(
        service.create(
          { fullName: 'Test', identificationType: 'CC' as const, identificationNumber: 'dup' },
          'user-1',
        ),
      ).rejects.toThrow(DuplicateClientIdentificationException);
    });
  });

  describe('update', () => {
    it('updates a client successfully', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(mockClient);
      const dto = { fullName: 'Juan Actualizado' };
      (prisma.client.update as jest.Mock).mockResolvedValue({ ...mockClient, ...dto });

      const result = await service.update('client-1', dto as any, 'user-1');

      expect(result.fullName).toBe('Juan Actualizado');
      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({ fullName: 'Juan Actualizado', updatedById: 'user-1' }),
        }),
      );
    });

    it('throws ClientNotFoundException when client does not exist', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.update('unknown', {} as any, 'user-1')).rejects.toThrow(ClientNotFoundException);
    });
  });

  describe('registerConsent', () => {
    it('updates consent fields', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(mockClient);
      (prisma.client.update as jest.Mock).mockResolvedValue(mockClient);
      const dto = { consentVersion: 'v2', consentScope: ['MARKETING'] as any };

      await service.registerConsent('client-1', dto, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({
            consentVersion: 'v2',
            consentScope: ['MARKETING'],
            consentGivenAt: expect.any(Date),
            updatedById: 'user-1',
          }),
        }),
      );
    });
  });

  describe('setClassification', () => {
    it('updates classificationId', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue(mockClient);
      (prisma.client.update as jest.Mock).mockResolvedValue(mockClient);

      await service.setClassification('client-1', { classificationId: 'class-vip' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: { classificationId: 'class-vip', updatedById: 'user-1' },
        }),
      );
    });
  });

  describe('requestDataSubjectAction', () => {
    it('sets PENDING_ERASURE when request type is ERASURE', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: null });
      (prisma.client.update as jest.Mock).mockResolvedValue({});

      await service.requestDataSubjectAction('client-1', { requestType: 'ERASURE' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({ dataSubjectRequestStatus: 'PENDING_ERASURE' }),
        }),
      );
    });

    it('sets PENDING_RECTIFICATION when request type is RECTIFICATION', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: null });
      (prisma.client.update as jest.Mock).mockResolvedValue({});

      await service.requestDataSubjectAction('client-1', { requestType: 'RECTIFICATION' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({ dataSubjectRequestStatus: 'PENDING_RECTIFICATION' }),
        }),
      );
    });

    it('throws DataSubjectRequestAlreadyPendingException when a request is already pending', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: 'PENDING_ERASURE' });

      await expect(
        service.requestDataSubjectAction('client-1', { requestType: 'ERASURE' }, 'user-1'),
      ).rejects.toThrow(DataSubjectRequestAlreadyPendingException);
    });
  });

  describe('resolveDataSubjectRequest', () => {
    it('rejects a pending request without anonymizing', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: 'PENDING_ERASURE' });
      (prisma.client.update as jest.Mock).mockResolvedValue({});

      await service.resolveDataSubjectRequest('client-1', { resolution: 'REJECT' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({ dataSubjectRequestStatus: 'REJECTED' }),
        }),
      );
    });

    it('approves erasure and anonymizes the client', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: 'PENDING_ERASURE' });
      (prisma.client.update as jest.Mock).mockResolvedValue({});

      await service.resolveDataSubjectRequest('client-1', { resolution: 'APPROVE' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({
            fullName: 'ANONYMIZED',
            email: null,
            phone: null,
            address: null,
            isActive: false,
            dataSubjectRequestStatus: 'ERASURED',
          }),
        }),
      );
    });

    it('approves rectification without anonymizing', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: 'PENDING_RECTIFICATION' });
      (prisma.client.update as jest.Mock).mockResolvedValue({});

      await service.resolveDataSubjectRequest('client-1', { resolution: 'APPROVE' }, 'user-1');

      expect(prisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1' },
          data: expect.objectContaining({ dataSubjectRequestStatus: 'RECTIFIED' }),
        }),
      );
      const call = (prisma.client.update as jest.Mock).mock.calls[0][0] as any;
      expect(call.data.fullName).toBeUndefined();
    });

    it('throws NoPendingDataSubjectRequestException when no request is pending', async () => {
      (prisma.client.findUnique as jest.Mock).mockResolvedValue({ ...mockClient, dataSubjectRequestStatus: null });

      await expect(
        service.resolveDataSubjectRequest('client-1', { resolution: 'APPROVE' }, 'user-1'),
      ).rejects.toThrow(NoPendingDataSubjectRequestException);
    });
  });
});
