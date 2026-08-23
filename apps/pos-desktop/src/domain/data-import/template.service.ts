/**
 * Offline import-template generation.
 *
 * Builds CSV and XLSX templates with the shared column labels as headers
 * and one example row, so the operator can start filling a file without a
 * server round-trip. (The server also exposes GET /imports/templates when
 * online; the POS never depends on it.)
 *
 * XLSX templates additionally carry Excel data-validation dropdowns on
 * every column whose values are restricted — static enums inline
 * (identification type, sale type) and dynamic catalogs (category,
 * pharmaceutical form, tax scheme) through a hidden `_Catalogos` sheet —
 * so the operator picks valid values instead of typing them.
 */

import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { ImportColumnMeta } from "@pharmacy/shared-validation";
import {
  CLIENT_IDENTIFICATION_TYPE_ALIASES,
  CLIENT_IMPORT_COLUMNS,
  PRODUCT_IMPORT_COLUMNS,
  PRODUCT_SALE_TYPE_ALIASES,
} from "@pharmacy/shared-validation";
import type { ImportEntityKey } from "./import.types";
import type { ImportSourceFormat } from "./import-common";
import { MAX_IMPORT_ROWS } from "./import-common";
import { ImportFileInvalidException } from "./exceptions";

/**
 * Dropdown options derived from the shared import contracts — never
 * duplicated here.
 *
 * - Identification type: the canonical enum values themselves (unique
 *   targets of the alias table, in first-seen order). They pass the
 *   schema's own preprocessing.
 * - Sale type: one representative ALIAS per canonical value. The raw
 *   enum values do NOT survive the schema's preprocessing (it lowercases
 *   and maps through the alias table), so only aliases are accepted.
 */
function canonicalEnumValues(aliases: Record<string, string>): string[] {
  return [...new Set(Object.values(aliases))];
}

function representativeAliases(aliases: Record<string, string>): string[] {
  const seen = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!seen.has(canonical)) {
      seen.set(canonical, alias);
    }
  }
  return [...seen.values()];
}

const IDENTIFICATION_TYPE_OPTIONS = canonicalEnumValues(
  CLIENT_IDENTIFICATION_TYPE_ALIASES,
);

const SALE_TYPE_OPTIONS = representativeAliases(PRODUCT_SALE_TYPE_ALIASES);

/** Dynamic catalog names offered as dropdowns in the XLSX template. */
export interface ImportTemplateCatalogs {
  categories: string[];
  pharmaceuticalForms: string[];
  taxSchemes: string[];
}

/** Example values for the template's second row — one per entity. */
const PRODUCT_EXAMPLE_ROW: Record<string, string> = {
  internalCode: "P001",
  commercialName: "Acetaminofen 500mg",
  laboratory: "Genfar",
  concentration: "500",
  concentrationUnit: "mg",
  // Keep the shipped example inside its own dropdown's option set.
  saleType: SALE_TYPE_OPTIONS[0] ?? "",
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

/**
 * Canonical identification-type options, derived from the import schema's
 * alias table — the single source of truth for what the importer accepts.
 */
const IDENTIFICATION_TYPE_FORMULA = `"${IDENTIFICATION_TYPE_OPTIONS.join(",")}"`;

/**
 * Sale-type options in the exact Spanish aliases the product import schema
 * accepts (accent-free on purpose — the alias map has no accent folding).
 */
const SALE_TYPE_FORMULA = `"${SALE_TYPE_OPTIONS.join(",")}"`;

/** Data rows covered by dropdown validations — matches the import limit so
 *  no importable row ever loses its dropdown. */
const VALIDATION_ROWS = MAX_IMPORT_ROWS;

const CATALOG_SHEET_NAME = "_Catalogos";

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
 * correctly); XLSX returns a workbook buffer. `catalogs` (optional, XLSX
 * only) enables the dynamic catalog dropdowns; without it the template
 * still carries the static enum dropdowns.
 */
export async function buildImportTemplate(
  entityKey: ImportEntityKey,
  format: ImportSourceFormat,
  catalogs?: ImportTemplateCatalogs,
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

    applyEnumValidations(sheet, columns);

    const catalogColumns = collectCatalogColumns(columns, catalogs);
    if (catalogColumns.length > 0) {
      addCatalogSheetAndValidations(workbook, sheet, catalogColumns);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    // exceljs types the buffer as Node Buffer, but in the webview runtime
    // it is a plain ArrayBuffer — the caller reads it into a File either way.
    return buffer as unknown as ArrayBuffer;
  }

  throw new ImportFileInvalidException("Template format must be CSV or XLSX");
}

// ---------------------------------------------------------------------------
// Enum dropdowns
// ---------------------------------------------------------------------------

interface CatalogColumnLink {
  /** 1-based worksheet column index of the validated column. */
  columnIndex: number;
  /** Header for the catalog column — the import column's own label. */
  header: string;
  values: string[];
}

function applyEnumValidations(
  sheet: ExcelJS.Worksheet,
  columns: ImportColumnMeta[],
): void {
  for (let index = 0; index < columns.length; index++) {
    const key = columns[index].key;

    let listFormula: string | undefined;
    if (key === "identificationType") {
      listFormula = IDENTIFICATION_TYPE_FORMULA;
    } else if (key === "saleType") {
      listFormula = SALE_TYPE_FORMULA;
    }
    if (!listFormula) continue;

    applyListValidation(sheet, index + 1, [listFormula]);
  }
}

function collectCatalogColumns(
  columns: ImportColumnMeta[],
  catalogs: ImportTemplateCatalogs | undefined,
): CatalogColumnLink[] {
  if (!catalogs) return [];

  // Catalog values keyed by the import column that consumes them; the
  // hidden-sheet headers reuse the column's canonical label.
  const catalogValues: Array<[key: string, values: string[]]> = [
    ["categoryName", catalogs.categories],
    ["pharmaceuticalFormName", catalogs.pharmaceuticalForms],
    ["taxSchemeName", catalogs.taxSchemes],
  ];

  const links: CatalogColumnLink[] = [];
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index];
    const match = catalogValues.find(([columnKey]) => columnKey === column.key);
    if (match && match[1].length > 0) {
      links.push({
        columnIndex: index + 1,
        header: column.label,
        values: match[1],
      });
    }
  }
  return links;
}

/**
 * Write the hidden `_Catalogos` sheet (one column per dynamic list) and
 * point each linked template column's validation at its range. Cross-sheet
 * list formulas survive exceljs write/read and are supported by modern
 * Excel; the hidden sheet keeps the operator's view clean.
 */
function addCatalogSheetAndValidations(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  links: CatalogColumnLink[],
): void {
  const catalogSheet = workbook.addWorksheet(CATALOG_SHEET_NAME);
  catalogSheet.state = "hidden";
  catalogSheet.getRow(1).values = links.map((link) => link.header);

  for (const link of links) {
    // Each linked column gets its own catalog column, in link order.
    const columnNumber = links.indexOf(link) + 1;
    link.values.forEach((value, rowIndex) => {
      catalogSheet.getCell(rowIndex + 2, columnNumber).value = value;
    });

    const lastRow = Math.max(2, link.values.length + 1);
    const columnLetter = catalogSheet.getColumn(columnNumber).letter;
    applyListValidation(sheet, link.columnIndex, [
      `${CATALOG_SHEET_NAME}!$${columnLetter}$2:$${columnLetter}$${lastRow}`,
    ]);
  }

  // Keep at least one visible cell so the sheet is never fully empty —
  // some Excel builds complain about validating against an empty range.
  catalogSheet.getCell(1, 1).font = { bold: true };
}

function applyListValidation(
  sheet: ExcelJS.Worksheet,
  columnIndex: number,
  formulae: string[],
): void {
  // Warning style (not stop): a hand-typed value outside the list still
  // lands in the cell so the importer's own row error can explain the
  // problem — the dropdown just prevents most mistakes upfront.
  for (let row = 2; row <= VALIDATION_ROWS + 1; row++) {
    sheet.getCell(row, columnIndex).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae,
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Valor no valido",
      error: "Elija un valor de la lista desplegable",
    };
  }
}