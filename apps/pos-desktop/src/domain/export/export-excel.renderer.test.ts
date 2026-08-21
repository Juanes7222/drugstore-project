/**
 * Tests for the Excel export renderer.
 *
 * The rendered buffer is loaded back with ExcelJS so assertions run against
 * the actual XLSX document, not the in-memory worksheet.
 */
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { ExportColumnType, type ExportColumn } from "../../common/export";
import { renderExcel } from "./export-excel.renderer";
import type { ExportDocument } from "./export.types";

type ExcelJsLoadInput = Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];

vi.mock("../configuration/local-config.store", () => ({
  getTenantInfo: () => ({
    nit: "900000000",
    name: "Farmacia Central",
    address: null,
    phone: null,
    resolutionNumber: null,
    resolutionDate: null,
    resolutionPrefix: "",
  }),
}));

const COLUMNS: readonly ExportColumn[] = [
  {
    id: "amount",
    titleKey: "export.cols.amount",
    type: ExportColumnType.CURRENCY,
  },
  { id: "soldAt", titleKey: "export.cols.soldAt", type: ExportColumnType.DATE },
  { id: "name", titleKey: "export.cols.name", type: ExportColumnType.TEXT },
];

function makeDocument(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    titleKey: "export.screens.test.title",
    titleFallback: "Test",
    columns: COLUMNS,
    rows: [
      {
        amount: 12500,
        soldAt: "2026-08-21T12:00:00.000Z",
        name: "Paracetamol 500mg",
      },
    ],
    generatedAt: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}

async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJsLoadInput);
  return workbook;
}

describe("renderExcel", () => {
  it("returns binary workbook content starting with the XLSX zip magic", async () => {
    const buffer = await renderExcel(makeDocument());

    expect(buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)).toBe(
      true,
    );

    const bytes = new Uint8Array(buffer as ArrayBuffer);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("writes the tenant name into the title band cell", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = workbook.getWorksheet(1)!;

    expect(sheet.getCell(1, 1).value).toBe("Farmacia Central");
  });

  it("translates the sheet name and header cells through t", async () => {
    // The mock keeps the translated sheet name free of Excel-forbidden
    // characters ([ ] * ? : \ /).
    const t = vi.fn((key: string) => `T_${key}`);

    const workbook = await loadWorkbook(await renderExcel(makeDocument({ t })));
    const sheet = workbook.getWorksheet(1)!;

    expect(sheet.name).toBe("T_export.sheet.detail");
    expect(sheet.getCell(6, 1).value).toBe("T_export.cols.amount");
    expect(sheet.getCell(6, 2).value).toBe("T_export.cols.soldAt");
    expect(sheet.getCell(6, 3).value).toBe("T_export.cols.name");
  });

  it("falls back to raw keys when no translator is present", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = workbook.getWorksheet(1)!;

    expect(sheet.name).toBe("Detalle");
    expect(sheet.getCell(6, 1).value).toBe("export.cols.amount");
    expect(sheet.getCell(6, 2).value).toBe("export.cols.soldAt");
  });

  it("writes the first data row with typed cell values", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = workbook.getWorksheet(1)!;

    expect(typeof sheet.getCell(7, 1).value).toBe("number");
    expect(sheet.getCell(7, 1).value).toBe(12500);

    expect(sheet.getCell(7, 2).value).toBeInstanceOf(Date);
    expect((sheet.getCell(7, 2).value as Date).toISOString()).toBe(
      "2026-08-21T12:00:00.000Z",
    );

    expect(sheet.getCell(7, 3).value).toBe("Paracetamol 500mg");
  });

  it("spans the autofilter over the header and all data rows", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = workbook.getWorksheet(1)!;

    // ExcelJS normalizes the autofilter to an A1-style range string.
    expect(sheet.autoFilter).toBe("A6:C7");
  });

  it("extends the autofilter across multiple data rows", async () => {
    const workbook = await loadWorkbook(
      await renderExcel(
        makeDocument({
          rows: [
            { amount: 1, soldAt: "2026-08-21T12:00:00.000Z", name: "A" },
            { amount: 2, soldAt: "2026-08-21T12:00:00.000Z", name: "B" },
          ],
        }),
      ),
    );
    const sheet = workbook.getWorksheet(1)!;

    expect(sheet.autoFilter).toBe("A6:C8");
  });
});
