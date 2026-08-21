/**
 * Tests for the file-level export helpers (filters, MIME types, filenames).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extensionFor,
  FILE_FILTERS,
  MIME_TYPES,
  stampForFilename,
} from "./export-file";

describe("extensionFor", () => {
  it("maps excel to xlsx", () => {
    expect(extensionFor("excel")).toBe("xlsx");
  });

  it("maps pdf to pdf", () => {
    expect(extensionFor("pdf")).toBe("pdf");
  });

  it("maps csv to csv", () => {
    expect(extensionFor("csv")).toBe("csv");
  });
});

describe("stampForFilename", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a YYYY-MM-DDTHH-MM-SS timestamp without colons or dots", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T10:15:30.000Z"));

    expect(stampForFilename()).toBe("2026-08-21T10-15-30");
    expect(stampForFilename()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/u,
    );
  });
});

describe("FILE_FILTERS", () => {
  it("describes the CSV filter for the native save dialog", () => {
    expect(FILE_FILTERS.csv).toEqual({ name: "CSV", extensions: ["csv"] });
  });

  it("describes the Excel filter for the native save dialog", () => {
    expect(FILE_FILTERS.excel).toEqual({
      name: "Excel",
      extensions: ["xlsx"],
    });
  });

  it("describes the PDF filter for the native save dialog", () => {
    expect(FILE_FILTERS.pdf).toEqual({ name: "PDF", extensions: ["pdf"] });
  });
});

describe("MIME_TYPES", () => {
  it("uses the UTF-8 CSV MIME type", () => {
    expect(MIME_TYPES.csv).toBe("text/csv;charset=utf-8");
  });

  it("uses the OpenXML spreadsheet MIME type", () => {
    expect(MIME_TYPES.excel).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("uses the PDF MIME type", () => {
    expect(MIME_TYPES.pdf).toBe("application/pdf");
  });
});
