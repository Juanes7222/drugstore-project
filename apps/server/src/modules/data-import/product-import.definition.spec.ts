// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    Decimal: class {},
    PrismaClientKnownRequestError: class extends Error {
      constructor(
        m: string,
        public code: string,
        public meta?: unknown,
      ) {
        super(m);
      }
    },
  },
  ImportSourceFormat: { CSV: 'CSV', XLSX: 'XLSX', JSON: 'JSON' },
  DataImportRowStatus: { VALID: 'VALID', ERROR: 'ERROR' },
  AuditAction: { IMPORT: 'IMPORT' },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import {
  ProductImportRow,
  ProductImportRowSchema,
} from '@pharmacy/shared-validation';
import { ProductImportDefinition } from './product-import.definition';
import { ImportRowRejectedException } from './exceptions/import-row-rejected.exception';

function buildRawProductRecord(overrides: Record<string, unknown> = {}) {
  return {
    'Codigo interno': 'P-001',
    'Nombre comercial': '  Acetaminofen 500mg  ',
    Laboratorio: 'Genfar',
    'Precio de venta': '12500.50',
    Impuesto: 'IVA 19%',
    'Tipo de venta': 'venta libre',
    'Stock minimo': '10',
    ...overrides,
  };
}

function buildValidProductRow(overrides: Record<string, unknown> = {}) {
  return ProductImportRowSchema.parse({
    internalCode: 'P-001',
    commercialName: 'Acetaminofen 500mg',
    laboratory: 'Genfar',
    saleType: 'venta libre',
    minimumStock: 10,
    initialPrice: '12500.50',
    taxSchemeName: 'IVA 19%',
    ...overrides,
  }) as ProductImportRow;
}

describe('ProductImportDefinition', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let definition: ProductImportDefinition;
  let productsService: { createProduct: jest.Mock };

  const tenantContext = { getSubscriptionId: jest.fn(() => 'sub-test') };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    productsService = { createProduct: jest.fn() };
    definition = new ProductImportDefinition(
      prisma as any,
      tenantContext as any,
      productsService as any,
    );
  });

  describe('entity metadata', () => {
    it('declares the products entity key and catalog audit module', () => {
      expect(definition.entityKey).toBe('products');
      expect(definition.entityLabel).toBe('Products');
      expect(definition.auditModule).toBe('CATALOG');
    });
  });

  describe('mapColumns', () => {
    it('maps Spanish headers with accents to canonical keys', () => {
      const { data, issues } = definition.mapColumns(buildRawProductRecord());

      expect(issues).toEqual([]);
      expect(data).toEqual({
        internalCode: 'P-001',
        commercialName: 'Acetaminofen 500mg',
        laboratory: 'Genfar',
        initialPrice: '12500.50',
        taxSchemeName: 'IVA 19%',
        saleType: 'venta libre',
        minimumStock: '10',
      });
    });

    it('ignores columns that match no alias', () => {
      const { data } = definition.mapColumns(
        buildRawProductRecord({ 'Columna extra': 'ignorada' }),
      );

      expect(data).not.toHaveProperty('Columna extra');
      expect(data).not.toHaveProperty('columnaExtra');
    });

    it('maps English aliases as well', () => {
      const { data } = definition.mapColumns({
        'internal code': 'P-002',
        commercial_name: 'Ibuprofeno',
        lab: 'MK',
        price: '8000',
        'tax scheme': 'IVA 19%',
      });

      expect(data).toEqual({
        internalCode: 'P-002',
        commercialName: 'Ibuprofeno',
        laboratory: 'MK',
        initialPrice: '8000',
        taxSchemeName: 'IVA 19%',
      });
    });

    it('normalizes placeholder values to undefined', () => {
      const { data } = definition.mapColumns(
        buildRawProductRecord({ Concentracion: '-', 'Registro INVIMA': 'n/a' }),
      );

      expect(data.concentration).toBeUndefined();
      expect(data.invimaRegistry).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('accepts a fully mapped valid row', () => {
      const outcome = definition.validate(
        definition.mapColumns(buildRawProductRecord()).data,
      );

      expect('data' in outcome).toBe(true);
      if ('data' in outcome) {
        expect(outcome.data.saleType).toBe('FREE_SALE');
        expect(outcome.data.minimumStock).toBe(10);
      }
    });

    it('resolves the saleType alias to the enum value', () => {
      const outcome = definition.validate({
        internalCode: 'P-1',
        commercialName: 'X',
        laboratory: 'L',
        initialPrice: '1000',
        taxSchemeName: 'IVA 19%',
        saleType: 'venta libre',
      });

      if (!('data' in outcome)) fail('expected a valid outcome');
      expect(outcome.data.saleType).toBe('FREE_SALE');
    });

    it('returns issues for a row missing required fields', () => {
      const outcome = definition.validate({
        commercialName: 'X',
        laboratory: 'L',
        initialPrice: '1000',
        taxSchemeName: 'IVA 19%',
      });

      expect('issues' in outcome).toBe(true);
      if ('issues' in outcome) {
        expect(
          outcome.issues.some((issue) => issue.path === 'internalCode'),
        ).toBe(true);
      }
    });

    it('returns issues for a price with comma decimal separator', () => {
      const outcome = definition.validate({
        internalCode: 'P-1',
        commercialName: 'X',
        laboratory: 'L',
        initialPrice: '12.500',
        taxSchemeName: 'IVA 19%',
      });

      expect('issues' in outcome).toBe(true);
      if ('issues' in outcome) {
        expect(
          outcome.issues.some((issue) => issue.path === 'initialPrice'),
        ).toBe(true);
      }
    });
  });

  describe('createOne', () => {
    const validRow = buildValidProductRow();

    beforeEach(() => {
      (prisma.category.findFirst as jest.Mock).mockResolvedValue({
        id: 'cat-1',
      });
      (prisma.pharmaceuticalForm.findFirst as jest.Mock).mockResolvedValue({
        id: 'form-1',
      });
      (prisma.taxScheme.findFirst as jest.Mock).mockResolvedValue({
        id: 'tax-1',
      });
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
    });

    it('creates the product through ProductsService with resolved references', async () => {
      const result = await definition.createOne(
        { userId: 'user-1' },
        buildValidProductRow({
          categoryName: 'Analgesicos',
          pharmaceuticalFormName: 'Tabletas',
          initialCost: '8000.25',
        }),
      );

      expect(result).toEqual({ id: 'prod-1' });
      expect(prisma.category.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-test',
          name: { equals: 'Analgesicos', mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true },
      });
      expect(productsService.createProduct).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          internalCode: 'P-001',
          commercialName: 'Acetaminofen 500mg',
          laboratory: 'Genfar',
          saleType: 'FREE_SALE',
          minimumStock: 10,
          initialPrice: '12500.50',
          initialCost: '8000.25',
          categoryId: 'cat-1',
          pharmaceuticalFormId: 'form-1',
          initialTaxSchemeId: 'tax-1',
        }),
      );
    });

    it('skips category and form lookups when names are absent', async () => {
      await definition.createOne({ userId: 'user-1' }, validRow);

      expect(prisma.category.findFirst).not.toHaveBeenCalled();
      expect(prisma.pharmaceuticalForm.findFirst).not.toHaveBeenCalled();
      expect(productsService.createProduct).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          categoryId: undefined,
          pharmaceuticalFormId: undefined,
          initialTaxSchemeId: 'tax-1',
        }),
      );
    });

    it('throws ImportRowRejectedException when the category does not exist', async () => {
      (prisma.category.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        definition.createOne(
          { userId: 'user-1' },
          buildValidProductRow({ categoryName: 'No existe' }),
        ),
      ).rejects.toThrow(ImportRowRejectedException);
    });

    it('throws ImportRowRejectedException when the pharmaceutical form does not exist', async () => {
      (prisma.pharmaceuticalForm.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        definition.createOne(
          { userId: 'user-1' },
          buildValidProductRow({ pharmaceuticalFormName: 'No existe' }),
        ),
      ).rejects.toThrow(ImportRowRejectedException);
    });

    it('throws ImportRowRejectedException when the tax scheme does not exist', async () => {
      (prisma.taxScheme.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        definition.createOne({ userId: 'user-1' }, validRow),
      ).rejects.toThrow(ImportRowRejectedException);
    });

    it('uses pre-resolved refs from prepare without lazy lookups', async () => {
      const result = await definition.createOne(
        { userId: 'user-1' },
        buildValidProductRow({
          categoryName: 'Analgesicos',
          pharmaceuticalFormName: 'Tabletas',
          initialCost: '8000.25',
        }),
        {
          categoryId: 'cat-9',
          pharmaceuticalFormId: 'form-9',
          taxSchemeId: 'tax-9',
        },
      );

      expect(result).toEqual({ id: 'prod-1' });
      expect(prisma.category.findFirst).not.toHaveBeenCalled();
      expect(prisma.pharmaceuticalForm.findFirst).not.toHaveBeenCalled();
      expect(prisma.taxScheme.findFirst).not.toHaveBeenCalled();
      expect(productsService.createProduct).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          categoryId: 'cat-9',
          pharmaceuticalFormId: 'form-9',
          initialTaxSchemeId: 'tax-9',
        }),
      );
    });

    it('rejects with the category message when prepare resolved no category id', async () => {
      await expect(
        definition.createOne(
          { userId: 'user-1' },
          buildValidProductRow({ categoryName: 'No existe' }),
          {
            categoryId: undefined,
            pharmaceuticalFormId: undefined,
            taxSchemeId: 'tax-1',
          },
        ),
      ).rejects.toThrow('La categoria "No existe" no existe en el sistema');
    });

    it('rejects with the tax scheme message when prepare resolved no tax scheme id', async () => {
      await expect(
        definition.createOne({ userId: 'user-1' }, buildValidProductRow(), {
          categoryId: undefined,
          pharmaceuticalFormId: undefined,
          taxSchemeId: undefined,
        }),
      ).rejects.toThrow(
        'No se encontro el esquema de impuesto "IVA 19%" en el sistema',
      );
    });
  });

  describe('prepare', () => {
    it('resolves unique names in batch with insensitive matching and maps by lowercase name', async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValue([
        { id: 'cat-1', name: 'Analgesicos' },
      ]);
      (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue([
        { id: 'form-1', name: 'Tabletas' },
      ]);
      (prisma.taxScheme.findMany as jest.Mock).mockResolvedValue([
        { id: 'tax-1', name: 'IVA 19%' },
      ]);

      const refs = await definition.prepare({ userId: 'user-1' }, [
        {
          rowNumber: 2,
          data: buildValidProductRow({
            internalCode: 'P-001',
            categoryName: 'ANALGESICOS',
            pharmaceuticalFormName: 'Tabletas',
          }),
        },
        { rowNumber: 3, data: buildValidProductRow({ internalCode: 'P-002' }) },
      ]);

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-test',
          name: { in: ['ANALGESICOS'], mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true, name: true },
      });
      expect(prisma.pharmaceuticalForm.findMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-test',
          name: { in: ['Tabletas'], mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true, name: true },
      });
      expect(prisma.taxScheme.findMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-test',
          name: { in: ['IVA 19%'], mode: 'insensitive' },
          isActive: true,
        },
        select: { id: true, name: true },
      });
      expect(refs.get(2)).toEqual({
        categoryId: 'cat-1',
        pharmaceuticalFormId: 'form-1',
        taxSchemeId: 'tax-1',
      });
      expect(refs.get(3)).toEqual({
        categoryId: undefined,
        pharmaceuticalFormId: undefined,
        taxSchemeId: 'tax-1',
      });
    });

    it('returns undefined refs for a row without a category name', async () => {
      (prisma.category.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.taxScheme.findMany as jest.Mock).mockResolvedValue([
        { id: 'tax-1', name: 'IVA 19%' },
      ]);

      const refs = await definition.prepare({ userId: 'user-1' }, [
        {
          rowNumber: 2,
          data: buildValidProductRow({ categoryName: undefined }),
        },
      ]);

      expect(refs.get(2)).toEqual({
        categoryId: undefined,
        pharmaceuticalFormId: undefined,
        taxSchemeId: 'tax-1',
      });
    });
  });

  describe('findConflicts', () => {
    it('reports rows whose internalCode already exists', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { internalCode: 'P-001' },
      ]);

      const conflicts = await definition.findConflicts(
        { subscriptionId: 'sub-test' },
        [
          {
            rowNumber: 2,
            data: buildValidProductRow({ internalCode: 'P-001' }),
          },
          {
            rowNumber: 3,
            data: buildValidProductRow({ internalCode: 'P-002' }),
          },
        ],
      );

      expect(conflicts.size).toBe(1);
      expect(conflicts.get(2)).toEqual([
        {
          path: 'internalCode',
          message: 'El codigo interno "P-001" ya existe en el sistema',
        },
      ]);
      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: { internalCode: { in: ['P-001', 'P-002'] } },
        select: { internalCode: true },
      });
    });

    it('returns an empty map when no code exists', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);

      const conflicts = await definition.findConflicts(
        { subscriptionId: 'sub-test' },
        [{ rowNumber: 2, data: buildValidProductRow() }],
      );

      expect(conflicts.size).toBe(0);
    });
  });
});
