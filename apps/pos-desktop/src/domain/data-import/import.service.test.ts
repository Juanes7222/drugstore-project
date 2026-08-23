/**
 * Unit tests for ImportService orchestration: preview validation flow,
 * execute write flow, role gates, conflict re-checks, per-row rejections,
 * history persistence, write-lock discipline, and XLSX template catalog
 * loading. The parsers are mocked at the module boundary; the real import
 * definitions run against a mocked Prisma client and mocked domain services.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { RoleType } from "@pharmacy/shared-types";
import {
  createImportService,
  type ImportService,
  type ImportServiceDeps,
} from "./import.service";
import {
  ImportExecutionFailedException,
  ImportFileInvalidException,
  ImportRowRejectedException,
  ImportValidationFailedException,
} from "./exceptions";
import {
  InsufficientRoleException,
  NoActiveSessionException,
} from "../auth/exceptions";
import { dbWriteLock } from "../../infrastructure/write-lock";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockParseImportFile } = vi.hoisted(() => ({
  mockParseImportFile: vi.fn(),
}));

vi.mock("./parsers", () => ({ parseImportFile: mockParseImportFile }));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const PRODUCT_HEADERS = [
  "Codigo interno",
  "Nombre comercial",
  "Laboratorio",
  "Precio",
  "Impuesto",
];

const makeProductRow = (internalCode: string): Record<string, unknown> => ({
  "Codigo interno": internalCode,
  "Nombre comercial": `Producto ${internalCode}`,
  Laboratorio: "Genfar",
  Precio: "12500.50",
  Impuesto: "IVA 19%",
});

const CLIENT_HEADERS = [
  "Nombre completo",
  "Tipo de documento",
  "Numero de documento",
];

const makeClientRow = (identificationNumber: string): Record<string, unknown> => ({
  "Nombre completo": "Juan Perez",
  "Tipo de documento": "CC",
  "Numero de documento": identificationNumber,
});

const makeMockPrisma = () => ({
  product: { findMany: vi.fn().mockResolvedValue([]) },
  category: {
    findFirst: vi.fn().mockResolvedValue({ id: "cat-1" }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  pharmaceuticalForm: {
    findFirst: vi.fn().mockResolvedValue({ id: "form-1" }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  taxScheme: {
    findFirst: vi.fn().mockResolvedValue({ id: "tax-1" }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  client: { findMany: vi.fn().mockResolvedValue([]) },
});

const makeMockAuth = () => ({
  requireRole: vi.fn().mockReturnValue({ userId: "user-1" }),
});

const makeMockProductService = () => ({
  createProduct: vi.fn().mockResolvedValue({ id: "prod-1" }),
});

const makeMockClientsService = () => ({
  create: vi.fn().mockResolvedValue({ id: "client-1" }),
});

const mockFile = (name = "productos.csv"): { fileName: string; data: ArrayBuffer } => ({
  fileName: name,
  data: new ArrayBuffer(16),
});

const mockTable = (
  headers: string[],
  rows: Array<Record<string, unknown>>,
  warnings: string[] = [],
) => ({
  format: "CSV" as const,
  table: { headers, rows, warnings },
});

describe("ImportService", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let auth: ReturnType<typeof makeMockAuth>;
  let productService: ReturnType<typeof makeMockProductService>;
  let clientsService: ReturnType<typeof makeMockClientsService>;
  let service: ImportService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    auth = makeMockAuth();
    productService = makeMockProductService();
    clientsService = makeMockClientsService();
    service = createImportService({
      prisma,
      auth,
      productService,
      clientsService,
    } as unknown as ImportServiceDeps);
    vi.clearAllMocks();
    localStorage.clear();
    auth.requireRole.mockReturnValue({ userId: "user-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Role gates
  // -------------------------------------------------------------------------

  describe("role gates", () => {
    it("requires INVENTORY_ASSISTANT or ADMIN for products previews", async () => {
      mockParseImportFile.mockResolvedValue(mockTable(PRODUCT_HEADERS, []));
      await service.preview("products", mockFile());

      expect(auth.requireRole).toHaveBeenCalledWith(
        RoleType.INVENTORY_ASSISTANT,
        RoleType.ADMIN,
      );
    });

    it("requires CASHIER or ADMIN for clients previews", async () => {
      mockParseImportFile.mockResolvedValue(mockTable(CLIENT_HEADERS, []));
      await service.preview("clients", mockFile("clientes.csv"));

      expect(auth.requireRole).toHaveBeenCalledWith(RoleType.CASHIER, RoleType.ADMIN);
    });

    it("propagates NO_ACTIVE_SESSION from the auth layer", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new NoActiveSessionException();
      });
      await expect(service.preview("products", mockFile())).rejects.toBeInstanceOf(
        NoActiveSessionException,
      );
    });

    it("propagates INSUFFICIENT_ROLE from the auth layer", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new InsufficientRoleException(RoleType.INVENTORY_ASSISTANT);
      });
      await expect(service.preview("clients", mockFile())).rejects.toBeInstanceOf(
        InsufficientRoleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // preview
  // -------------------------------------------------------------------------

  describe("preview", () => {
    it("rejects an empty buffer as a file-level error", async () => {
      await expect(
        service.preview("products", { fileName: "empty.csv", data: new ArrayBuffer(0) }),
      ).rejects.toBeInstanceOf(ImportFileInvalidException);
      expect(mockParseImportFile).not.toHaveBeenCalled();
    });

    it("rejects files over the row limit", async () => {
      const rows = Array.from({ length: 5001 }, (_, i) => makeProductRow(`P${i}`));
      mockParseImportFile.mockResolvedValue(mockTable(PRODUCT_HEADERS, rows));

      await expect(service.preview("products", mockFile())).rejects.toBeInstanceOf(
        ImportFileInvalidException,
      );
      await expect(service.preview("products", mockFile())).rejects.toThrow(
        /maximum allowed is 5000/,
      );
    });

    it("rejects files missing required columns by label", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(["Nombre comercial"], [makeProductRow("P001")]),
      );

      await expect(service.preview("products", mockFile())).rejects.toBeInstanceOf(
        ImportFileInvalidException,
      );
      await expect(service.preview("products", mockFile())).rejects.toThrow(
        /Missing required columns: Codigo interno, Laboratorio, Precio de venta, Impuesto/,
      );
    });

    it("reports per-row schema errors with row numbers counting from the header", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [
          makeProductRow("P001"),
          { ...makeProductRow("P002"), "Codigo interno": "" },
        ]),
      );

      const result = await service.preview("products", mockFile());

      expect(result.totalRows).toBe(2);
      expect(result.validRows).toBe(1);
      expect(result.errorRows).toBe(1);
      expect(result.errors).toEqual([
        { rowNumber: 3, issues: expect.any(Array) as never },
      ]);
      expect(result.errors[0].issues[0].path).toBe("internalCode");
      expect(result.validSample).toEqual([{ rowNumber: 2, data: expect.anything() }]);
    });

    it("caps the valid sample at five rows", async () => {
      const rows = Array.from({ length: 8 }, (_, i) => makeProductRow(`P${i}`));
      mockParseImportFile.mockResolvedValue(mockTable(PRODUCT_HEADERS, rows));

      const result = await service.preview("products", mockFile());

      expect(result.validRows).toBe(8);
      expect(result.validSample).toHaveLength(5);
    });

    it("excludes conflicted rows from the valid sample and reports them as errors", async () => {
      prisma.product.findMany.mockResolvedValue([{ internalCode: "P001" }]);
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001"), makeProductRow("P002")]),
      );

      const result = await service.preview("products", mockFile());

      expect(result.validRows).toBe(1);
      expect(result.errorRows).toBe(1);
      expect(result.errors[0].issues[0].message).toBe(
        'El codigo interno "P001" ya existe en el sistema',
      );
      expect(result.validSample[0].data).toMatchObject({ internalCode: "P002" });
    });

    it("reports unmatched headers and passes parser warnings through", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(
          [...PRODUCT_HEADERS, "Nota"],
          [makeProductRow("P001")],
          ["CSV parse issue: bad quote"],
        ),
      );

      const result = await service.preview("products", mockFile());

      expect(result.unmatchedHeaders).toEqual(["Nota"]);
      expect(result.warnings).toEqual(["CSV parse issue: bad quote"]);
    });

    it("writes nothing during a preview", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001")]),
      );
      await service.preview("products", mockFile());

      expect(productService.createProduct).not.toHaveBeenCalled();
      expect(service.listHistory()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("writes valid rows through the domain service and records history", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001")]),
      );

      const result = await service.execute("products", mockFile());

      expect(productService.createProduct).toHaveBeenCalledTimes(1);
      expect(result.validRows).toBe(1);
      expect(result.errorRows).toBe(0);
      expect(result.importId).toMatch(/^[0-9a-f-]{36}$/);
      expect(service.getHistory(result.importId)).toMatchObject({
        entityKey: "products",
        fileName: "productos.csv",
        validRows: 1,
        errorRows: 0,
        createdByUserId: "user-1",
      });
    });

    it("aborts with ImportValidationFailedException when any row has schema errors", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [
          makeProductRow("P001"),
          { ...makeProductRow("P002"), "Codigo interno": "" },
        ]),
      );

      await expect(service.execute("products", mockFile())).rejects.toBeInstanceOf(
        ImportValidationFailedException,
      );
      expect(productService.createProduct).not.toHaveBeenCalled();
      expect(service.listHistory()).toEqual([]);
    });

    it("does not acquire the write lock when validation aborts", async () => {
      const acquire = vi.spyOn(dbWriteLock, "acquire");
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [{ ...makeProductRow("P001"), Precio: "mal" }]),
      );

      await expect(service.execute("products", mockFile())).rejects.toBeInstanceOf(
        ImportValidationFailedException,
      );
      expect(acquire).not.toHaveBeenCalled();
    });

    it("re-checks conflicts at execution time and skips newly-conflicting rows", async () => {
      prisma.product.findMany.mockResolvedValue([{ internalCode: "P001" }]);
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001"), makeProductRow("P002")]),
      );

      const result = await service.execute("products", mockFile());

      expect(productService.createProduct).toHaveBeenCalledTimes(1);
      expect(result.validRows).toBe(1);
      expect(result.errorRows).toBe(1);
      expect(result.errors[0].issues[0].message).toBe(
        'El codigo interno "P001" ya existe en el sistema',
      );
    });

    it("records ImportRowRejectedException rows as errors and continues", async () => {
      productService.createProduct
        .mockResolvedValueOnce({ id: "prod-1" })
        .mockRejectedValueOnce(
          new ImportRowRejectedException('La categoria "X" no existe en el sistema'),
        )
        .mockResolvedValueOnce({ id: "prod-3" });
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [
          makeProductRow("P001"),
          makeProductRow("P002"),
          makeProductRow("P003"),
        ]),
      );

      const result = await service.execute("products", mockFile());

      expect(productService.createProduct).toHaveBeenCalledTimes(3);
      expect(result.validRows).toBe(2);
      expect(result.errorRows).toBe(1);
      expect(result.errors).toEqual([
        {
          rowNumber: 3,
          issues: [
            { path: "row", message: 'La categoria "X" no existe en el sistema' },
          ],
        },
      ]);
    });

    it("wraps unexpected errors in ImportExecutionFailedException", async () => {
      productService.createProduct.mockRejectedValue(new Error("disk full"));
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001")]),
      );

      await expect(service.execute("products", mockFile())).rejects.toBeInstanceOf(
        ImportExecutionFailedException,
      );
      await expect(service.execute("products", mockFile())).rejects.toThrow(
        "disk full",
      );
    });

    it("caps persisted execution errors at the payload limit", async () => {
      productService.createProduct.mockRejectedValue(
        new ImportRowRejectedException("rejected"),
      );
      const rows = Array.from({ length: 60 }, (_, i) => makeProductRow(`P${i}`));
      mockParseImportFile.mockResolvedValue(mockTable(PRODUCT_HEADERS, rows));

      const result = await service.execute("products", mockFile());

      expect(result.errorRows).toBe(60);
      expect(result.errors).toHaveLength(50);
      const history = service.getHistory(result.importId);
      expect(history?.errors).toHaveLength(50);
    });

    it("acquires and releases the write lock around the run", async () => {
      const acquire = vi.spyOn(dbWriteLock, "acquire");
      const release = vi.spyOn(dbWriteLock, "release");
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001")]),
      );

      await service.execute("products", mockFile());

      expect(acquire).toHaveBeenCalledWith("foreground");
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases the write lock when a row write fails unexpectedly", async () => {
      const release = vi.spyOn(dbWriteLock, "release");
      productService.createProduct.mockRejectedValue(new Error("boom"));
      mockParseImportFile.mockResolvedValue(
        mockTable(PRODUCT_HEADERS, [makeProductRow("P001")]),
      );

      await expect(service.execute("products", mockFile())).rejects.toBeInstanceOf(
        ImportExecutionFailedException,
      );
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("executes client imports through ClientsService", async () => {
      mockParseImportFile.mockResolvedValue(
        mockTable(CLIENT_HEADERS, [makeClientRow("123456789")]),
      );

      const result = await service.execute("clients", mockFile("clientes.csv"));

      expect(clientsService.create).toHaveBeenCalledTimes(1);
      expect(result.entityKey).toBe("clients");
      expect(result.validRows).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // buildTemplate
  // -------------------------------------------------------------------------

  describe("buildTemplate", () => {
    it("applies the role gate and builds a CSV template", async () => {
      const template = await service.buildTemplate("products", "CSV");

      expect(auth.requireRole).toHaveBeenCalledWith(
        RoleType.INVENTORY_ASSISTANT,
        RoleType.ADMIN,
      );
      expect(typeof template).toBe("string");
      expect((template as string).startsWith("\uFEFF")).toBe(true);
    });

    it("queries active product catalogs for the XLSX products template and passes their names through", async () => {
      prisma.category.findMany.mockResolvedValue([
        { name: "Analgesicos" },
        { name: "Antibioticos" },
      ]);
      prisma.pharmaceuticalForm.findMany.mockResolvedValue([
        { name: "Tableta" },
      ]);
      prisma.taxScheme.findMany.mockResolvedValue([
        { name: "IVA 19%" },
        { name: "Exento" },
      ]);

      const template = (await service.buildTemplate(
        "products",
        "XLSX",
      )) as ArrayBuffer;

      const findManyArgs = {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { name: true },
      };
      expect(prisma.category.findMany).toHaveBeenCalledWith(findManyArgs);
      expect(prisma.pharmaceuticalForm.findMany).toHaveBeenCalledWith(
        findManyArgs,
      );
      expect(prisma.taxScheme.findMany).toHaveBeenCalledWith(findManyArgs);

      // The loaded names land in the hidden catalog sheet, in link order.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(template);
      const catalogSheet = workbook.getWorksheet("_Catalogos");

      const headerValues = (catalogSheet!.getRow(1).values ?? []) as unknown[];
      expect(headerValues.slice(1)).toEqual([
        "Categoria",
        "Forma farmaceutica",
        "Impuesto",
      ]);
      expect(catalogSheet!.getCell(3, 1).value).toBe("Antibioticos");
      expect(catalogSheet!.getCell(2, 2).value).toBe("Tableta");
      expect(catalogSheet!.getCell(2, 3).value).toBe("IVA 19%");
    });

    it("does not query catalogs for client templates", async () => {
      const template = await service.buildTemplate("clients", "XLSX");

      expect(prisma.category.findMany).not.toHaveBeenCalled();
      expect(prisma.pharmaceuticalForm.findMany).not.toHaveBeenCalled();
      expect(prisma.taxScheme.findMany).not.toHaveBeenCalled();

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(template as ArrayBuffer);
      expect(workbook.getWorksheet("_Catalogos")).toBeUndefined();
    });

    it("does not query catalogs for CSV templates", async () => {
      await service.buildTemplate("products", "CSV");

      expect(prisma.category.findMany).not.toHaveBeenCalled();
      expect(prisma.pharmaceuticalForm.findMany).not.toHaveBeenCalled();
      expect(prisma.taxScheme.findMany).not.toHaveBeenCalled();
    });
  });
});
