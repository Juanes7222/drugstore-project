// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      Decimal: jest
        .fn()
        .mockImplementation(
          (v: string) => ({ value: v, toString: () => v }) as any,
        ),
    },
  };
});

import { ProductsService } from './products.service';
import { DuplicateBarcodeException } from './exceptions/duplicate-barcode.exception';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-uuid-1',
    internalCode: 'P001',
    commercialName: 'Paracetamol',
    genericName: 'Paracetamol 500mg',
    activePrinciple: 'Paracetamol',
    concentration: '500',
    concentrationUnit: 'mg',
    laboratory: 'Genfar',
    saleType: 'FREE_SALE',
    minimumStock: 10,
    discontinuationReason: null,
    invimaRegistry: 'INVIMA-2024-001',
    atcCode: 'N02BE01',
    therapeuticIndication: 'Analgesic',
    storageConditions: null,
    internalNotes: null,
    categoryId: null,
    pharmaceuticalFormId: null,
    currentPriceId: null,
    currentTaxHistoryId: null,
    isActive: true,
    createdById: 'user-uuid-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPriceHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'price-uuid-1',
    productId: 'product-uuid-1',
    price: { value: '5000.00' },
    effectiveFrom: new Date(),
    effectiveTo: null,
    changedById: 'user-uuid-1',
    changedAt: new Date(),
    changeReason: null,
    ...overrides,
  };
}

function buildTaxHistory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tax-hist-uuid-1',
    productId: 'product-uuid-1',
    taxSchemeId: 'tax-scheme-uuid-1',
    effectiveFrom: new Date(),
    effectiveTo: null,
    changedById: 'user-uuid-1',
    changedAt: new Date(),
    changeReason: null,
    ...overrides,
  };
}

function buildBarcode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'barcode-uuid-1',
    productId: 'product-uuid-1',
    barcode: '7701234567890',
    barcodeType: 'EAN13',
    isPrimary: true,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Transaction mock
// ---------------------------------------------------------------------------
const mockTx = {
  product: {
    create: jest.fn(),
    update: jest.fn(),
  },
  productPriceHistory: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  productTaxHistory: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  productBarcode: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  $transaction: jest.fn().mockImplementation(
    async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
  ),
  product: {
    update: jest.fn(),
  },
  productBarcode: {
    create: jest.fn(),
  },
} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductsService', () => {
  let service: ProductsService;
  const USER_ID = 'user-uuid-1';
  const PRODUCT_ID = 'product-uuid-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProductsService(mockPrisma);
  });

  // -----------------------------------------------------------------------
  // createProduct
  // -----------------------------------------------------------------------
  describe('createProduct', () => {
    const dto = {
      internalCode: 'P001',
      commercialName: 'Paracetamol',
      genericName: 'Paracetamol 500mg',
      activePrinciple: 'Paracetamol',
      concentration: '500',
      concentrationUnit: 'mg',
      laboratory: 'Genfar',
      saleType: 'FREE_SALE' as const,
      minimumStock: 10,
      invimaRegistry: 'INVIMA-2024-001',
      atcCode: 'N02BE01',
      therapeuticIndication: 'Analgesic',
      initialPrice: '5000.00',
      initialTaxSchemeId: 'tax-scheme-uuid-1',
    };

    it('should create a product, price history, and tax history inside a transaction', async () => {
      const product = buildProduct();
      const priceHistory = buildPriceHistory();
      const taxHistory = buildTaxHistory();
      const updatedProduct = buildProduct({
        currentPriceId: 'price-uuid-1',
        currentTaxHistoryId: 'tax-hist-uuid-1',
      });

      mockTx.product.create.mockResolvedValue(product);
      mockTx.productPriceHistory.create.mockResolvedValue(priceHistory);
      mockTx.productTaxHistory.create.mockResolvedValue(taxHistory);
      mockTx.product.update.mockResolvedValue(updatedProduct);

      const result = await service.createProduct(USER_ID, dto as any);

      expect(result).toEqual(updatedProduct);
    });

    it('should call $transaction', async () => {
      mockTx.product.create.mockResolvedValue(buildProduct());
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory());
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.createProduct(USER_ID, dto as any);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should create the product with all provided fields', async () => {
      mockTx.product.create.mockResolvedValue(buildProduct());
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory());
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.createProduct(USER_ID, dto as any);

      expect(mockTx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            internalCode: 'P001',
            commercialName: 'Paracetamol',
            genericName: 'Paracetamol 500mg',
            activePrinciple: 'Paracetamol',
            saleType: 'FREE_SALE',
            createdById: USER_ID,
          }),
        }),
      );
    });

    it('should set optional fields to null when not provided', async () => {
      const minimalDto = {
        internalCode: 'P002',
        commercialName: 'Ibuprofeno',
        genericName: 'Ibuprofeno 400mg',
        activePrinciple: 'Ibuprofeno',
        laboratory: 'MK',
        saleType: 'FREE_SALE' as const,
        initialPrice: '3000.00',
        initialTaxSchemeId: 'tax-scheme-uuid-2',
      };

      mockTx.product.create.mockResolvedValue(
        buildProduct({ internalCode: 'P002' }),
      );
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory());
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.createProduct(USER_ID, minimalDto as any);

      expect(mockTx.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            concentration: null,
            concentrationUnit: null,
            categoryId: null,
            pharmaceuticalFormId: null,
          }),
        }),
      );
    });

    it('should create price history with the initial price', async () => {
      mockTx.product.create.mockResolvedValue(buildProduct());
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory());
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.createProduct(USER_ID, dto as any);

      expect(mockTx.productPriceHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-uuid-1',
            price: expect.objectContaining({ value: '5000.00' }),
          }),
        }),
      );
    });

    it('should create tax history with the initial tax scheme', async () => {
      mockTx.product.create.mockResolvedValue(buildProduct());
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory());
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.createProduct(USER_ID, dto as any);

      expect(mockTx.productTaxHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-uuid-1',
            taxSchemeId: 'tax-scheme-uuid-1',
          }),
        }),
      );
    });

    it('should update the product with currentPriceId and currentTaxHistoryId', async () => {
      const product = buildProduct({ id: 'product-uuid-1' });
      const priceHistory = buildPriceHistory({ id: 'price-uuid-1' });
      const taxHistory = buildTaxHistory({ id: 'tax-hist-uuid-1' });
      mockTx.product.create.mockResolvedValue(product);
      mockTx.productPriceHistory.create.mockResolvedValue(priceHistory);
      mockTx.productTaxHistory.create.mockResolvedValue(taxHistory);
      mockTx.product.update.mockResolvedValue({
        ...product,
        currentPriceId: 'price-uuid-1',
        currentTaxHistoryId: 'tax-hist-uuid-1',
      });

      await service.createProduct(USER_ID, dto as any);

      expect(mockTx.product.update).toHaveBeenCalledWith({
        where: { id: 'product-uuid-1' },
        data: {
          currentPriceId: 'price-uuid-1',
          currentTaxHistoryId: 'tax-hist-uuid-1',
        },
      });
    });
  });

  // -----------------------------------------------------------------------
  // updateProduct
  // -----------------------------------------------------------------------
  describe('updateProduct', () => {
    it('should update only the provided fields', async () => {
      const updatedProduct = buildProduct({ commercialName: 'Paracetamol Genfar' });
      mockPrisma.product.update.mockResolvedValue(updatedProduct);

      const result = await service.updateProduct(PRODUCT_ID, {
        commercialName: 'Paracetamol Genfar',
      } as any);

      expect(result.commercialName).toBe('Paracetamol Genfar');
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({
          commercialName: 'Paracetamol Genfar',
          updatedAt: expect.any(Date),
        }),
      });
    });

    it('should not include undefined fields in the update', async () => {
      mockPrisma.product.update.mockResolvedValue(buildProduct());

      await service.updateProduct(PRODUCT_ID, {} as any);

      const data = (mockPrisma.product.update as jest.Mock).mock.calls[0][0]
        .data;
      // Only updatedAt should be present when no fields are provided
      expect(Object.keys(data)).toEqual(['updatedAt']);
    });

    it('should update multiple fields at once', async () => {
      mockPrisma.product.update.mockResolvedValue(
        buildProduct({
          commercialName: 'New Name',
          genericName: 'New Generic',
          minimumStock: 20,
        }),
      );

      await service.updateProduct(PRODUCT_ID, {
        commercialName: 'New Name',
        genericName: 'New Generic',
        minimumStock: 20,
      } as any);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({
          commercialName: 'New Name',
          genericName: 'New Generic',
          minimumStock: 20,
        }),
      });
    });

    it('should allow setting isActive to false', async () => {
      mockPrisma.product.update.mockResolvedValue(
        buildProduct({ isActive: false }),
      );

      await service.updateProduct(PRODUCT_ID, { isActive: false } as any);

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });

  // -----------------------------------------------------------------------
  // registerPrice
  // -----------------------------------------------------------------------
  describe('registerPrice', () => {
    const dto = { price: '6000.00' };

    it('should close the active price history and create a new one', async () => {
      const activePrice = buildPriceHistory();
      const newPrice = buildPriceHistory({ id: 'price-uuid-2', price: { value: '6000.00' } });

      mockTx.productPriceHistory.findFirst.mockResolvedValue(activePrice);
      mockTx.productPriceHistory.update.mockResolvedValue(activePrice);
      mockTx.productPriceHistory.create.mockResolvedValue(newPrice);
      mockTx.product.update.mockResolvedValue(buildProduct());

      const result = await service.registerPrice(PRODUCT_ID, USER_ID, dto as any);

      expect(result).toEqual(newPrice);
    });

    it('should close the active price history by setting effectiveTo', async () => {
      const activePrice = buildPriceHistory();
      mockTx.productPriceHistory.findFirst.mockResolvedValue(activePrice);
      mockTx.productPriceHistory.update.mockResolvedValue(activePrice);
      mockTx.productPriceHistory.create.mockResolvedValue(buildPriceHistory({ id: 'price-uuid-2' }));
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.registerPrice(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productPriceHistory.update).toHaveBeenCalledWith({
        where: { id: activePrice.id },
        data: { effectiveTo: expect.any(Date) },
      });
    });

    it('should create a new price history with the provided price', async () => {
      mockTx.productPriceHistory.findFirst.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.update.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.create.mockResolvedValue(
        buildPriceHistory({ id: 'price-uuid-2' }),
      );
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.registerPrice(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productPriceHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: PRODUCT_ID,
            price: expect.objectContaining({ value: '6000.00' }),
            changedById: USER_ID,
          }),
        }),
      );
    });

    it('should update the product with the new currentPriceId', async () => {
      const newPrice = buildPriceHistory({ id: 'price-uuid-2' });
      mockTx.productPriceHistory.findFirst.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.update.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.create.mockResolvedValue(newPrice);
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.registerPrice(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: { currentPriceId: 'price-uuid-2' },
      });
    });

    it('should not fail when there is no active price history to close', async () => {
      mockTx.productPriceHistory.findFirst.mockResolvedValue(null);
      mockTx.productPriceHistory.create.mockResolvedValue(
        buildPriceHistory({ id: 'price-uuid-2' }),
      );
      mockTx.product.update.mockResolvedValue(buildProduct());

      const result = await service.registerPrice(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productPriceHistory.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should use custom effectiveFrom when provided', async () => {
      const futureDate = '2026-08-01T00:00:00.000Z';
      mockTx.productPriceHistory.findFirst.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.update.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.create.mockResolvedValue(
        buildPriceHistory({ id: 'price-uuid-2' }),
      );
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.registerPrice(PRODUCT_ID, USER_ID, {
        price: '6000.00',
        effectiveFrom: futureDate,
      } as any);

      expect(mockTx.productPriceHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effectiveFrom: new Date(futureDate),
          }),
        }),
      );
    });

    it('should store changeReason when provided', async () => {
      mockTx.productPriceHistory.findFirst.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.update.mockResolvedValue(buildPriceHistory());
      mockTx.productPriceHistory.create.mockResolvedValue(
        buildPriceHistory({ id: 'price-uuid-2' }),
      );
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.registerPrice(PRODUCT_ID, USER_ID, {
        price: '6000.00',
        changeReason: 'Precio actualizado por inflación',
      } as any);

      expect(mockTx.productPriceHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeReason: 'Precio actualizado por inflación',
          }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // assignTaxScheme
  // -----------------------------------------------------------------------
  describe('assignTaxScheme', () => {
    const dto = { taxSchemeId: 'tax-scheme-uuid-2' };

    it('should close the active tax history and create a new one', async () => {
      const activeTax = buildTaxHistory();
      const newTax = buildTaxHistory({ id: 'tax-hist-uuid-2', taxSchemeId: 'tax-scheme-uuid-2' });

      mockTx.productTaxHistory.findFirst.mockResolvedValue(activeTax);
      mockTx.productTaxHistory.update.mockResolvedValue(activeTax);
      mockTx.productTaxHistory.create.mockResolvedValue(newTax);
      mockTx.product.update.mockResolvedValue(buildProduct());

      const result = await service.assignTaxScheme(PRODUCT_ID, USER_ID, dto as any);

      expect(result).toEqual(newTax);
    });

    it('should close the active tax history by setting effectiveTo', async () => {
      const activeTax = buildTaxHistory();
      mockTx.productTaxHistory.findFirst.mockResolvedValue(activeTax);
      mockTx.productTaxHistory.update.mockResolvedValue(activeTax);
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory({ id: 'tax-hist-uuid-2' }));
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.assignTaxScheme(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productTaxHistory.update).toHaveBeenCalledWith({
        where: { id: activeTax.id },
        data: { effectiveTo: expect.any(Date) },
      });
    });

    it('should create a new tax history with the provided tax scheme', async () => {
      mockTx.productTaxHistory.findFirst.mockResolvedValue(buildTaxHistory());
      mockTx.productTaxHistory.update.mockResolvedValue(buildTaxHistory());
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory({ id: 'tax-hist-uuid-2' }));
      mockTx.product.update.mockResolvedValue(buildProduct());

      await service.assignTaxScheme(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productTaxHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: PRODUCT_ID,
            taxSchemeId: 'tax-scheme-uuid-2',
            changedById: USER_ID,
          }),
        }),
      );
    });

    it('should not fail when there is no active tax history to close', async () => {
      mockTx.productTaxHistory.findFirst.mockResolvedValue(null);
      mockTx.productTaxHistory.create.mockResolvedValue(buildTaxHistory({ id: 'tax-hist-uuid-2' }));
      mockTx.product.update.mockResolvedValue(buildProduct());

      const result = await service.assignTaxScheme(PRODUCT_ID, USER_ID, dto as any);

      expect(mockTx.productTaxHistory.update).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // addBarcode
  // -----------------------------------------------------------------------
  describe('addBarcode', () => {
    const dto = {
      barcode: '7701234567890',
      barcodeType: 'EAN13' as const,
    };

    it('should create a non-primary barcode when isPrimary is false', async () => {
      const barcode = buildBarcode({ isPrimary: false });
      mockPrisma.productBarcode.create.mockResolvedValue(barcode);

      const result = await service.addBarcode(PRODUCT_ID, {
        ...dto,
        isPrimary: false,
      } as any);

      expect(result).toEqual(barcode);
    });

    it('should unset existing primary and create a new primary barcode in a transaction', async () => {
      const existingPrimary = buildBarcode();
      const newBarcode = buildBarcode({ id: 'barcode-uuid-2', barcode: '7709876543210' });

      mockTx.productBarcode.findFirst.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.update.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.create.mockResolvedValue(newBarcode);

      const result = await service.addBarcode(PRODUCT_ID, {
        ...dto,
        isPrimary: true,
      } as any);

      expect(result).toEqual(newBarcode);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should unset the existing primary barcode when creating a new primary', async () => {
      const existingPrimary = buildBarcode();
      mockTx.productBarcode.findFirst.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.update.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.create.mockResolvedValue(
        buildBarcode({ id: 'barcode-uuid-2' }),
      );

      await service.addBarcode(PRODUCT_ID, { ...dto, isPrimary: true } as any);

      expect(mockTx.productBarcode.update).toHaveBeenCalledWith({
        where: { id: existingPrimary.id },
        data: { isPrimary: false },
      });
    });

    it('should not fail when there is no existing primary barcode', async () => {
      mockTx.productBarcode.findFirst.mockResolvedValue(null);
      mockTx.productBarcode.create.mockResolvedValue(
        buildBarcode({ id: 'barcode-uuid-2' }),
      );

      await service.addBarcode(PRODUCT_ID, { ...dto, isPrimary: true } as any);

      expect(mockTx.productBarcode.update).not.toHaveBeenCalled();
    });

    it('should throw DuplicateBarcodeException when Prisma throws P2002', async () => {
      const prismaError = new Error('Unique constraint failed');
      (prismaError as any).code = 'P2002';
      mockPrisma.productBarcode.create.mockRejectedValue(prismaError);

      await expect(
        service.addBarcode(PRODUCT_ID, { ...dto, isPrimary: false } as any),
      ).rejects.toThrow(DuplicateBarcodeException);
    });

    it('should rethrow non-P2002 errors as-is', async () => {
      const genericError = new Error('DB connection lost');
      mockPrisma.productBarcode.create.mockRejectedValue(genericError);

      await expect(
        service.addBarcode(PRODUCT_ID, { ...dto, isPrimary: false } as any),
      ).rejects.toThrow('DB connection lost');
    });
  });

  // -----------------------------------------------------------------------
  // setPrimaryBarcode
  // -----------------------------------------------------------------------
  describe('setPrimaryBarcode', () => {
    const BARCODE_ID = 'barcode-uuid-2';

    it('should unset existing primary and set the new one in a transaction', async () => {
      const existingPrimary = buildBarcode();
      const updatedBarcode = buildBarcode({ id: BARCODE_ID, isPrimary: true });

      mockTx.productBarcode.findFirst.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.update
        .mockResolvedValueOnce(existingPrimary) // first call: unset existing
        .mockResolvedValueOnce(updatedBarcode); // second call: set new primary

      const result = await service.setPrimaryBarcode(PRODUCT_ID, BARCODE_ID);

      expect(result).toEqual(updatedBarcode);
    });

    it('should call $transaction', async () => {
      mockTx.productBarcode.findFirst.mockResolvedValue(buildBarcode());
      mockTx.productBarcode.update.mockResolvedValue(buildBarcode());

      await service.setPrimaryBarcode(PRODUCT_ID, BARCODE_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should unset the existing primary barcode', async () => {
      const existingPrimary = buildBarcode();
      mockTx.productBarcode.findFirst.mockResolvedValue(existingPrimary);
      mockTx.productBarcode.update.mockResolvedValue(buildBarcode());

      await service.setPrimaryBarcode(PRODUCT_ID, BARCODE_ID);

      expect(mockTx.productBarcode.update).toHaveBeenCalledWith({
        where: { id: existingPrimary.id },
        data: { isPrimary: false },
      });
    });

    it('should set the target barcode as primary', async () => {
      mockTx.productBarcode.findFirst.mockResolvedValue(buildBarcode());
      mockTx.productBarcode.update.mockResolvedValue(
        buildBarcode({ id: BARCODE_ID, isPrimary: true }),
      );

      await service.setPrimaryBarcode(PRODUCT_ID, BARCODE_ID);

      expect(mockTx.productBarcode.update).toHaveBeenCalledWith({
        where: { id: BARCODE_ID },
        data: { isPrimary: true },
      });
    });
  });
});
