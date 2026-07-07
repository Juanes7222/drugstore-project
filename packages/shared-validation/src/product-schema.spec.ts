import { ProductSchema } from './product-schema';

describe('ProductSchema', () => {
  const validProduct = {
    name: 'Acetaminofén 500mg',
    genericName: 'Paracetamol',
    barcode: '7701234567890',
    invimaCertificate: 'INVIMA-2024-001234',
    saleType: 'FREE_SALE' as const,
    requiresPrescription: false,
    currentStock: 100,
    minimumStock: 10,
    purchasePrice: '800.00',
    sellingPrice: '1500.00',
    taxPercentage: '19.00',
    expirationDate: '2025-12-31T00:00:00.000Z',
  };

  describe('when input is valid', () => {
    it('should accept a complete product', () => {
      const result = ProductSchema.parse(validProduct);
      expect(result.name).toBe('Acetaminofén 500mg');
      expect(result.currentStock).toBe(100);
    });
  });

  describe('when name is invalid', () => {
    it('should reject empty name', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, name: '' }),
      ).toThrow();
    });

    it('should reject name exceeding 255 characters', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, name: 'x'.repeat(256) }),
      ).toThrow();
    });
  });

  describe('when genericName is invalid', () => {
    it('should reject empty genericName', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, genericName: '' }),
      ).toThrow();
    });
  });

  describe('when stock is invalid', () => {
    it('should reject negative currentStock', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, currentStock: -1 }),
      ).toThrow();
    });

    it('should reject non-integer currentStock', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, currentStock: 10.5 }),
      ).toThrow();
    });
  });

  describe('when price format is invalid', () => {
    it('should accept purchasePrice without decimals (regex allows optional decimals)', () => {
      const result = ProductSchema.parse({
        ...validProduct,
        purchasePrice: '800',
      });
      expect(result.purchasePrice).toBe('800');
    });

    it('should reject sellingPrice with letters', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, sellingPrice: 'abc' }),
      ).toThrow();
    });
  });

  describe('when saleType is invalid', () => {
    it('should reject unknown sale type', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, saleType: 'INVALID' }),
      ).toThrow();
    });
  });

  describe('when expirationDate is invalid', () => {
    it('should reject non-datetime string', () => {
      expect(() =>
        ProductSchema.parse({ ...validProduct, expirationDate: 'not-a-date' }),
      ).toThrow();
    });
  });
});
