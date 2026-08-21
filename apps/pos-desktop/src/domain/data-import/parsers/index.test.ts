/**
 * Unit tests for the source-format dispatch (parseImportFile): the format is
 * resolved from the extension or content sniff, then routed to the parser.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseImportFile } from "./index";

const encoder = new TextEncoder();

async function buildWorkbook(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Hoja1");
  sheet.getRow(1).getCell(1).value = "codigo";
  sheet.getRow(2).getCell(1).value = "P001";
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as ArrayBuffer;
}

describe("parseImportFile", () => {
  it("routes a .csv file to the CSV parser", async () => {
    const result = await parseImportFile(
      "productos.csv",
      encoder.encode("codigo\nP001").buffer,
    );
    expect(result.format).toBe("CSV");
    expect(result.table.headers).toEqual(["codigo"]);
  });

  it("routes a .json file to the JSON parser", async () => {
    const result = await parseImportFile(
      "productos.json",
      encoder.encode('[{"codigo":"P001"}]').buffer,
    );
    expect(result.format).toBe("JSON");
    expect(result.table.rows).toEqual([{ codigo: "P001" }]);
  });

  it("routes a .xlsx buffer to the Excel parser", async () => {
    const result = await parseImportFile("productos.xlsx", await buildWorkbook());
    expect(result.format).toBe("XLSX");
    expect(result.table.rows).toEqual([{ codigo: "P001" }]);
  });

  it("sniffs a ZIP header as XLSX for unknown extensions", async () => {
    const buffer = await buildWorkbook();
    const result = await parseImportFile("datos.bin", buffer);
    expect(result.format).toBe("XLSX");
  });

  it("sniffs a leading brace as JSON for unknown extensions", async () => {
    const result = await parseImportFile(
      "datos.bin",
      encoder.encode('{"headers":["a"],"rows":[["1"]]}').buffer,
    );
    expect(result.format).toBe("JSON");
  });

  it("falls back to CSV for unknown extensions", async () => {
    const result = await parseImportFile(
      "datos.bin",
      encoder.encode("codigo\nP001").buffer,
    );
    expect(result.format).toBe("CSV");
    expect(result.table.rows).toEqual([{ codigo: "P001" }]);
  });
});
