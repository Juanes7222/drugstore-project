/**
 * Unit tests for the shared data-import plumbing in import-common.ts:
 * header/cell normalization, alias maps, header checks, text decoding,
 * and format detection. Pure functions — no database, no DOM.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PRODUCT_IMPORT_COLUMNS } from "@pharmacy/shared-validation";
import {
  assertUniqueHeaders,
  buildAliasMap,
  decodeTextBuffer,
  detectImportFormat,
  missingRequiredHeaders,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from "./import-common";

const encoder = new TextEncoder();

const bufferOf = (bytes: number[]): ArrayBuffer => Uint8Array.from(bytes).buffer;

describe("normalizeHeader", () => {
  it("folds accents and lowercases", () => {
    expect(normalizeHeader("Código")).toBe("codigo");
    expect(normalizeHeader("Nombre Comercial")).toBe("nombre comercial");
    expect(normalizeHeader("TÉLÉFONO")).toBe("telefono");
  });

  it("collapses repeated whitespace to a single space", () => {
    expect(normalizeHeader("Nombre   Comercial")).toBe("nombre comercial");
    expect(normalizeHeader("  stock   minimo  ")).toBe("stock minimo");
  });

  it("treats underscore separators as distinct tokens", () => {
    expect(normalizeHeader("internal_code")).toBe("internal_code");
  });
});

describe("normalizeCellValue", () => {
  it("maps empty and placeholder strings to undefined", () => {
    expect(normalizeCellValue("")).toBeUndefined();
    expect(normalizeCellValue("   ")).toBeUndefined();
    expect(normalizeCellValue("-")).toBeUndefined();
    expect(normalizeCellValue("n/a")).toBeUndefined();
    expect(normalizeCellValue("N/A")).toBeUndefined();
    expect(normalizeCellValue("null")).toBeUndefined();
    expect(normalizeCellValue("undefined")).toBeUndefined();
  });

  it("trims real values and leaves non-strings untouched", () => {
    expect(normalizeCellValue("  12500.50  ")).toBe("12500.50");
    expect(normalizeCellValue(12500.5)).toBe(12500.5);
    expect(normalizeCellValue(null)).toBeNull();
    expect(normalizeCellValue(0)).toBe(0);
  });
});

describe("buildAliasMap", () => {
  it("maps every alias and canonical key to the canonical key", () => {
    const map = buildAliasMap(PRODUCT_IMPORT_COLUMNS);
    // Lookups must be normalized first — same contract as mapColumns.
    expect(map.get(normalizeHeader("internalCode"))).toBe("internalCode");
    expect(map.get(normalizeHeader("codigo interno"))).toBe("internalCode");
    expect(map.get(normalizeHeader("Código"))).toBe("internalCode");
    expect(map.get(normalizeHeader("internal code"))).toBe("internalCode");
    expect(map.get(normalizeHeader("Precio"))).toBe("initialPrice");
    expect(map.get(normalizeHeader("tax"))).toBe("taxSchemeName");
  });

  it("returns undefined for unknown headers", () => {
    const map = buildAliasMap(PRODUCT_IMPORT_COLUMNS);
    expect(map.get("not-a-column")).toBeUndefined();
  });
});

describe("zodIssuesToImportIssues", () => {
  it("joins nested paths with a dot", () => {
    const schema = z.object({ a: z.object({ b: z.string() }) });
    const result = schema.safeParse({ a: {} });
    const issues = zodIssuesToImportIssues(result.error!);
    expect(issues).toEqual([
      { path: "a.b", message: expect.any(String) as string },
    ]);
  });

  it("uses 'row' when the error has no path", () => {
    const result = z.string().safeParse(42);
    const issues = zodIssuesToImportIssues(result.error!);
    expect(issues).toEqual([{ path: "row", message: expect.any(String) as string }]);
  });

  it("keeps one entry per failed field", () => {
    const schema = z.object({ name: z.string().min(3), price: z.number() });
    const result = schema.safeParse({ name: "x", price: "nope" });
    const issues = zodIssuesToImportIssues(result.error!);
    expect(issues.map((issue) => issue.path)).toEqual(["name", "price"]);
  });
});

describe("missingRequiredHeaders", () => {
  it("returns the labels of missing required columns", () => {
    const missing = missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, [
      "Codigo interno",
      "Nombre comercial",
    ]);
    expect(missing).toEqual(
      expect.arrayContaining(["Laboratorio", "Precio de venta", "Impuesto"]),
    );
    expect(missing).toHaveLength(3);
  });

  it("accepts a required column when any alias is present", () => {
    const missing = missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, [
      "Código",
      "Nombre",
      "Lab",
      "Precio",
      "IVA",
    ]);
    expect(missing).toEqual([]);
  });
});

describe("assertUniqueHeaders", () => {
  it("throws on duplicated headers", () => {
    expect(() => assertUniqueHeaders(["a", "b", "a"])).toThrow(
      "Duplicate column headers are not allowed: a",
    );
  });

  it("accepts a header list without duplicates", () => {
    expect(() => assertUniqueHeaders(["a", "b", "c"])).not.toThrow();
  });
});

describe("decodeTextBuffer", () => {
  it("strips a UTF-8 BOM", () => {
    const bytes = [0xef, 0xbb, 0xbf, ...encoder.encode("codigo")];
    expect(decodeTextBuffer(bufferOf(bytes))).toBe("codigo");
  });

  it("decodes valid UTF-8 multibyte text", () => {
    const bytes = encoder.encode("Código");
    expect(decodeTextBuffer(bufferOf([...bytes]))).toBe("Código");
  });

  it("falls back to Windows-1252/CP1252 when UTF-8 decoding fails", () => {
    // 0xE9 is a lone lead byte (invalid UTF-8) but a valid CP1252 é —
    // identical in plain Latin-1, so this only proves the fallback path.
    const bytes = [0x63, 0x6f, 0x64, 0xe9, 0x67, 0x6f];
    expect(decodeTextBuffer(bufferOf(bytes))).toBe("codégo");
  });

  it("decodes the CP1252-only 0x80 byte as the euro sign", () => {
    // 0x80 is undefined in Latin-1 but U+20AC (€) in CP1252 — the byte that
    // tells the two encodings apart.
    expect(decodeTextBuffer(bufferOf([0x80]))).toBe("€");
  });
});

describe("detectImportFormat", () => {
  it("resolves formats from the file extension, case-insensitively", () => {
    expect(detectImportFormat("productos.csv", new ArrayBuffer(0))).toBe("CSV");
    expect(detectImportFormat("productos.txt", new ArrayBuffer(0))).toBe("CSV");
    expect(detectImportFormat("productos.XLSX", new ArrayBuffer(0))).toBe("XLSX");
    expect(detectImportFormat("productos.xls", new ArrayBuffer(0))).toBe("XLSX");
    expect(detectImportFormat("productos.json", new ArrayBuffer(0))).toBe("JSON");
  });

  it("sniffs a ZIP (PK) header as XLSX when the extension is unknown", () => {
    const bytes = bufferOf([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(detectImportFormat("datos.bin", bytes)).toBe("XLSX");
  });

  it("sniffs a leading brace or bracket as JSON", () => {
    const object = bufferOf([0x7b, 0x22, 0x61, 0x22, 0x7d]);
    const array = bufferOf([0x5b, 0x31, 0x5d]);
    expect(detectImportFormat("datos.bin", object)).toBe("JSON");
    expect(detectImportFormat("datos.bin", array)).toBe("JSON");
  });

  it("falls back to CSV", () => {
    const bytes = bufferOf([0x61, 0x2c, 0x62]);
    expect(detectImportFormat("datos.bin", bytes)).toBe("CSV");
  });
});
