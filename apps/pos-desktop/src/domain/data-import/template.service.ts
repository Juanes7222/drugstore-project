/**
 * Offline import-template generation.
 *
 * Builds CSV and XLSX templates with the shared column labels as headers
 * and one example row, so the operator can start filling a file without a
 * server round-trip. (The server also exposes GET /imports/templates when
 * online; the POS never depends on it.)
 */

import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { ImportColumnMeta } from "@pharmacy/shared-validation";
import {
  CLIENT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_COLUMNS,
} from "@pharmacy/shared-validation";
import type { ImportEntityKey } from "./import.types";
import type { ImportSourceFormat } from "./import-common";
import { ImportFileInvalidException } from "./exceptions";

/** Example values for the template's second row — one per entity. */
const PRODUCT_EXAMPLE_ROW: Record<string, string> = {
  internalCode: "P001",
  commercialName: "Acetaminofen 500mg",
  laboratory: "Genfar",
  concentration: "500",
  concentrationUnit: "mg",
  saleType: "LIBRE",
  minimumStock: "10",
  invimaRegistry: "INVIMA 2019M-0000000",
  atcCode: "N02BE01",
  categoryName: "Analgesicos",
  pharmaceuticalFormName: "Tableta",
  initialPrice: "12500.50",
  initialCost: "8000.00",
  taxSchemeName: "IVA 19%",
};

const CLIENT_EXAMPLE_ROW: Record<string, string> = {
  fullName: "Juan Perez",
  identificationType: "CC",
  identificationNumber: "123456789",
  email: "juan.perez@example.com",
  phone: "3001234567",
  address: "Calle 1 # 2-3",
  municipality: "Bogota",
  department: "Cundinamarca",
  creditLimit: "500000",
};

function columnsFor(entityKey: ImportEntityKey): ImportColumnMeta[] {
  return entityKey === "products"
    ? PRODUCT_IMPORT_COLUMNS
    : CLIENT_IMPORT_COLUMNS;
}

function exampleRowFor(entityKey: ImportEntityKey): Record<string, string> {
  return entityKey === "products" ? PRODUCT_EXAMPLE_ROW : CLIENT_EXAMPLE_ROW;
}

/**
 * Build a downloadable template for the given entity and format.
 *
 * CSV returns a string (prefixed with a UTF-8 BOM so Excel opens it
 * correctly); XLSX returns a workbook buffer.
 */
export async function buildImportTemplate(
  entityKey: ImportEntityKey,
  format: ImportSourceFormat,
): Promise<string | ArrayBuffer> {
  const columns = columnsFor(entityKey);
  const headers = columns.map((column) => column.label);

  if (format === "CSV") {
    const example = exampleRowFor(entityKey);
    const rows = [headers, columns.map((column) => example[column.key] ?? "")];
    return `\uFEFF${Papa.unparse(rows)}`;
  }

  if (format === "XLSX") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Importar");
    const headerRow = sheet.getRow(1);
    headerRow.values = headers;
    headerRow.font = { bold: true };
    headerRow.height = 22;

    const example = exampleRowFor(entityKey);
    sheet.addRow(columns.map((column) => example[column.key] ?? ""));

    columns.forEach((column, index) => {
      const width = Math.max(column.label.length + 2, 14);
      sheet.getColumn(index + 1).width = Math.min(width, 40);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    // exceljs types the buffer as Node Buffer, but in the webview runtime
    // it is a plain ArrayBuffer — the caller reads it into a File either way.
    return buffer as unknown as ArrayBuffer;
  }

  throw new ImportFileInvalidException("Template format must be CSV or XLSX");
}
