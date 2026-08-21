/**
 * Tests for DataExportService — format routing, filename stamping, the
 * print window path, browser-download fallback, and render-failure errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportColumnType } from "../../common/export";
import { DataExportService } from "./export.service";
import type { ExportDocument } from "./export.types";
import { ExportException } from "./exceptions";

const csvMock = vi.hoisted(() => ({
  renderCsv: vi.fn(),
  realRenderCsv: undefined as
    ((document: ExportDocument) => string) | undefined,
}));

const { saveFileWithDialogMock, browserDownloadMock } = vi.hoisted(() => ({
  saveFileWithDialogMock: vi.fn(),
  browserDownloadMock: vi.fn(),
}));

vi.mock("../../common/native-save", () => ({
  saveFileWithDialog: saveFileWithDialogMock,
}));

vi.mock("../../common/export", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../common/export")>();
  return { ...mod, browserDownload: browserDownloadMock };
});

vi.mock("./export-csv.renderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./export-csv.renderer")>();
  csvMock.realRenderCsv = mod.renderCsv;
  return { ...mod, renderCsv: csvMock.renderCsv };
});

function makeDocument(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    titleKey: "export.screens.test.title",
    titleFallback: "Test",
    columns: [
      { id: "name", titleKey: "export.cols.name", type: ExportColumnType.TEXT },
    ],
    rows: [{ name: "Paracetamol" }],
    ...overrides,
  };
}

describe("DataExportService", () => {
  let service: DataExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataExportService();
    csvMock.renderCsv.mockImplementation((document) =>
      csvMock.realRenderCsv!(document),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("exportAndDownload", () => {
    it("saves CSV through the native dialog with a stamped filename", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-21T10:15:30.000Z"));
      saveFileWithDialogMock.mockResolvedValue(
        "C:\\exports\\sales-history.csv",
      );

      const saved = await service.exportAndDownload({
        format: "csv",
        document: makeDocument(),
        filenamePrefix: "sales-history",
      });

      expect(saveFileWithDialogMock).toHaveBeenCalledWith({
        content: expect.stringContaining("\uFEFF"),
        filename: "sales-history-2026-08-21T10-15-30.csv",
        mimeType: "text/csv;charset=utf-8",
        filters: [{ name: "CSV", extensions: ["csv"] }],
        title: "Guardar exportación",
      });
      expect(saved).toBe("C:\\exports\\sales-history.csv");
    });

    it("returns null when the user cancels the save dialog", async () => {
      saveFileWithDialogMock.mockResolvedValue(null);

      const saved = await service.exportAndDownload({
        format: "csv",
        document: makeDocument(),
        filenamePrefix: "sales-history",
      });

      expect(saved).toBeNull();
    });

    it("opens the print window and triggers print for the print format", async () => {
      const printWindow = {
        document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
        requestAnimationFrame: (callback: () => void) => callback(),
        print: vi.fn(),
      };
      vi.spyOn(window, "open").mockReturnValue(
        printWindow as unknown as Window,
      );

      const saved = await service.exportAndDownload({
        format: "print",
        document: makeDocument(),
        filenamePrefix: "sales-history",
      });

      expect(window.open).toHaveBeenCalledWith("", "_blank", "noopener");
      expect(printWindow.document.write).toHaveBeenCalledWith(
        expect.stringContaining("<!doctype html>"),
      );
      expect(printWindow.print).toHaveBeenCalled();
      expect(saved).toBeNull();
    });

    it("downloads directly through the browser fallback when showDialog is false", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-21T10:15:30.000Z"));

      const saved = await service.exportAndDownload({
        format: "csv",
        document: makeDocument(),
        filenamePrefix: "sales-history",
        showDialog: false,
      });

      expect(browserDownloadMock).toHaveBeenCalledWith(
        expect.stringContaining("\uFEFF"),
        "sales-history-2026-08-21T10-15-30.csv",
        "text/csv;charset=utf-8",
      );
      expect(saveFileWithDialogMock).not.toHaveBeenCalled();
      expect(saved).toBeNull();
    });

    it("wraps a render failure in an ExportException with EXPORT_RENDER_FAILED", async () => {
      // renderCsv is synchronous, so a failing renderer throws synchronously.
      csvMock.renderCsv.mockImplementationOnce(() => {
        throw new Error("boom");
      });

      const pending = service.exportAndDownload({
        format: "csv",
        document: makeDocument(),
        filenamePrefix: "sales-history",
      });

      await expect(pending).rejects.toBeInstanceOf(ExportException);
      await expect(pending).rejects.toMatchObject({
        errorCode: "EXPORT_RENDER_FAILED",
        message: "Failed to render export as csv",
        cause: expect.any(Error),
      });
      expect(saveFileWithDialogMock).not.toHaveBeenCalled();
    });
  });
});
