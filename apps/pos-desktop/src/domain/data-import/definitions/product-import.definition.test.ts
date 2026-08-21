/**
 * Unit tests for ProductImportDefinition: alias mapping, shared-schema
 * validation (Spanish aliases for saleType, price regex), reference
 * resolution, per-row rejection messages, and conflict detection.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProductImportRow } from "@pharmacy/shared-validation";
import { ProductImportDefinition } from "./product-import.definition";
import { ImportRowRejectedException } from "../exceptions";
import { UnsyncedReferenceException } from "../../catalog/exceptions";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  product: { findMany: vi.fn() },
  category: { findFirst: vi.fn() },
  pharmaceuticalForm: { findFirst: vi.fn() },
  taxScheme: { findFirst: vi.fn() },
});

const makeMockProductService = () => ({
  createProduct: vi.fn(),
});

const makeValidRow = (
  overrides: Partial<ProductImportRow> = {},
): ProductImportRow => ({
  internalCode: "P001",
  commercialName: "Acetaminofen 500mg",
  laboratory: "Genfar",
  concentration: "500",
  concentrationUnit: "mg",
  saleType: "FREE_SALE",
  minimumStock: 10,
  invimaRegistry: "INVIMA 2019M-0000000",
  atcCode: "N02BE01",
  categoryName: "Analgesicos",
  pharmaceuticalFormName: "Tableta",
  initialPrice: "12500.50",
  initialCost: "8000.00",
  taxSchemeName: "IVA 19%",
  ...overrides,
});

describe("ProductImportDefinition", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let productService: ReturnType<typeof makeMockProductService>;
  let definition: ProductImportDefinition;

  beforeEach(() => {
    prisma = makeMockPrisma();
    productService = makeMockProductService();
    definition = new ProductImportDefinition(
      prisma as never,
      productService as never,
    );
  });

  describe("mapColumns", () => {
    it("maps aliases to canonical keys and ignores unknown headers", () => {
      const { data } = definition.mapColumns({
        "Código interno": "P001",
        "Nombre Comercial": "Acetaminofen",
        Precio: "12500.50",
        nota: "ignored",
      });

      expect(data).toEqual({
        internalCode: "P001",
        commercialName: "Acetaminofen",
        initialPrice: "12500.50",
      });
    });

    it("normalizes placeholder cell values to undefined", () => {
      const { data } = definition.mapColumns({
        "Codigo interno": "P001",
        "Registro INVIMA": "-",
        "Codigo ATC": "",
      });

      expect(data.invimaRegistry).toBeUndefined();
      expect(data.atcCode).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("accepts a fully valid row", () => {
      const outcome = definition.validate({
        internalCode: "P001",
        commercialName: "Acetaminofen",
        laboratory: "Genfar",
        initialPrice: "12500.50",
        taxSchemeName: "IVA 19%",
      });

      expect("data" in outcome).toBe(true);
      if ("data" in outcome) {
        expect(outcome.data).toMatchObject({
          internalCode: "P001",
          saleType: "FREE_SALE",
          minimumStock: 0,
        });
      }
    });

    it("maps Spanish saleType aliases to the enum values", () => {
      const libre = definition.validate({
        ...validRowFields(),
        saleType: "libre",
      });
      const controlado = definition.validate({
        ...validRowFields(),
        saleType: "controlado",
      });
      expect("data" in libre && libre.data.saleType).toBe("FREE_SALE");
      expect("data" in controlado && controlado.data.saleType).toBe(
        "CONTROLLED_SUBSTANCE",
      );
    });

    it("rejects a price with a thousand separator or comma decimal", () => {
      const thousand = definition.validate({
        ...validRowFields(),
        initialPrice: "12.500",
      });
      const comma = definition.validate({
        ...validRowFields(),
        initialPrice: "12500,50",
      });
      expect("issues" in thousand).toBe(true);
      expect("issues" in comma).toBe(true);
    });

    it("rejects a row missing required fields", () => {
      const outcome = definition.validate({
        commercialName: "Acetaminofen",
        initialPrice: "12500.50",
      });
      expect("issues" in outcome).toBe(true);
      if ("issues" in outcome) {
        expect(outcome.issues.some((issue) => issue.path === "internalCode")).toBe(
          true,
        );
      }
    });
  });

  describe("createOne", () => {
    beforeEach(() => {
      prisma.category.findFirst.mockResolvedValue({ id: "cat-1" });
      prisma.pharmaceuticalForm.findFirst.mockResolvedValue({ id: "form-1" });
      prisma.taxScheme.findFirst.mockResolvedValue({ id: "tax-1" });
      productService.createProduct.mockResolvedValue({ id: "prod-1" });
    });

    it("resolves references case-insensitively and only for active rows", async () => {
      await definition.createOne(makeValidRow());

      expect(prisma.category.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: "Analgesicos", mode: "insensitive" }, isActive: true },
        select: { id: true },
      });
      expect(prisma.pharmaceuticalForm.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: "Tableta", mode: "insensitive" }, isActive: true },
        select: { id: true },
      });
      expect(prisma.taxScheme.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: "IVA 19%", mode: "insensitive" }, isActive: true },
        select: { id: true },
      });
    });

    it("writes through ProductService with empty barcodes and price/tax history", async () => {
      const created = await definition.createOne(makeValidRow());

      expect(productService.createProduct).toHaveBeenCalledWith({
        commercialName: "Acetaminofen 500mg",
        concentration: "500",
        concentrationUnit: "mg",
        laboratory: "Genfar",
        saleType: "FREE_SALE",
        minimumStock: 10,
        invimaRegistry: "INVIMA 2019M-0000000",
        atcCode: "N02BE01",
        categoryId: "cat-1",
        pharmaceuticalFormId: "form-1",
        price: { price: "12500.50", changeReason: "Initial price from import" },
        tax: { taxSchemeId: "tax-1", changeReason: "Initial tax from import" },
        initialCost: {
          cost: "8000.00",
          changeReason: "Initial cost from import",
        },
        barcodes: [],
      });
      expect(created).toEqual({ id: "prod-1" });
    });

    it("omits cost history when the row has no initial cost", async () => {
      await definition.createOne(makeValidRow({ initialCost: undefined }));
      const input = productService.createProduct.mock.calls[0][0];
      expect(input.initialCost).toBeUndefined();
    });

    it("rejects when the category does not exist", async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        ImportRowRejectedException,
      );
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        'La categoria "Analgesicos" no existe en el sistema',
      );
      expect(productService.createProduct).not.toHaveBeenCalled();
    });

    it("rejects when the pharmaceutical form does not exist", async () => {
      prisma.pharmaceuticalForm.findFirst.mockResolvedValue(null);
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        'La forma farmaceutica "Tableta" no existe en el sistema',
      );
    });

    it("rejects when the tax scheme does not exist", async () => {
      prisma.taxScheme.findFirst.mockResolvedValue(null);
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        'No se encontro el esquema de impuesto "IVA 19%" en el sistema',
      );
    });

    it("converts an unsynced local-seed reference into a Spanish row rejection", async () => {
      productService.createProduct.mockRejectedValue(
        new UnsyncedReferenceException("taxScheme", "seed-1", "local_seed_id"),
      );
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        ImportRowRejectedException,
      );
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        'El esquema de impuesto "IVA 19%" no esta sincronizado con el servidor',
      );
    });

    it("rethrows non-seed unsynced references untouched", async () => {
      const original = new UnsyncedReferenceException(
        "taxScheme",
        "tax-1",
        "not_in_local_cache",
      );
      productService.createProduct.mockRejectedValue(original);
      await expect(definition.createOne(makeValidRow())).rejects.toThrow(
        UnsyncedReferenceException,
      );
    });
  });

  describe("findConflicts", () => {
    it("flags duplicate internal codes inside the file, keeping the first row", async () => {
      prisma.product.findMany.mockResolvedValue([]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
        { rowNumber: 3, data: makeValidRow({ internalCode: "P001" }) },
      ]);

      expect(conflicts.has(2)).toBe(false);
      expect(conflicts.get(3)).toEqual([
        {
          path: "internalCode",
          message: 'El codigo interno "P001" se repite en el archivo (fila 2)',
        },
      ]);
    });

    it("flags codes that already exist in the database", async () => {
      prisma.product.findMany.mockResolvedValue([{ internalCode: "P001" }]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
      ]);

      expect(conflicts.get(2)).toEqual([
        {
          path: "internalCode",
          message: 'El codigo interno "P001" ya existe en el sistema',
        },
      ]);
    });

    it("returns an empty map when there are no conflicts", async () => {
      prisma.product.findMany.mockResolvedValue([]);
      const conflicts = await definition.findConflicts([
        { rowNumber: 2, data: makeValidRow() },
      ]);
      expect(conflicts.size).toBe(0);
    });
  });
});

function validRowFields(): Record<string, unknown> {
  return {
    internalCode: "P001",
    commercialName: "Acetaminofen",
    laboratory: "Genfar",
    initialPrice: "12500.50",
    taxSchemeName: "IVA 19%",
  };
}
