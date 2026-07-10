jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

const mockService = {
  findAllProducts: jest.fn(),
  findProductById: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  findAllCategories: jest.fn(),
  findAllPharmaceuticalForms: jest.fn(),
  findAllTaxSchemes: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('CatalogController (integration)', () => {
  let controller: CatalogController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: mockService }],
    }).compile();

    controller = module.get<CatalogController>(CatalogController);
    service = module.get(CatalogService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /catalog/products', () => {
    it('should call findAllProducts with query', async () => {
      const query = { page: 1, pageSize: 20, saleType: 'FREE_SALE' };
      const expected = { data: [{ id: 'p-1' }], total: 1 };
      service.findAllProducts.mockResolvedValue(expected);

      const result = await controller.findAllProducts(query as any);

      expect(service.findAllProducts).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /catalog/products/:id', () => {
    it('should call findProductById with the id', async () => {
      const expected = { id: 'p-1', commercialName: 'Acetaminofén' };
      service.findProductById.mockResolvedValue(expected);

      const result = await controller.findProductById('p-1');

      expect(service.findProductById).toHaveBeenCalledWith('p-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findProductById.mockRejectedValue(new Error('not found'));

      await expect(controller.findProductById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /catalog/products', () => {
    it('should call createProduct with userId and DTO', async () => {
      const dto = { commercialName: 'Producto prueba', genericName: 'Genérico' };
      const expected = { id: 'p-2', ...dto };
      service.createProduct.mockResolvedValue(expected);

      const result = await controller.createProduct(dto as any, mockUser as any);

      expect(service.createProduct).toHaveBeenCalledWith(mockUser.id, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('PATCH /catalog/products/:id', () => {
    it('should call updateProduct with id and DTO', async () => {
      const dto = { commercialName: 'Nuevo nombre' };
      const expected = { id: 'p-1', commercialName: 'Nuevo nombre' };
      service.updateProduct.mockResolvedValue(expected);

      const result = await controller.updateProduct('p-1', dto as any);

      expect(service.updateProduct).toHaveBeenCalledWith('p-1', dto);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /catalog/categories', () => {
    it('should delegate to findAllCategories', async () => {
      const expected = [{ id: 'c-1', name: 'Analgésicos' }];
      service.findAllCategories.mockResolvedValue(expected);

      const result = await controller.findAllCategories();

      expect(service.findAllCategories).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });

  describe('GET /catalog/pharmaceutical-forms', () => {
    it('should delegate to findAllPharmaceuticalForms', async () => {
      const expected = [{ id: 'f-1', name: 'Tableta' }];
      service.findAllPharmaceuticalForms.mockResolvedValue(expected);

      const result = await controller.findAllPharmaceuticalForms();

      expect(service.findAllPharmaceuticalForms).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });

  describe('GET /catalog/tax-schemes', () => {
    it('should delegate to findAllTaxSchemes', async () => {
      const expected = [{ id: 't-1', name: 'IVA 19%', rate: 0.19 }];
      service.findAllTaxSchemes.mockResolvedValue(expected);

      const result = await controller.findAllTaxSchemes();

      expect(service.findAllTaxSchemes).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });
  });
});
