import { CreateSaleSchema } from './create-sale-schema';

describe('CreateSaleSchema', () => {
  const validSale = {
    saleType: 'FREE_SALE' as const,
    cashShiftId: '550e8400-e29b-41d4-a716-446655440000',
    items: [
      {
        productId: '550e8400-e29b-41d4-a716-446655440001',
        quantity: 2,
        unitPrice: '5000.00',
      },
    ],
  };

  describe('when input is valid', () => {
    it('should accept a sale with one item', () => {
      const result = CreateSaleSchema.parse(validSale);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(2);
    });

    it('should accept a sale with multiple items', () => {
      const result = CreateSaleSchema.parse({
        ...validSale,
        items: [
          ...validSale.items,
          {
            productId: '550e8400-e29b-41d4-a716-446655440002',
            quantity: 1,
            unitPrice: '3000.00',
          },
        ],
      });
      expect(result.items).toHaveLength(2);
    });

    it('should accept sale with optional clientId', () => {
      const result = CreateSaleSchema.parse({
        ...validSale,
        clientId: '550e8400-e29b-41d4-a716-446655440003',
      });
      expect(result.clientId).toBe(
        '550e8400-e29b-41d4-a716-446655440003',
      );
    });

    it('should accept sale with optional prescription number', () => {
      const result = CreateSaleSchema.parse({
        ...validSale,
        prescriptionNumber: 'RX-2024-001',
      });
      expect(result.prescriptionNumber).toBe('RX-2024-001');
    });

    it('should accept sale with discount on item', () => {
      const result = CreateSaleSchema.parse({
        ...validSale,
        items: [
          {
            productId: '550e8400-e29b-41d4-a716-446655440001',
            quantity: 1,
            unitPrice: '5000.00',
            discount: '500.00',
          },
        ],
      });
      expect(result.items[0].discount).toBe('500.00');
    });
  });

  describe('when items are invalid', () => {
    it('should reject sale without items', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [],
        }),
      ).toThrow();
    });

    it('should reject item with negative quantity', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: '550e8400-e29b-41d4-a716-446655440001',
              quantity: -1,
              unitPrice: '5000.00',
            },
          ],
        }),
      ).toThrow();
    });

    it('should reject item with zero quantity', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: '550e8400-e29b-41d4-a716-446655440001',
              quantity: 0,
              unitPrice: '5000.00',
            },
          ],
        }),
      ).toThrow();
    });

    it('should reject item with non-integer quantity', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: '550e8400-e29b-41d4-a716-446655440001',
              quantity: 1.5,
              unitPrice: '5000.00',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('when price format is invalid', () => {
    it('should reject item with non-numeric unitPrice', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: '550e8400-e29b-41d4-a716-446655440001',
              quantity: 1,
              unitPrice: 'abc',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('when productId is invalid', () => {
    it('should reject item with non-uuid productId', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: 'not-a-uuid',
              quantity: 1,
              unitPrice: '5000.00',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('when cashShiftId is invalid', () => {
    it('should reject sale with non-uuid cashShiftId', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          cashShiftId: 'not-a-uuid',
        }),
      ).toThrow();
    });
  });

  describe('when saleType is invalid', () => {
    it('should reject unknown saleType', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          saleType: 'INVALID',
        }),
      ).toThrow();
    });
  });

  describe('when discount format is invalid', () => {
    it('should reject item with non-numeric discount', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          items: [
            {
              productId: '550e8400-e29b-41d4-a716-446655440001',
              quantity: 1,
              unitPrice: '5000.00',
              discount: 'abc',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('when clientId format is invalid', () => {
    it('should reject sale with non-uuid clientId', () => {
      expect(() =>
        CreateSaleSchema.parse({
          ...validSale,
          clientId: 'not-a-uuid',
        }),
      ).toThrow();
    });
  });
});
