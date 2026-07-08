import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SuppliersService } from './suppliers.service';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { DuplicateSupplierIdentificationException } from '../exceptions/duplicate-supplier-identification.exception';

jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  SupplierIdentificationType: { NIT: 'NIT', CC: 'CC', CE: 'CE' },
  Prisma: {
    Decimal: class Decimal {
      constructor(private v: any) { /* mock */ }
      toString(): string { return String(this.v); }
      toNumber(): number { return Number(this.v); }
      valueOf(): number { return Number(this.v); }
      times(o: any): Decimal { return new Decimal(Number(this.v) * Number(o)); }
      dividedBy(o: any): Decimal { return new Decimal(Number(this.v) / Number(o)); }
      plus(o: any): Decimal { return new Decimal(Number(this.v) + Number(o)); }
      minus(o: any): Decimal { return new Decimal(Number(this.v) - Number(o)); }
    },
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      constructor(m: string, public code: string, public meta?: any) { super(m); }
    },
  },
}));

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockSupplier = {
    id: 'sup-1',
    identificationType: 'NIT',
    identificationNumber: '900123456-7',
    businessName: 'Pharma Supply Co.',
    contactName: 'Juan Perez',
    phone: '+57 300 123 4567',
    email: 'juan@pharmasupply.com',
    address: 'Calle 123 #45-67',
    city: 'Bogotá',
    country: 'CO',
    paymentTermsDays: 30,
    creditLimit: 5000000,
    isActive: true,
    createdById: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SuppliersService(prisma as any);
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------
  describe('findAll', () => {
    function mockFindAll(result: any[] = [mockSupplier], total: number = 1): void {
      (prisma.$transaction as jest.Mock).mockResolvedValue([result, total]);
    }

    it('returns paginated suppliers', async () => {
      mockFindAll();

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        data: [mockSupplier],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { businessName: 'asc' },
      });
    });

    it('filters by search term using OR on businessName and identificationNumber', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20, search: 'Pharma' });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { businessName: { contains: 'Pharma', mode: 'insensitive' } },
              { identificationNumber: { contains: 'Pharma', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('filters by isActive when provided', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20, isActive: 'true' });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('excludes isActive filter when not provided', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20 });

      expect(prisma.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ isActive: expect.anything() }),
        }),
      );
    });

    it('uses $transaction for atomic findMany + count', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20 });

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe('findById', () => {
    it('returns the supplier when found', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);

      const result = await service.findById('sup-1');

      expect(result).toEqual(mockSupplier);
      expect(prisma.supplier.findUnique).toHaveBeenCalledWith({ where: { id: 'sup-1' } });
    });

    it('throws SupplierNotFoundException when not found', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toThrow(SupplierNotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    const createDto = {
      identificationType: 'NIT' as const,
      identificationNumber: '900123456-7',
      businessName: 'Pharma Supply Co.',
      contactName: 'Juan Perez',
      phone: '+57 300 123 4567',
      email: 'juan@pharmasupply.com',
      address: 'Calle 123 #45-67',
      city: 'Bogotá',
      country: 'CO' as const,
      paymentTermsDays: 30,
      creditLimit: 5000000,
      isActive: true,
    };

    it('creates a supplier with generated id and createdById', async () => {
      (prisma.supplier.create as jest.Mock).mockResolvedValue(mockSupplier);

      const result = await service.create(createDto, 'user-1');

      expect(result).toEqual(mockSupplier);
      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          ...createDto,
          createdById: 'user-1',
        },
      });
    });

    it('throws DuplicateSupplierIdentificationException on Prisma P2002 error', async () => {
      const Prisma = jest.requireMock('@pharmacy/database').Prisma;
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        'P2002',
        {},
      );
      (prisma.supplier.create as jest.Mock).mockRejectedValue(p2002Error);

      await expect(service.create(createDto, 'user-1')).rejects.toThrow(
        DuplicateSupplierIdentificationException,
      );
    });

    it('re-throws non-P2002 errors as-is', async () => {
      (prisma.supplier.create as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      await expect(service.create(createDto, 'user-1')).rejects.toThrow('DB connection lost');
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe('update', () => {
    const updateDto = {
      businessName: 'Updated Pharma Supply',
      contactName: 'Maria Lopez',
    };

    it('updates a supplier when found', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.supplier.update as jest.Mock).mockResolvedValue({ ...mockSupplier, ...updateDto });

      const result = await service.update('sup-1', updateDto);

      expect(result.businessName).toBe('Updated Pharma Supply');
      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        data: updateDto,
      });
    });

    it('throws SupplierNotFoundException when not found', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.update('unknown', updateDto)).rejects.toThrow(SupplierNotFoundException);
    });

    it('throws DuplicateSupplierIdentificationException on P2002 from update', async () => {
      const Prisma = jest.requireMock('@pharmacy/database').Prisma;
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint',
        'P2002',
        {},
      );
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.supplier.update as jest.Mock).mockRejectedValue(p2002Error);

      await expect(service.update('sup-1', updateDto)).rejects.toThrow(
        DuplicateSupplierIdentificationException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------
  describe('remove', () => {
    it('deletes a supplier when found', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.supplier.delete as jest.Mock).mockResolvedValue(mockSupplier);

      const result = await service.remove('sup-1');

      expect(result).toEqual(mockSupplier);
      expect(prisma.supplier.delete).toHaveBeenCalledWith({ where: { id: 'sup-1' } });
    });

    it('throws SupplierNotFoundException when not found (precondition check)', async () => {
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.remove('unknown')).rejects.toThrow(SupplierNotFoundException);
      expect(prisma.supplier.delete).not.toHaveBeenCalled();
    });
  });
});
