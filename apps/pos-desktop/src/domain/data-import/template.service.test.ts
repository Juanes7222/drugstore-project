/**
 * Unit tests for offline import-template generation: BOM-prefixed CSV with
 * labels and an example row, a real XLSX workbook buffer, and format
 * rejection. Pure generation — no role gate here (that lives in ImportService).
 *
 * Every XLSX assertion runs against the written buffer loaded back with
 * ExcelJS, so dropdown validations are verified after the write/read
 * round-trip — what Excel actually receives, not the in-memory worksheet.
 */
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { buildImportTemplate } from "./template.service";
import {
  CLIENT_IDENTIFICATION_TYPE_ALIASES,
  CLIENT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_COLUMNS,
  PRODUCT_SALE_TYPE_ALIASES,
} from "@pharmacy/shared-validation";
import { ImportFileInvalidException } from "./exceptions";

// Dropdown expectations are derived from the shared alias tables (the same
// source of truth production uses) instead of re-hardcoding option lists.

const IDENTIFICATION_TYPE_OPTIONS = [
  ...new Set(Object.values(CLIENT_IDENTIFICATION_TYPE_ALIASES)),
];

/** One representative alias per canonical sale type, first key seen wins. */
function representativeSaleTypeAliases(): string[] {
  const seen = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(PRODUCT_SALE_TYPE_ALIASES)) {
    if (!seen.has(canonical)) {
      seen.set(canonical, alias);
    }
  }
  return [...seen.values()];
}

function listFormula(options: string[]): string {
  return `"${options.join(",")}"`;
}

async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/** 1-based worksheet column number for an import column key. */
function columnNumberFor(key: string): number {
  return (
    PRODUCT_IMPORT_COLUMNS.findIndex((column) => column.key === key) + 1
  );
}

describe("buildImportTemplate", () => {
  it("builds a CSV with a BOM, label headers, and one example row", async () => {
    const csv = (await buildImportTemplate("products", "CSV")) as string;

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const parsed = Papa.parse<string[]>(csv.slice(1), { skipEmptyLines: true });
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0]).toEqual(PRODUCT_IMPORT_COLUMNS.map((c) => c.label));
    // Example row is aligned to the same columns.
    expect(parsed.data[1]).toHaveLength(PRODUCT_IMPORT_COLUMNS.length);
    expect(parsed.data[1][0]).toBe("P001");
  });

  it("builds an XLSX workbook with a bold header row and an example row", async () => {
    const buffer = (await buildImportTemplate("clients", "XLSX")) as ArrayBuffer;

    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.worksheets[0];

    const headerValues = (sheet.getRow(1).values ?? []) as unknown[];
    expect(headerValues.slice(1)).toEqual(
      CLIENT_IMPORT_COLUMNS.map((c) => c.label),
    );
    expect(sheet.getRow(1).font.bold).toBe(true);

    const exampleValues = (sheet.getRow(2).values ?? []) as unknown[];
    expect(exampleValues.slice(1)[0]).toBe("Juan Perez");
  });

  it("rejects formats other than CSV or XLSX", async () => {
    await expect(buildImportTemplate("products", "JSON")).rejects.toBeInstanceOf(
      ImportFileInvalidException,
    );
  });

  // -------------------------------------------------------------------------
  // Static enum dropdowns (no catalogs needed)
  // -------------------------------------------------------------------------

  describe("static enum dropdowns", () => {
    it("marks the clients identificationType column as an inline list of canonical document types", async () => {
      const buffer = (await buildImportTemplate(
        "clients",
        "XLSX",
      )) as ArrayBuffer;
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.worksheets[0];
      const identificationTypeColumn =
        CLIENT_IMPORT_COLUMNS.findIndex((c) => c.key === "identificationType") +
        1;

      const validation = sheet.getCell(2, identificationTypeColumn)
        .dataValidation;

      expect(validation.type).toBe("list");
      expect(validation.formulae).toEqual([
        listFormula(IDENTIFICATION_TYPE_OPTIONS),
      ]);
    });

    it("marks the products saleType column as an inline list of one alias per sale type", async () => {
      const buffer = (await buildImportTemplate(
        "products",
        "XLSX",
      )) as ArrayBuffer;
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.worksheets[0];

      const validation = sheet.getCell(2, columnNumberFor("saleType"))
        .dataValidation;

      expect(validation.type).toBe("list");
      expect(validation.formulae).toEqual([
        listFormula(representativeSaleTypeAliases()),
      ]);
    });

    it("leaves unrestricted columns without a dropdown", async () => {
      const buffer = (await buildImportTemplate(
        "clients",
        "XLSX",
      )) as ArrayBuffer;
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.worksheets[0];
      const fullNameColumn =
        CLIENT_IMPORT_COLUMNS.findIndex((c) => c.key === "fullName") + 1;

      expect(sheet.getCell(2, fullNameColumn).dataValidation).toBeUndefined();
    });

    it("writes the saleType example as a schema-accepted alias", async () => {
      const buffer = (await buildImportTemplate(
        "products",
        "XLSX",
      )) as ArrayBuffer;
      const workbook = await loadWorkbook(buffer);
      const sheet = workbook.worksheets[0];

      const exampleValue = sheet.getCell(2, columnNumberFor("saleType")).value;

      // The example must survive the schema's own alias preprocessing.
      expect(
        PRODUCT_SALE_TYPE_ALIASES[String(exampleValue).trim().toLowerCase()],
      ).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Dynamic catalog dropdowns (_Catalogos hidden sheet)
  // -------------------------------------------------------------------------

  describe("dynamic catalog dropdowns", () => {
    it("adds a hidden _Catalogos sheet for the non-empty catalogs and points taxSchemeName at it", async () => {
      const buffer = (await buildImportTemplate("products", "XLSX", {
        categories: [],
        pharmaceuticalForms: [],
        taxSchemes: ["IVA 19%", "Exento"],
      })) as ArrayBuffer;

      const workbook = await loadWorkbook(buffer);
      const catalogSheet = workbook.getWorksheet("_Catalogos");
      const sheet = workbook.worksheets[0];
      const taxColumn = columnNumberFor("taxSchemeName");

      expect(catalogSheet).toBeDefined();
      expect(catalogSheet!.state).toBe("hidden");

      // Empty catalogs are skipped, so Impuesto lands in column A alone.
      const headerValues = (catalogSheet!.getRow(1).values ?? []) as unknown[];
      expect(headerValues.slice(1)).toEqual([
        PRODUCT_IMPORT_COLUMNS.find((c) => c.key === "taxSchemeName")!.label,
      ]);
      expect(catalogSheet!.getCell(2, 1).value).toBe("IVA 19%");
      expect(catalogSheet!.getCell(3, 1).value).toBe("Exento");

      const validation = sheet.getCell(2, taxColumn).dataValidation;
      expect(validation.type).toBe("list");
      expect(validation.formulae).toEqual(["_Catalogos!$A$2:$A$3"]);

      // Skipped catalogs leave their import columns unvalidated.
      expect(
        sheet.getCell(2, columnNumberFor("categoryName")).dataValidation,
      ).toBeUndefined();
      expect(
        sheet.getCell(2, columnNumberFor("pharmaceuticalFormName"))
          .dataValidation,
      ).toBeUndefined();

      // Static enum dropdowns coexist with the catalog ones.
      expect(
        sheet.getCell(2, columnNumberFor("saleType")).dataValidation.type,
      ).toBe("list");
    });

    it("maps catalog columns to _Catalogos columns A, B, C in import-column order", async () => {
      const buffer = (await buildImportTemplate("products", "XLSX", {
        categories: ["Analgesicos", "Antibioticos", "Antifungicos"],
        pharmaceuticalForms: ["Tableta"],
        taxSchemes: ["IVA 19%", "Exento", "IVA 5%"],
      })) as ArrayBuffer;

      const workbook = await loadWorkbook(buffer);
      const catalogSheet = workbook.getWorksheet("_Catalogos");
      const sheet = workbook.worksheets[0];

      const headerValues = (catalogSheet!.getRow(1).values ?? []) as unknown[];
      expect(headerValues.slice(1)).toEqual([
        PRODUCT_IMPORT_COLUMNS.find((c) => c.key === "categoryName")!.label,
        PRODUCT_IMPORT_COLUMNS.find((c) => c.key === "pharmaceuticalFormName")!
          .label,
        PRODUCT_IMPORT_COLUMNS.find((c) => c.key === "taxSchemeName")!.label,
      ]);

      // Values start at row 2 under each catalog column.
      expect(catalogSheet!.getCell(2, 1).value).toBe("Analgesicos");
      expect(catalogSheet!.getCell(2, 2).value).toBe("Tableta");
      expect(catalogSheet!.getCell(2, 3).value).toBe("IVA 19%");

      expect(
        sheet.getCell(2, columnNumberFor("categoryName")).dataValidation
          .formulae,
      ).toEqual(["_Catalogos!$A$2:$A$4"]);
      expect(
        sheet.getCell(2, columnNumberFor("pharmaceuticalFormName"))
          .dataValidation.formulae,
      ).toEqual(["_Catalogos!$B$2:$B$2"]);
      expect(
        sheet.getCell(2, columnNumberFor("taxSchemeName")).dataValidation
          .formulae,
      ).toEqual(["_Catalogos!$C$2:$C$4"]);
    });

    it("round-trips the full validation shape through the written buffer", async () => {
      const buffer = (await buildImportTemplate("products", "XLSX", {
        categories: [],
        pharmaceuticalForms: [],
        taxSchemes: ["IVA 19%"],
      })) as ArrayBuffer;

      const workbook = await loadWorkbook(buffer);

      // Regression guard: exceljs must keep allowBlank/warning metadata on
      // the round-trip, or Excel would block hand-typed values with a stop.
      expect(workbook.getWorksheet("_Catalogos")!.state).toBe("hidden");
      expect(sheetValidationOf(workbook, columnNumberFor("saleType"))).toEqual({
        type: "list",
        allowBlank: true,
        formulae: [listFormula(representativeSaleTypeAliases())],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Valor no valido",
        error: "Elija un valor de la lista desplegable",
      });
      expect(sheetValidationOf(workbook, columnNumberFor("taxSchemeName"))).toMatchObject(
        {
          type: "list",
          formulae: ["_Catalogos!$A$2:$A$2"],
        },
      );
    });
  });
});

function sheetValidationOf(
  workbook: ExcelJS.Workbook,
  columnNumber: number,
): ExcelJS.DataValidation {
  return workbook.worksheets[0].getCell(2, columnNumber).dataValidation;
}
