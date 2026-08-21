/**
 * Tests for the CSV export renderer (BOM, delimiter, quoting, headers).
 */
import { describe, expect, it, vi } from "vitest";
import { ExportColumnType } from "../../common/export";
import { renderCsv } from "./export-csv.renderer";
import type { ExportDocument } from "./export.types";

function makeDocument(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    titleKey: "export.screens.test.title",
    titleFallback: "Test",
    columns: [
      { id: "name", titleKey: "export.cols.name", type: ExportColumnType.TEXT },
      {
        id: "qty",
        titleKey: "export.cols.qty",
        type: ExportColumnType.INTEGER,
      },
    ],
    rows: [{ name: "Paracetamol", qty: 3 }],
    ...overrides,
  };
}

describe("renderCsv", () => {
  it("prefixes the output with a UTF-8 BOM", () => {
    expect(renderCsv(makeDocument())).toMatch(/^\uFEFF/u);
  });

  it("joins fields with the semicolon delimiter and CRLF line endings", () => {
    expect(renderCsv(makeDocument())).toBe(
      "\uFEFFexport.cols.name;export.cols.qty\r\nParacetamol;3",
    );
  });

  it("quotes a value containing a semicolon", () => {
    const document = makeDocument({
      rows: [{ name: "a;b", qty: 1 }],
    });

    expect(renderCsv(document)).toContain('"a;b"');
  });

  it("quotes and doubles a value containing a double quote", () => {
    const document = makeDocument({
      rows: [{ name: 'say "hi"', qty: 1 }],
    });

    expect(renderCsv(document)).toContain('"say ""hi"""');
  });

  it("quotes a value containing a newline", () => {
    const document = makeDocument({
      rows: [{ name: "line1\nline2", qty: 1 }],
    });

    expect(renderCsv(document)).toContain('"line1\nline2"');
  });

  it("translates headers through the injected t function", () => {
    const t = vi.fn((key: string, options?: { defaultValue?: string }) => {
      return `T[${key}]${options?.defaultValue ?? ""}`;
    });

    const output = renderCsv(makeDocument({ t }));

    expect(t).toHaveBeenCalledWith("export.cols.name", {
      defaultValue: "export.cols.name",
    });
    expect(t).toHaveBeenCalledWith("export.cols.qty", {
      defaultValue: "export.cols.qty",
    });
    expect(output).toContain("T[export.cols.name]export.cols.name");
  });

  it("falls back to the title key when no translator is present", () => {
    const output = renderCsv(makeDocument({ t: undefined }));

    expect(output).toContain("export.cols.name;export.cols.qty");
  });
});
