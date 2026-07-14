/**
 * Tests for the printer health check service.
 * Since this service depends heavily on Tauri IPC and external hardware,
 * tests focus on the domain logic boundaries.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createPrinterHealthService,
  type PrinterHealthService,
} from "./printer-health.service";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("PrinterHealthService", () => {
  let service: PrinterHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createPrinterHealthService();
  });

  describe("checkPrinter", () => {
    it("returns online status when invoke succeeds", async () => {
      mockInvoke.mockResolvedValueOnce({
        status: "ONLINE",
        statusMessage: "Ready",
      });

      const result = await service.checkPrinter("EPSON-TM-T20");

      expect(result.status).toBe("ONLINE");
      expect(result.statusMessage).toBe("Ready");
    });

    it("returns offline status when invoke fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Device not found"));

      const result = await service.checkPrinter("UNKNOWN-PRINTER");

      expect(result.status).toBe("OFFLINE");
      expect(result.statusMessage).toBeTruthy();
    });

    it("calls the correct Tauri command with printer system name", async () => {
      mockInvoke.mockResolvedValueOnce({ status: "ONLINE" });

      await service.checkPrinter("EPSON-TM-T20");

      expect(mockInvoke).toHaveBeenCalledWith("check_printer_status", {
        systemName: "EPSON-TM-T20",
      });
    });
  });

  describe("checkAllPrinters", () => {
    it("checks multiple printers and returns statuses", async () => {
      mockInvoke
        .mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" })
        .mockResolvedValueOnce({ status: "OFFLINE", statusMessage: "Disconnected" });

      const results = await service.checkAllPrinters(["PRINTER-1", "PRINTER-2"]);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("ONLINE");
      expect(results[1].status).toBe("OFFLINE");
    });
  });

  describe("testPrint", () => {
    it("returns success when test print works", async () => {
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await service.testPrint("EPSON-TM-T20");

      expect(result.success).toBe(true);
    });
  });

  describe("discoverPrinters", () => {
    it("returns discovered printers from Tauri", async () => {
      mockInvoke.mockResolvedValueOnce([
        { systemName: "EPSON-1", friendlyName: "Epson TM-T20", connection: "USB", isDefault: true },
        { systemName: "EPSON-2", friendlyName: "Epson TM-T88", connection: "NETWORK", isDefault: false },
      ]);

      const printers = await service.discoverPrinters();

      expect(printers).toHaveLength(2);
      expect(printers[0].isDefault).toBe(true);
    });

    it("returns empty array on error", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("Discovery failed"));

      const printers = await service.discoverPrinters();

      expect(printers).toEqual([]);
    });
  });
});
