jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  SupplierIdentificationType: { NIT: 'NIT', CC: 'CC', CE: 'CE', PASSPORT: 'PASSPORT' },
  Prisma: {
    Decimal: class Decimal {
      constructor(private v: any) {}
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

import { Test, TestingModule } from '@nestjs/testing';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from '../services/suppliers.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'ADMIN' };

describe('SuppliersController (integration)', () => {
  let controller: SuppliersController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [{ provide: SuppliersService, useValue: mockService }],
    }).compile();

    controller = module.get<SuppliersController>(SuppliersController);
    service = module.get(SuppliersService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /purchases/suppliers', () => {
    it('should call findAll with query', async () => {
      const query = { isActive: true };
      const expected = [{ id: 's-1', businessName: 'Proveedor SAS' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /purchases/suppliers/:id', () => {
    it('should call findById with id', async () => {
      const expected = { id: 's-1', businessName: 'Proveedor SAS' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('s-1');

      expect(service.findById).toHaveBeenCalledWith('s-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findById.mockRejectedValue(new Error('not found'));

      await expect(controller.findById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /purchases/suppliers', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { businessName: 'Nuevo Proveedor', nit: '900123456' };
      const expected = { id: 's-2', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, mockUser as any);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('PUT /purchases/suppliers/:id', () => {
    it('should call update with id and DTO', async () => {
      const dto = { businessName: 'Proveedor Actualizado' };
      const expected = { id: 's-1', businessName: 'Proveedor Actualizado' };
      service.update.mockResolvedValue(expected);

      const result = await controller.update('s-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('s-1', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('DELETE /purchases/suppliers/:id', () => {
    it('should call remove with id', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.remove('s-1');

      expect(service.remove).toHaveBeenCalledWith('s-1');
    });

    it('should propagate exception when supplier has orders', async () => {
      service.remove.mockRejectedValue(new Error('Supplier has associated orders'));

      await expect(controller.remove('s-1')).rejects.toThrow('associated orders');
    });
  });
});
