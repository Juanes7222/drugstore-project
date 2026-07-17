/**
 * Tests for the printer config export/import service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createConfigExportService,
  CONFIG_EXPORT_VERSION,
  type ConfigExportService,
} from "./config-export.service";
import type { PrinterConfigService } from "./printer-config.service";
import { ConfigImportException } from "./exceptions";

describe("ConfigExportService", () => {
  let service: ConfigExportService;
  let mockPrinterConfigService: Partial<PrinterConfigService>;
  let mockDiscover: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDiscover = vi.fn().mockResolvedValue([
      { systemName: "EPSON-1", friendlyName: "Epson TM-T20", connection: "USB", isDefault: true, printerType: "THERMAL_RECEIPT", supportsColor: false, detectedPaperSize: "RECEIPT_80MM", detectionConfidence: "high" },
    ]);

    mockPrinterConfigService = {
      listAll: vi.fn().mockResolvedValue([
        {
          id: "p1",
          friendlyName: "Receipt Printer",
          printerType: "THERMAL_RECEIPT",
          connection: "USB",
          paperSize: "RECEIPT_80MM",
          supportsColor: false,
          assignedJobs: ["SALE_RECEIPT"],
          serverFallbackEnabled: false,
          fallbackPrinterId: null,
        },
      ]),
      create: vi.fn().mockImplementation(async (input: any) => ({
        ...input,
        id: "new-" + crypto.randomUUID(),
      })),
      delete: vi.fn().mockResolvedValue(undefined),
      setFallbackChain: vi.fn().mockResolvedValue({}),
    };

    service = createConfigExportService(
      mockPrinterConfigService as PrinterConfigService,
      mockDiscover as unknown as (timeout?: number) => Promise<any[]>,
    );
  });

  describe("exportConfig", () => {
    it("returns a valid JSON string", async () => {
      const json = await service.exportConfig();

      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(CONFIG_EXPORT_VERSION);
      expect(parsed.exportedAt).toBeTruthy();
      expect(parsed.printers).toHaveLength(1);
    });

    it("includes assigned jobs in the export", async () => {
      const json = await service.exportConfig();

      const parsed = JSON.parse(json);
      expect(parsed.printers[0].assignedJobs).toContain("SALE_RECEIPT");
    });
  });

  describe("importConfig", () => {
    it("throws ConfigImportException for invalid JSON", async () => {
      await expect(
        service.importConfig("invalid json", { overwrite: false }),
      ).rejects.toThrow(ConfigImportException);
    });

    it("throws ConfigImportException for wrong version", async () => {
      const badConfig = JSON.stringify({ version: 999, printers: [] });

      await expect(
        service.importConfig(badConfig, { overwrite: false }),
      ).rejects.toThrow(ConfigImportException);
    });

    it("returns ImportReport with matched results", async () => {
      const config = JSON.stringify({
        version: CONFIG_EXPORT_VERSION,
        exportedAt: "2026-07-13T00:00:00Z",
        printers: [
          {
            friendlyName: "Receipt Printer",
            printerType: "THERMAL_RECEIPT",
            connection: "USB",
            paperSize: "RECEIPT_80MM",
            supportsColor: false,
            assignedJobs: ["SALE_RECEIPT"],
            serverFallbackEnabled: false,
            fallbackPrinterIndex: null,
          },
        ],
      });

      const report = await service.importConfig(config, { overwrite: false });

      expect(report.totalInConfig).toBe(1);
      expect(report.matched).toBe(1);
      expect(report.unmatched).toEqual([]);
    });

    it("calls discoverPrinters during import", async () => {
      const config = JSON.stringify({
        version: CONFIG_EXPORT_VERSION,
        exportedAt: "2026-07-13T00:00:00Z",
        printers: [],
      });

      await service.importConfig(config, { overwrite: false });

      expect(mockDiscover).toHaveBeenCalled();
    });
  });
});
