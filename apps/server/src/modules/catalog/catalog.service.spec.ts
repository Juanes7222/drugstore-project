// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { CatalogService } from './catalog.service';
import { ProductsService } from './products.service';
import { CategoriesService } from './categories.service';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';
import { TaxSchemesService } from './tax-schemes.service';
import { ProductNotFoundException } from './exceptions/product-not-found.exception';

describe('CatalogService', () => {
  let service: CatalogService;
  let prisma: DeepMockProxy<PrismaClient>;
  let productsService: jest.Mocked<ProductsService>;
  let categoriesService: jest.Mocked<CategoriesService>;
  let pharmaceuticalFormsService: jest.Mocked<PharmaceuticalFormsService>;
  let taxSchemesService: jest.Mocked<TaxSchemesService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    productsService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createProduct: jest.fn(),
      updateProduct: jest.fn(),
    } as any;
    categoriesService = { findAll: jest.fn() } as any;
    pharmaceuticalFormsService = { findAll: jest.fn() } as any;
    taxSchemesService = { findAll: jest.fn() } as any;

    service = new CatalogService(
      prisma as any,
      productsService,
      categoriesService,
      pharmaceuticalFormsService,
      taxSchemesService,
    );
  });

  // ── findAllProducts ──────────────────────────────────────────────────

  describe('findAllProducts', () => {
    const mockItems = [{ id: 'p1', commercialName: 'Product A' }];

    it('returns paginated products from Prisma', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue(mockItems);
      (prisma.product.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAllProducts({ page: 1, pageSize: 20 });

      expect(result.items).toEqual(mockItems);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('filters by search term across multiple fields', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAllProducts({ search: 'aspirina' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ commercialName: expect.objectContaining({ contains: 'aspirina' }) }),
            ]),
          }),
        }),
      );
    });

    it('filters by categoryId when provided', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAllProducts({ categoryId: 'cat-1' });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ categoryId: 'cat-1' }) }),
      );
    });

    it('filters by isFreeToSale when true', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAllProducts({ isFreeToSale: true });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ saleType: 'FREE_SALE' }) }),
      );
    });

    it('clamps page and pageSize to valid range', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.product.count as jest.Mock).mockResolvedValue(0);

      await service.findAllProducts({ page: 0, pageSize: 999 });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });

  // ── findProductById ──────────────────────────────────────────────────

  describe('findProductById', () => {
    it('returns product with full relations when found', async () => {
      const mockProduct = {
        id: 'p1',
        commercialName: 'Product A',
        category: { id: 'c1' },
        pharmaceuticalForm: { id: 'pf1' },
        barcodes: [{ barcode: '123', isPrimary: true }],
      };
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(mockProduct);

      const result = await service.findProductById('p1');

      expect(result).toEqual(mockProduct);
    });

    it('throws ProductNotFoundException when not found', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findProductById('missing')).rejects.toThrow(
        ProductNotFoundException,
      );
    });
  });

  // ── createProduct ────────────────────────────────────────────────────

  describe('createProduct', () => {
    it('delegates to productsService.createProduct', async () => {
      const dto = { commercialName: 'New Product' } as any;
      const created = { id: 'new-p1', commercialName: 'New Product' };
      productsService.createProduct.mockResolvedValue(created);

      const result = await service.createProduct('user-1', dto);

      expect(result).toEqual(created);
      expect(productsService.createProduct).toHaveBeenCalledWith('user-1', dto);
    });
  });

  // ── updateProduct ────────────────────────────────────────────────────

  describe('updateProduct', () => {
    it('throws ProductNotFoundException when product does not exist', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updateProduct('missing', {} as any)).rejects.toThrow(
        ProductNotFoundException,
      );
    });

    it('delegates to productsService.updateProduct when product exists', async () => {
      (prisma.product.findUnique as jest.Mock).mockResolvedValue({ id: 'p1' });
      const dto = { commercialName: 'Updated' } as any;
      const updated = { id: 'p1', commercialName: 'Updated' };
      productsService.updateProduct.mockResolvedValue(updated);

      const result = await service.updateProduct('p1', dto);

      expect(result).toEqual(updated);
      expect(productsService.updateProduct).toHaveBeenCalledWith('p1', dto);
    });
  });

  // ── Delegation methods ───────────────────────────────────────────────

  describe('findAllCategories', () => {
    it('delegates to categoriesService.findAll', async () => {
      const mockData = [{ id: 'c1', name: 'Analgésicos' }];
      categoriesService.findAll.mockResolvedValue(mockData);

      const result = await service.findAllCategories();

      expect(result).toEqual(mockData);
    });
  });

  describe('findAllPharmaceuticalForms', () => {
    it('delegates to pharmaceuticalFormsService.findAll', async () => {
      const mockData = [{ id: 'pf1', name: 'Tableta' }];
      pharmaceuticalFormsService.findAll.mockResolvedValue(mockData);

      const result = await service.findAllPharmaceuticalForms();

      expect(result).toEqual(mockData);
    });
  });

  describe('findAllTaxSchemes', () => {
    it('delegates to taxSchemesService.findAll', async () => {
      const mockData = [{ id: 'ts1', name: 'IVA 19%' }];
      taxSchemesService.findAll.mockResolvedValue(mockData);

      const result = await service.findAllTaxSchemes();

      expect(result).toEqual(mockData);
    });
  });
});
