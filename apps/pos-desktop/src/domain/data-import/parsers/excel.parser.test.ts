/**
 * Unit tests for the Excel source parser. Fixtures are built with the real
 * ExcelJS writer so the parser runs against authentic workbook bytes.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseExcel } from "./excel.parser";
import { ImportFileInvalidException } from "../exceptions";

async function buildWorkbook(
  build: (sheet: ExcelJS.Worksheet) => void,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  build(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as ArrayBuffer;
}

const headerAndRows = (
  headers: Array<string | number | Date>,
  rows: Array<Array<string | number | Date>>,
) =>
  buildWorkbook((sheet) => {
    headers.forEach((value, index) => {
      sheet.getRow(1).getCell(index + 1).value = value;
    });
    rows.forEach((row) => sheet.addRow(row));
  });

describe("parseExcel", () => {
  it("reads the first row as headers and data rows keyed by header", async () => {
    const buffer = await headerAndRows(
      ["codigo", "nombre"],
      [
        ["P001", "Acetaminofen"],
        ["P002", "Ibuprofeno"],
      ],
    );

    const table = await parseExcel(buffer);
    expect(table.headers).toEqual(["codigo", "nombre"]);
    expect(table.rows).toEqual([
      { codigo: "P001", nombre: "Acetaminofen" },
      { codigo: "P002", nombre: "Ibuprofeno" },
    ]);
    expect(table.warnings).toEqual([]);
  });

  it("keeps numbers as raw values without thousand separators", async () => {
    const buffer = await headerAndRows(["precio"], [[12500.5]]);

    const table = await parseExcel(buffer);
    expect(table.rows[0].precio).toBe("12500.5");
  });

  it("returns date cells as ISO yyyy-mm-dd", async () => {
    const date = new Date(2026, 7, 15);
    const buffer = await buildWorkbook((sheet) => {
      sheet.getRow(1).getCell(1).value = "fecha";
      const cell = sheet.getRow(2).getCell(1);
      cell.value = date;
      cell.numFmt = "yyyy-mm-dd";
    });

    const table = await parseExcel(buffer);
    expect(table.rows[0].fecha).toBe("2026-08-15");
  });

  it("skips stray blank rows", async () => {
    const buffer = await buildWorkbook((sheet) => {
      sheet.getRow(1).getCell(1).value = "codigo";
      sheet.getRow(2).getCell(1).value = "P001";
      // Row 3 is left untouched — no cells allocated.
      sheet.getRow(4).getCell(1).value = "P002";
    });

    const table = await parseExcel(buffer);
    expect(table.rows).toEqual([{ codigo: "P001" }, { codigo: "P002" }]);
  });

  it("fills missing trailing cells with empty strings", async () => {
    const buffer = await headerAndRows(["a", "b"], [["1"]]);

    const table = await parseExcel(buffer);
    expect(table.rows).toEqual([{ a: "1", b: "" }]);
  });

  it("throws on bytes that are not a valid workbook", async () => {
    const garbage = Uint8Array.from([1, 2, 3, 4, 5]).buffer;
    await expect(parseExcel(garbage)).rejects.toBeInstanceOf(
      ImportFileInvalidException,
    );
  });

  it("throws when the first row has no header", async () => {
    const buffer = await buildWorkbook((sheet) => {
      sheet.getRow(2).getCell(1).value = "P001";
    });
    await expect(parseExcel(buffer)).rejects.toThrow(/no header row/);
  });

  it("throws when a header column name is empty", async () => {
    const buffer = await headerAndRows(["", "nombre"], [["1", "a"]]);
    await expect(parseExcel(buffer)).rejects.toThrow(/empty column names/);
  });

  it("throws when headers are duplicated", async () => {
    const buffer = await headerAndRows(["codigo", "codigo"], [["1", "2"]]);
    await expect(parseExcel(buffer)).rejects.toThrow(
      /Duplicate column headers/,
    );
  });
});
