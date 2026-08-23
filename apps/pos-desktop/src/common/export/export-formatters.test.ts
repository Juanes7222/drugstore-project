/**
 * Tests for the shared export cell formatters (CSV, Excel, PDF, print).
 */
import { describe, expect, it, vi } from "vitest";
import {
  ExportColumnType,
  type ExportColumn,
  type ExportRow,
} from "./export-types";
import {
  calculateColumnWidth,
  excelNumberFormat,
  formatCell,
  formatPdfCell,
  isNumericColumn,
  pdfColumnWidth,
  resolveColumnHeader,
  toExcelValue,
} from "./export-formatters";

function column(type: ExportColumnType, id = "value"): ExportColumn {
  return { id, titleKey: `export.cols.${id}`, type };
}

function row(value: unknown): ExportRow {
  return { value };
}

describe("resolveColumnHeader", () => {
  it("prefers the literal header over the translator", () => {
    const translator = vi.fn(() => "Traducido");

    const resolved = resolveColumnHeader(
      {
        id: "fullName",
        titleKey: "export.cols.fullName",
        type: ExportColumnType.TEXT,
        header: "Nombre completo",
      },
      translator,
    );

    expect(resolved).toBe("Nombre completo");
    expect(translator).not.toHaveBeenCalled();
  });

  it("translates the title key when no literal header is set", () => {
    const translator = vi.fn(
      (key: string, options?: { defaultValue?: string }) =>
        `T[${key}]${options?.defaultValue ?? ""}`,
    );

    const resolved = resolveColumnHeader(
      column(ExportColumnType.TEXT, "name"),
      translator,
    );

    expect(resolved).toBe("T[export.cols.name]export.cols.name");
  });

  it("falls back to the title key when no translator is present", () => {
    expect(resolveColumnHeader(column(ExportColumnType.TEXT, "name"))).toBe(
      "export.cols.name",
    );
  });
});

describe("formatCell", () => {
  it("renders an empty string when the value is null", () => {
    expect(formatCell(row(null), column(ExportColumnType.CURRENCY))).toBe("");
  });

  it("renders an empty string when the value is undefined", () => {
    expect(formatCell(row(undefined), column(ExportColumnType.TEXT))).toBe("");
  });

  it("renders currency in es-CO with the COP symbol and zero decimals", () => {
    const formatted = formatCell(
      row(1234567),
      column(ExportColumnType.CURRENCY),
    );

    expect(formatted).toMatch(/^\$\s*1\.234\.567$/u);
  });

  it("renders percent with a two-decimal suffix", () => {
    expect(formatCell(row(12.3456), column(ExportColumnType.PERCENT))).toBe(
      "12.35%",
    );
  });

  it("renders integers with es-CO thousands separators", () => {
    expect(formatCell(row(1234567), column(ExportColumnType.INTEGER))).toBe(
      "1.234.567",
    );
  });

  it("renders numbers with up to four es-CO decimals", () => {
    expect(formatCell(row(1234.5), column(ExportColumnType.NUMBER))).toBe(
      "1.234,5",
    );
  });

  it("renders a valid date with the es-CO date format", () => {
    expect(
      formatCell(row("2026-08-21T12:00:00"), column(ExportColumnType.DATE)),
    ).toBe("21/8/2026");
  });

  it("renders a valid datetime with date and time", () => {
    const formatted = formatCell(
      row("2026-08-21T12:00:00"),
      column(ExportColumnType.DATETIME),
    );

    expect(formatted).toContain("21/8/2026");
    expect(formatted).toContain("12:00");
  });

  it("falls back to the raw string when a date value is invalid", () => {
    expect(formatCell(row("not-a-date"), column(ExportColumnType.DATE))).toBe(
      "not-a-date",
    );
  });

  it("passes text values through as strings", () => {
    expect(formatCell(row("Paracetamol"), column(ExportColumnType.TEXT))).toBe(
      "Paracetamol",
    );
  });
});

describe("formatPdfCell", () => {
  it("renders currency without a symbol", () => {
    expect(formatPdfCell(row(1234567), column(ExportColumnType.CURRENCY))).toBe(
      "1.234.567",
    );
  });

  it("renders percent with a two-decimal suffix", () => {
    expect(formatPdfCell(row(12.3456), column(ExportColumnType.PERCENT))).toBe(
      "12.35%",
    );
  });

  it("renders integers with es-CO thousands separators", () => {
    expect(formatPdfCell(row(1234567), column(ExportColumnType.INTEGER))).toBe(
      "1.234.567",
    );
  });

  it("renders numbers with up to four es-CO decimals", () => {
    expect(formatPdfCell(row(1234.5), column(ExportColumnType.NUMBER))).toBe(
      "1.234,5",
    );
  });

  it("renders a valid date with the es-CO date format", () => {
    expect(
      formatPdfCell(row("2026-08-21T12:00:00"), column(ExportColumnType.DATE)),
    ).toBe("21/8/2026");
  });

  it("falls back to the raw string when a date value is invalid", () => {
    expect(formatPdfCell(row("nope"), column(ExportColumnType.DATETIME))).toBe(
      "nope",
    );
  });

  it("renders an empty string when the value is null", () => {
    expect(formatPdfCell(row(null), column(ExportColumnType.TEXT))).toBe("");
  });
});

describe("toExcelValue", () => {
  it.each([
    ExportColumnType.INTEGER,
    ExportColumnType.NUMBER,
    ExportColumnType.CURRENCY,
    ExportColumnType.PERCENT,
  ])("converts %s column values to numbers", (type) => {
    expect(toExcelValue("12500.5", column(type))).toBe(12500.5);
  });

  it("converts a valid date value to a Date instance", () => {
    const value = toExcelValue(
      "2026-08-21T12:00:00.000Z",
      column(ExportColumnType.DATE),
    );

    expect(value).toBeInstanceOf(Date);
    expect((value as Date).toISOString()).toBe("2026-08-21T12:00:00.000Z");
  });

  it("keeps an invalid date value as a string", () => {
    expect(toExcelValue("not-a-date", column(ExportColumnType.DATETIME))).toBe(
      "not-a-date",
    );
  });

  it("stringifies text column values", () => {
    expect(toExcelValue(42, column(ExportColumnType.TEXT))).toBe("42");
  });

  it("returns an empty string for null and undefined", () => {
    expect(toExcelValue(null, column(ExportColumnType.NUMBER))).toBe("");
    expect(toExcelValue(undefined, column(ExportColumnType.TEXT))).toBe("");
  });
});

describe("excelNumberFormat", () => {
  it("maps every column type to its Excel number format", () => {
    expect(excelNumberFormat(column(ExportColumnType.CURRENCY))).toBe(
      '"$"#,##0;[Red]-"$"#,##0',
    );
    expect(excelNumberFormat(column(ExportColumnType.PERCENT))).toBe('0.00"%"');
    expect(excelNumberFormat(column(ExportColumnType.INTEGER))).toBe("#,##0");
    expect(excelNumberFormat(column(ExportColumnType.NUMBER))).toBe(
      "#,##0.####",
    );
    expect(excelNumberFormat(column(ExportColumnType.DATE))).toBe("dd/mm/yyyy");
    expect(excelNumberFormat(column(ExportColumnType.DATETIME))).toBe(
      "dd/mm/yyyy hh:mm",
    );
    expect(excelNumberFormat(column(ExportColumnType.TEXT))).toBe("General");
    expect(excelNumberFormat(column(ExportColumnType.BADGE))).toBe("General");
  });
});

describe("isNumericColumn", () => {
  it.each([
    ExportColumnType.INTEGER,
    ExportColumnType.NUMBER,
    ExportColumnType.CURRENCY,
    ExportColumnType.PERCENT,
  ])("returns true for %s columns", (type) => {
    expect(isNumericColumn(column(type))).toBe(true);
  });

  it.each([
    ExportColumnType.TEXT,
    ExportColumnType.DATE,
    ExportColumnType.DATETIME,
    ExportColumnType.BADGE,
  ])("returns false for %s columns", (type) => {
    expect(isNumericColumn(column(type))).toBe(false);
  });
});

describe("calculateColumnWidth", () => {
  it("starts from the column-type base width when values are short", () => {
    const rows: readonly ExportRow[] = [row("12345")];

    expect(
      calculateColumnWidth("Total", rows, column(ExportColumnType.CURRENCY)),
    ).toBe(18);
  });

  it("grows with the longest value plus padding", () => {
    const rows: readonly ExportRow[] = [row("a".repeat(30))];

    expect(calculateColumnWidth("x", rows, column(ExportColumnType.TEXT))).toBe(
      32,
    );
  });

  it("caps the width at 42 characters", () => {
    const rows: readonly ExportRow[] = [row("a".repeat(60))];

    expect(calculateColumnWidth("x", rows, column(ExportColumnType.TEXT))).toBe(
      42,
    );
  });

  it("ignores null and undefined values", () => {
    const rows: readonly ExportRow[] = [row(null), row(undefined)];

    expect(
      calculateColumnWidth("Total", rows, column(ExportColumnType.CURRENCY)),
    ).toBe(18);
  });

  it("drives the width from the header when it is longer than the values", () => {
    const rows: readonly ExportRow[] = [row("123")];

    expect(
      calculateColumnWidth(
        "A very long header",
        rows,
        column(ExportColumnType.INTEGER),
      ),
    ).toBe(20);
  });
});

describe("pdfColumnWidth", () => {
  it.each([
    [ExportColumnType.INTEGER, 48],
    [ExportColumnType.PERCENT, 48],
    [ExportColumnType.NUMBER, 58],
    [ExportColumnType.CURRENCY, 66],
    [ExportColumnType.DATE, 58],
    [ExportColumnType.DATETIME, 78],
    [ExportColumnType.BADGE, 60],
    [ExportColumnType.TEXT, "auto"],
  ] as const)("maps %s to %s", (type, expected) => {
    expect(pdfColumnWidth(type)).toBe(expected);
  });
});
