/**
 * Tests for the printer health check service.
 * Since this service depends heavily on Tauri IPC and external hardware,
 * tests focus on the domain logic boundaries by mocking dependencies.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createPrinterHealthService,
  type PrinterHealthService,
} from "./printer-health.service";
import type { PrinterConfigService } from "./printer-config.service";
import type { PrintQueueService } from "./print-queue.service";
import { PrinterStatusCode } from "./printing-types";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}));

describe("PrinterHealthService", () => {
  let service: PrinterHealthService;
  let mockPrinterConfigService: Partial<PrinterConfigService>;
  let mockPrintQueueService: Partial<PrintQueueService>;
  let isOnline: () => boolean;

  beforeEach(() => {
    vi.clearAllMocks();

    isOnline = vi.fn().mockReturnValue(true);

    mockPrinterConfigService = {
      listAll: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockPrintQueueService = {
      processAllPending: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }),
    };

    service = createPrinterHealthService(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
      isOnline,
    );
  });

  describe("isRunning", () => {
    it("returns false before start()", () => {
      expect(service.isRunning()).toBe(false);
    });

    it("returns true after start()", () => {
      service.start();
      expect(service.isRunning()).toBe(true);
    });

    it("returns false after stop()", () => {
      service.start();
      service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe("runHealthCheck", () => {
    it("returns a report with checkedCount 0 when no printers exist", async () => {
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue([]);

      const report = await service.runHealthCheck();

      expect(report.checkedCount).toBe(0);
      expect(report.statusChanges).toEqual([]);
      expect(report.pendingJobsProcessed).toBe(0);
    });

    it("checks all printers and returns the report", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-T20",
          friendlyName: "Main Printer",
          status: "ONLINE" as PrinterStatusCode,
        },
        {
          id: "printer-2",
          systemName: "EPSON-TM-T88",
          friendlyName: "Secondary",
          status: "UNKNOWN" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke
        .mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" })
        .mockResolvedValueOnce({ status: "NO_PAPER", statusMessage: "Sin papel" });

      const report = await service.runHealthCheck();

      expect(report.checkedCount).toBe(2);
      expect(mockInvoke).toHaveBeenCalledWith("get_printer_status", {
        printerSystemName: "EPSON-TM-T20",
      });
      expect(mockInvoke).toHaveBeenCalledWith("get_printer_status", {
        printerSystemName: "EPSON-TM-T88",
      });
    });

    it("calls printerConfigService.updateStatus for each printer", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-T20",
          friendlyName: "Main",
          status: "UNKNOWN" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke.mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" });

      await service.runHealthCheck();

      expect(mockPrinterConfigService.updateStatus).toHaveBeenCalledWith(
        "printer-1",
        "ONLINE",
        "Ready",
      );
    });

    it("detects status changes", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-T20",
          friendlyName: "Main",
          status: "OFFLINE" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke.mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" });

      const report = await service.runHealthCheck();

      expect(report.statusChanges).toHaveLength(1);
      expect(report.statusChanges[0]).toEqual({
        printerId: "printer-1",
        friendlyName: "Main",
        previousStatus: "OFFLINE",
        newStatus: "ONLINE",
      });
    });

    it("marks printer as UNKNOWN when invoke fails", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-UNKNOWN",
          friendlyName: "Lost",
          status: "ONLINE" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke.mockRejectedValueOnce(new Error("Device not found"));

      await service.runHealthCheck();

      expect(mockPrinterConfigService.updateStatus).toHaveBeenCalledWith(
        "printer-1",
        "UNKNOWN",
        expect.stringContaining("Device not found"),
      );
    });

    it("processes pending jobs when printer transitions from OFFLINE to ONLINE", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-T20",
          friendlyName: "Main",
          status: "OFFLINE" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke.mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" });
      mockPrintQueueService.processAllPending = vi
        .fn()
        .mockResolvedValue({ processed: 2, failed: 1 });

      const report = await service.runHealthCheck();

      expect(mockPrintQueueService.processAllPending).toHaveBeenCalled();
      expect(report.pendingJobsProcessed).toBe(2);
    });

    it("does not process pending jobs when status does not change to ONLINE", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-TM-T20",
          friendlyName: "Main",
          status: "ONLINE" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke.mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" });

      await service.runHealthCheck();

      expect(mockPrintQueueService.processAllPending).not.toHaveBeenCalled();
    });

    it("continues checking remaining printers when one fails", async () => {
      const mockPrinters = [
        {
          id: "printer-1",
          systemName: "EPSON-1",
          friendlyName: "Failing",
          status: "UNKNOWN" as PrinterStatusCode,
        },
        {
          id: "printer-2",
          systemName: "EPSON-2",
          friendlyName: "Working",
          status: "UNKNOWN" as PrinterStatusCode,
        },
      ];
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue(mockPrinters);
      mockInvoke
        .mockRejectedValueOnce(new Error("Communication error"))
        .mockResolvedValueOnce({ status: "ONLINE", statusMessage: "Ready" });

      const report = await service.runHealthCheck();

      expect(report.checkedCount).toBe(2);
      expect(report.statusChanges).toHaveLength(1);
    });

    it("handles empty printer list gracefully", async () => {
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue([]);

      await expect(service.runHealthCheck()).resolves.toEqual({
        checkedCount: 0,
        statusChanges: [],
        pendingJobsProcessed: 0,
      });
    });
  });

  describe("start / stop", () => {
    beforeEach(() => {
      // Mock timers to prevent actual interval
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("runs health check immediately on start", () => {
      mockPrinterConfigService.listAll = vi.fn().mockResolvedValue([]);

      service.start();

      expect(mockPrinterConfigService.listAll).toHaveBeenCalled();
    });

    it("does not start twice", () => {
      service.start();
      const callCount = (mockPrinterConfigService.listAll as any).mock?.calls?.length ?? 0;

      service.start();

      // listAll should not have been called again
      expect(mockPrinterConfigService.listAll).toHaveBeenCalledTimes(callCount);
    });

    it("stop() stops the health check loop", () => {
      service.start();
      service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it("start() after stop() restarts the loop", () => {
      service.start();
      service.stop();
      service.start();
      expect(service.isRunning()).toBe(true);
    });
  });
});
