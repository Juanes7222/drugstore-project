/**
 * Tests for the print router.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createPrintRouter, type PrintRouter, type PrintInput } from "./print-router";
import type { PrinterConfigService } from "./printer-config.service";
import type { PrintQueueService } from "./print-queue.service";
import { PrintJobType, PrintPayloadType, type PrintJobRecord } from "./printing-types";

describe("PrintRouter", () => {
  let router: PrintRouter;
  let mockPrinterConfigService: Partial<PrinterConfigService>;
  let mockPrintQueueService: Partial<PrintQueueService>;

  beforeEach(() => {
    mockPrinterConfigService = {
      resolvePrinterWithFallback: vi.fn(),
    };

    mockPrintQueueService = {
      enqueueJob: vi.fn(),
      processNextJob: vi.fn().mockResolvedValue(undefined),
    };

    router = createPrintRouter(
      mockPrinterConfigService as PrinterConfigService,
      mockPrintQueueService as PrintQueueService,
    );
  });

  const validPayload: PrintInput = {
    payloadPath: "/tmp/receipt.pdf",
    payloadType: PrintPayloadType.PDF,
  };

  describe("print", () => {
    it("enqueues the job and returns the print job record", async () => {
      const mockJobRecord = { id: "job-1", jobType: "SALE_RECEIPT" } as PrintJobRecord;
      mockPrintQueueService.enqueueJob = vi.fn().mockResolvedValue(mockJobRecord);

      const result = await router.print(PrintJobType.SALE_RECEIPT, validPayload);

      expect(result.id).toBe("job-1");
      expect(mockPrintQueueService.enqueueJob).toHaveBeenCalledWith({
        jobType: "SALE_RECEIPT",
        payloadPath: "/tmp/receipt.pdf",
        payloadType: "PDF",
        createdBySaleId: null,
        createdByUserId: null,
      });
    });

    it("passes saleId and userId when provided", async () => {
      const mockJobRecord = { id: "job-2" } as PrintJobRecord;
      mockPrintQueueService.enqueueJob = vi.fn().mockResolvedValue(mockJobRecord);

      await router.print(PrintJobType.SALE_RECEIPT, {
        ...validPayload,
        saleId: "sale-1",
        userId: "user-1",
      });

      expect(mockPrintQueueService.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBySaleId: "sale-1",
          createdByUserId: "user-1",
        }),
      );
    });

    it("calls processNextJob when printer is online", async () => {
      const mockJobRecord = { id: "job-3" } as PrintJobRecord;
      mockPrintQueueService.enqueueJob = vi.fn().mockResolvedValue(mockJobRecord);
      mockPrinterConfigService.resolvePrinterWithFallback = vi
        .fn()
        .mockResolvedValue({
          printer: { id: "printer-1", status: "ONLINE" },
          usedFallback: false,
        });

      await router.print(PrintJobType.SALE_RECEIPT, validPayload);

      expect(mockPrintQueueService.processNextJob).toHaveBeenCalled();
    });

    it("does not call processNextJob when no printer is found", async () => {
      const mockJobRecord = { id: "job-4" } as PrintJobRecord;
      mockPrintQueueService.enqueueJob = vi.fn().mockResolvedValue(mockJobRecord);
      mockPrinterConfigService.resolvePrinterWithFallback = vi
        .fn()
        .mockResolvedValue(null);

      await router.print(PrintJobType.SALE_RECEIPT, validPayload);

      expect(mockPrintQueueService.processNextJob).not.toHaveBeenCalled();
    });
  });

  describe("tryServerFallback", () => {
    it("returns false when no server config is configured", async () => {
      const routerNoServer = createPrintRouter(
        mockPrinterConfigService as PrinterConfigService,
        mockPrintQueueService as PrintQueueService,
      );

      const result = await routerNoServer.tryServerFallback(
        PrintJobType.SALE_RECEIPT,
        validPayload,
      );

      expect(result).toBe(false);
    });

    it("returns true when server responds with ok", async () => {
      const routerWithServer = createPrintRouter(
        mockPrinterConfigService as PrinterConfigService,
        mockPrintQueueService as PrintQueueService,
        { baseUrl: "http://server:3000", authToken: "token-123" },
      );

      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      const result = await routerWithServer.tryServerFallback(
        PrintJobType.SALE_RECEIPT,
        validPayload,
      );

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://server:3000/print/fallback",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token-123",
          }),
        }),
      );
    });

    it("returns false on network error", async () => {
      const routerWithServer = createPrintRouter(
        mockPrinterConfigService as PrinterConfigService,
        mockPrintQueueService as PrintQueueService,
        { baseUrl: "http://server:3000" },
      );

      global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

      const result = await routerWithServer.tryServerFallback(
        PrintJobType.SALE_RECEIPT,
        validPayload,
      );

      expect(result).toBe(false);
    });
  });
});
