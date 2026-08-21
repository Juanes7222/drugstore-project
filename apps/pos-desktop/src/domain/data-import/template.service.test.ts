/**
 * Unit tests for offline import-template generation: BOM-prefixed CSV with
 * labels and an example row, a real XLSX workbook buffer, and format
 * rejection. Pure generation — no role gate here (that lives in ImportService).
 */
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { buildImportTemplate } from "./template.service";
import {
  CLIENT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_COLUMNS,
} from "@pharmacy/shared-validation";
import { ImportFileInvalidException } from "./exceptions";

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

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
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
});
