/**
 * Tests for the Excel export renderer.
 *
 * The rendered buffer is loaded back with ExcelJS so assertions run against
 * the actual XLSX document, not the in-memory worksheet. The critical
 * round-trip tests feed the rendered buffer through the real
 * `parseExcel` importer — sheet 0 MUST keep its header row in row 1 or the
 * import pipeline breaks (merged tenant bands leak their master value into
 * every cell of the merged range, which the importer reads as duplicate
 * headers).
 */
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { CLIENT_IMPORT_COLUMNS } from "@pharmacy/shared-validation";
import { ExportColumnType, type ExportColumn } from "../../common/export";
import { renderExcel } from "./export-excel.renderer";
import type { ExportDocument } from "./export.types";
import { CLIENTS_EXPORT } from "./definitions/clients.export";
import {
  assertUniqueHeaders,
  missingRequiredHeaders,
} from "../data-import/import-common";
import { parseExcel } from "../data-import/parsers/excel.parser";

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

function collectCellValues(sheet: ExcelJS.Worksheet): unknown[] {
  const values: unknown[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => values.push(cell.value));
  });
  return values;
}

function detailSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  return workbook.getWorksheet("Detalle")!;
}

function infoSheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  return workbook.getWorksheet("Información")!;
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

  it("emits two worksheets named Detalle and Información in order", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Detalle",
      "Información",
    ]);
  });

  it("translates both sheet names through t", async () => {
    // The mock keeps the translated sheet name free of Excel-forbidden
    // characters ([ ] * ? : \ /).
    const t = vi.fn((key: string) => `T_${key}`);

    const workbook = await loadWorkbook(await renderExcel(makeDocument({ t })));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "T_export.sheet.detail",
      "T_export.sheet.info",
    ]);
  });

  it("writes translated headers into row 1 of the detail sheet", async () => {
    const t = vi.fn((key: string) => `T_${key}`);

    const workbook = await loadWorkbook(await renderExcel(makeDocument({ t })));
    const sheet = workbook.getWorksheet(1)!;

    expect(sheet.getCell(1, 1).value).toBe("T_export.cols.amount");
    expect(sheet.getCell(1, 2).value).toBe("T_export.cols.soldAt");
    expect(sheet.getCell(1, 3).value).toBe("T_export.cols.name");
  });

  it("falls back to raw header keys in row 1 when no translator is present", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = detailSheet(workbook);

    expect(sheet.getCell(1, 1).value).toBe("export.cols.amount");
    expect(sheet.getCell(1, 2).value).toBe("export.cols.soldAt");
    expect(sheet.getCell(1, 3).value).toBe("export.cols.name");
  });

  it("freezes the header row and spans the autofilter over it and the data", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = detailSheet(workbook);

    expect(sheet.views[0]?.state).toBe("frozen");
    expect(
      (sheet.views[0] as ExcelJS.WorksheetViewFrozen | undefined)?.ySplit,
    ).toBe(1);

    // ExcelJS normalizes the autofilter to an A1-style range string.
    expect(sheet.autoFilter).toBe("A1:C2");
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
    const sheet = detailSheet(workbook);

    expect(sheet.autoFilter).toBe("A1:C3");
  });

  it("writes the first data row with typed cell values", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = detailSheet(workbook);

    expect(typeof sheet.getCell(2, 1).value).toBe("number");
    expect(sheet.getCell(2, 1).value).toBe(12500);

    expect(sheet.getCell(2, 2).value).toBeInstanceOf(Date);
    expect((sheet.getCell(2, 2).value as Date).toISOString()).toBe(
      "2026-08-21T12:00:00.000Z",
    );

    expect(sheet.getCell(2, 3).value).toBe("Paracetamol 500mg");
  });

  it("keeps the tenant name out of the detail sheet", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = detailSheet(workbook);

    expect(collectCellValues(sheet)).not.toContain("Farmacia Central");
  });

  it("writes the tenant band and document title into the info sheet", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = infoSheet(workbook);

    expect(sheet.getCell(1, 1).value).toBe("Farmacia Central");
    expect(sheet.getCell(2, 1).value).toBe("Test");
  });

  it("writes the optional subtitle into row 3 of the info sheet", async () => {
    const workbook = await loadWorkbook(
      await renderExcel(
        makeDocument({
          subtitleKey: "export.screens.test.subtitle",
          subtitleFallback: "Filtros aplicados",
          metadata: [["export.meta.search", "Búsqueda", "Paracetamol"]],
        }),
      ),
    );
    const sheet = infoSheet(workbook);

    expect(sheet.getCell(3, 1).value).toBe("Filtros aplicados");
    // Metadata shifts down one row when a subtitle is present: row 5 is
    // the generated-at pair, row 6 the screen filter.
    expect(sheet.getCell(5, 1).value).toBe("GENERADO");
    expect(sheet.getCell(6, 1).value).toBe("BÚSQUEDA");
    expect(sheet.getCell(6, 2).value).toBe("Paracetamol");
  });

  it("writes the metadata rows with a localized generated-at and the user", async () => {
    const workbook = await loadWorkbook(
      await renderExcel(makeDocument({ userDisplayName: "Ana Operadora" })),
    );
    const sheet = infoSheet(workbook);

    expect(sheet.getCell(4, 1).value).toBe("GENERADO");
    expect(String(sheet.getCell(4, 2).value)).toContain("2026");

    expect(sheet.getCell(5, 1).value).toBe("USUARIO");
    expect(sheet.getCell(5, 2).value).toBe("Ana Operadora");
  });

  it("keeps the data rows out of the info sheet", async () => {
    const workbook = await loadWorkbook(await renderExcel(makeDocument()));
    const sheet = infoSheet(workbook);

    const values = collectCellValues(sheet);
    expect(values).not.toContain("Paracetamol 500mg");
    expect(values).not.toContain(12500);
  });

  it("round-trips the canonical client headers through the real parseExcel", async () => {
    const buffer = await renderExcel({
      titleKey: "export.screens.clients.title",
      titleFallback: "Clientes",
      columns: CLIENTS_EXPORT.columns,
      rows: [],
      generatedAt: "2026-08-21T12:00:00.000Z",
    });

    const parsed = await parseExcel(buffer);

    // Regression: a merged tenant band used to sit in sheet-0 row 1 and
    // exceljs echoes the master cell value into every merged cell, so the
    // importer saw ["Farmacia Central", "Farmacia Central", ...] and failed
    // with "Duplicate column headers are not allowed".
    expect(parsed.headers).toEqual(
      CLIENT_IMPORT_COLUMNS.map((column) => column.label),
    );
  });

  it("round-trips client rows as raw header-keyed strings", async () => {
    const buffer = await renderExcel({
      titleKey: "export.screens.clients.title",
      titleFallback: "Clientes",
      columns: CLIENTS_EXPORT.columns,
      rows: [
        {
          fullName: "María Pérez",
          identificationType: "CC",
          identificationNumber: "1023456789",
          email: "maria@example.com",
          phone: "3105551234",
          address: "Calle 10 #5-20",
          municipality: "Medellín",
          department: "Antioquia",
          creditLimit: "500000",
        },
        {
          fullName: "Juan Rodríguez",
          identificationType: "NIT",
          identificationNumber: "900123456",
          email: "",
          phone: "",
          address: "",
          municipality: "",
          department: "",
          creditLimit: "",
        },
      ],
      generatedAt: "2026-08-21T12:00:00.000Z",
    });

    const parsed = await parseExcel(buffer);
    const labels = CLIENT_IMPORT_COLUMNS.map((column) => column.label);

    expect(parsed.rows).toEqual([
      {
        [labels[0]]: "María Pérez",
        [labels[1]]: "CC",
        [labels[2]]: "1023456789",
        [labels[3]]: "maria@example.com",
        [labels[4]]: "3105551234",
        [labels[5]]: "Calle 10 #5-20",
        [labels[6]]: "Medellín",
        [labels[7]]: "Antioquia",
        // Raw digits, not the "$"-formatted display value.
        [labels[8]]: "500000",
      },
      {
        [labels[0]]: "Juan Rodríguez",
        [labels[1]]: "NIT",
        [labels[2]]: "900123456",
        [labels[3]]: "",
        [labels[4]]: "",
        [labels[5]]: "",
        [labels[6]]: "",
        [labels[7]]: "",
        [labels[8]]: "",
      },
    ]);
  });

  it("passes the import header validation on a rendered export", async () => {
    const buffer = await renderExcel({
      titleKey: "export.screens.clients.title",
      titleFallback: "Clientes",
      columns: CLIENTS_EXPORT.columns,
      rows: [
        {
          fullName: "María Pérez",
          identificationType: "CC",
          identificationNumber: "1023456789",
          email: "",
          phone: "",
          address: "",
          municipality: "",
          department: "",
          creditLimit: "500000",
        },
      ],
      generatedAt: "2026-08-21T12:00:00.000Z",
    });

    const parsed = await parseExcel(buffer);

    expect(() => assertUniqueHeaders(parsed.headers)).not.toThrow();
    expect(missingRequiredHeaders(CLIENT_IMPORT_COLUMNS, parsed.headers)).toEqual(
      [],
    );
  });
});