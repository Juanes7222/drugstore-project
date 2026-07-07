// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'admin',
    role: 'ADMIN' as const,
    isActive: true,
    workstationId: 'ws-1',
    ...overrides,
  };
}

function buildMockProduct(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prod-uuid-1',
    internalCode: 'PROD-001',
    commercialName: 'Acetaminofén 500mg',
    genericName: 'Acetaminofén',
    activePrinciple: 'Acetaminofén',
    laboratory: 'Genfar',
    saleType: 'FREE_SALE' as const,
    minimumStock: 10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProductsService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  registerPrice: jest.fn(),
  assignTaxScheme: jest.fn(),
  addBarcode: jest.fn(),
  setPrimaryBarcode: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductsController (integration)', () => {
  let controller: ProductsController;
  let service: jest.Mocked<typeof mockProductsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get(ProductsService) as jest.Mocked<typeof mockProductsService>;
  });

  // -----------------------------------------------------------------------
  // GET /products
  // -----------------------------------------------------------------------
  describe('GET /products', () => {
    it('should call findAll with no filters when no query params provided', async () => {
      const expected = [buildMockProduct()];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith({}, undefined);
      expect(result).toEqual(expected);
    });

    it('should pass categoryId filter when provided', async () => {
      const expected = [buildMockProduct()];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll('cat-uuid-1');

      expect(service.findAll).toHaveBeenCalledWith(
        { categoryId: 'cat-uuid-1' },
        undefined,
      );
      expect(result).toEqual(expected);
    });

    it('should convert isActive string to boolean', async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, 'true');

      expect(service.findAll).toHaveBeenCalledWith(
        { isActive: true },
        undefined,
      );
    });

    it('should pass search term when provided', async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, undefined, undefined, 'acetamin');

      expect(service.findAll).toHaveBeenCalledWith({}, 'acetamin');
    });

    it('should combine multiple filters', async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll('cat-uuid-1', 'true', 'FREE_SALE', 'acetamin');

      expect(service.findAll).toHaveBeenCalledWith(
        { categoryId: 'cat-uuid-1', isActive: true, saleType: 'FREE_SALE' },
        'acetamin',
      );
    });
  });

  // -----------------------------------------------------------------------
  // GET /products/:id
  // -----------------------------------------------------------------------
  describe('GET /products/:id', () => {
    it('should call findById with the product id', async () => {
      const product = buildMockProduct({ id: 'prod-123' });
      service.findById.mockResolvedValue(product);

      const result = await controller.findById('prod-123');

      expect(service.findById).toHaveBeenCalledWith('prod-123');
      expect(result).toEqual(product);
    });

    it('should propagate error when product not found', async () => {
      service.findById.mockRejectedValue(new Error('Product not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Product not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /products
  // -----------------------------------------------------------------------
  describe('POST /products', () => {
    const createDto = {
      internalCode: 'PROD-002',
      commercialName: 'Ibuprofeno 400mg',
      genericName: 'Ibuprofeno',
      activePrinciple: 'Ibuprofeno',
      laboratory: 'MK',
      saleType: 'FREE_SALE' as const,
      initialPrice: '5000.00',
      initialTaxSchemeId: 'tax-uuid-1',
      minimumStock: 5,
    };

    it('should call createProduct with userId and dto', async () => {
      const created = buildMockProduct({ id: 'new-prod-uuid' });
      service.createProduct.mockResolvedValue(created);

      const user = buildMockUser();
      const result = await controller.create(createDto, user as any);

      expect(service.createProduct).toHaveBeenCalledWith(user.id, createDto);
      expect(result).toEqual(created);
    });

    it('should propagate error when createProduct throws', async () => {
      service.createProduct.mockRejectedValue(
        new Error('Duplicate internal code'),
      );

      await expect(
        controller.create(createDto, buildMockUser() as any),
      ).rejects.toThrow('Duplicate internal code');
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /products/:id
  // -----------------------------------------------------------------------
  describe('PATCH /products/:id', () => {
    const updateDto = {
      commercialName: 'Acetaminofén 500mg Actualizado',
    };

    it('should call updateProduct with id and dto', async () => {
      const updated = buildMockProduct({ commercialName: updateDto.commercialName });
      service.updateProduct.mockResolvedValue(updated);

      const result = await controller.update('prod-123', updateDto);

      expect(service.updateProduct).toHaveBeenCalledWith('prod-123', updateDto);
      expect(result).toEqual(updated);
    });
  });

  // -----------------------------------------------------------------------
  // POST /products/:id/price
  // -----------------------------------------------------------------------
  describe('POST /products/:id/price', () => {
    const priceDto = {
      price: '7500.00',
      changeReason: 'Ajuste IPC 2026',
    };

    it('should call registerPrice with productId, userId, and dto', async () => {
      const priceHistory = { id: 'price-uuid-1', price: '7500.00' };
      service.registerPrice.mockResolvedValue(priceHistory);

      const user = buildMockUser();
      const result = await controller.registerPrice(
        'prod-123',
        priceDto,
        user as any,
      );

      expect(service.registerPrice).toHaveBeenCalledWith(
        'prod-123',
        user.id,
        priceDto,
      );
      expect(result).toEqual(priceHistory);
    });
  });

  // -----------------------------------------------------------------------
  // POST /products/:id/tax-scheme
  // -----------------------------------------------------------------------
  describe('POST /products/:id/tax-scheme', () => {
    const taxDto = {
      taxSchemeId: 'tax-scheme-uuid-1',
    };

    it('should call assignTaxScheme with productId, userId, and dto', async () => {
      const taxHistory = { id: 'tax-history-uuid-1' };
      service.assignTaxScheme.mockResolvedValue(taxHistory);

      const user = buildMockUser();
      const result = await controller.assignTaxScheme(
        'prod-123',
        taxDto,
        user as any,
      );

      expect(service.assignTaxScheme).toHaveBeenCalledWith(
        'prod-123',
        user.id,
        taxDto,
      );
      expect(result).toEqual(taxHistory);
    });
  });

  // -----------------------------------------------------------------------
  // POST /products/:id/barcodes
  // -----------------------------------------------------------------------
  describe('POST /products/:id/barcodes', () => {
    const barcodeDto = {
      barcode: '7701234567890',
      barcodeType: 'EAN13' as const,
      isPrimary: true,
    };

    it('should call addBarcode with productId and dto', async () => {
      const barcode = { id: 'barcode-uuid-1', barcode: '7701234567890' };
      service.addBarcode.mockResolvedValue(barcode);

      const result = await controller.addBarcode('prod-123', barcodeDto);

      expect(service.addBarcode).toHaveBeenCalledWith('prod-123', barcodeDto);
      expect(result).toEqual(barcode);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /products/:id/barcodes/:barcodeId/primary
  // -----------------------------------------------------------------------
  describe('PATCH /products/:id/barcodes/:barcodeId/primary', () => {
    it('should call setPrimaryBarcode with productId and barcodeId', async () => {
      const updated = { id: 'barcode-uuid-1', isPrimary: true };
      service.setPrimaryBarcode.mockResolvedValue(updated);

      const result = await controller.setPrimaryBarcode(
        'prod-123',
        'barcode-uuid-1',
      );

      expect(service.setPrimaryBarcode).toHaveBeenCalledWith(
        'prod-123',
        'barcode-uuid-1',
      );
      expect(result).toEqual(updated);
    });
  });
});
