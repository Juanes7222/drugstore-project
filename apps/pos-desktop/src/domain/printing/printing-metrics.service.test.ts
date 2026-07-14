/**
 * Tests for the printing metrics service.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  createPrintingMetricsService,
  type PrintingMetricsService,
} from "./printing-metrics.service";

function createMockPrisma() {
  return {
    printJob: {
      count: vi.fn(async (args?: any) => {
        // Return specific counts based on status filter
        const status = args?.where?.status;
        if (status === "PENDING") return 3;
        if (status === "PRINTING") return 1;
        if (status === "FAILED") return 2;
        if (status === "DISCARDED") return 1;
        if (status === "COMPLETED") return 10;
        // If there's a not condition
        if (args?.where?.status?.not === "ONLINE") return 2;
        return 0;
      }),
      findMany: vi.fn(async (args?: any) => {
        if (args?.where?.status === "COMPLETED") {
          return [
            { attempts: 1 },
            { attempts: 2 },
            { attempts: 1 },
          ];
        }
        return [];
      }),
    },
    printerConfig: {
      findMany: vi.fn(async (args?: any) => [
        { status: "ONLINE" },
        { status: "ONLINE" },
        { status: "OFFLINE" },
        { status: "ERROR" },
        { status: "NO_PAPER" },
      ]),
      count: vi.fn(async () => 5),
    },
  };
}

describe("PrintingMetricsService", () => {
  let service: PrintingMetricsService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = createPrintingMetricsService(mockPrisma as any);
  });

  describe("getPrintQueueSummary", () => {
    it("returns queue counts from Prisma", async () => {
      const summary = await service.getPrintQueueSummary();

      expect(summary.pending).toBe(3);
      expect(summary.printing).toBe(1);
      expect(summary.failed).toBe(2);
      expect(summary.discarded).toBe(1);
      expect(summary.completed24h).toBe(10);
    });

    it("calculates average attempts before success", async () => {
      const summary = await service.getPrintQueueSummary();

      // (1 + 2 + 1) / 3 = 1.33
      expect(summary.averageAttemptsBeforeSuccess).toBeCloseTo(1.33, 1);
    });

    it("returns 0 for average attempts when no completed jobs", async () => {
      mockPrisma.printJob.findMany.mockResolvedValueOnce([]);

      const summary = await service.getPrintQueueSummary();

      expect(summary.averageAttemptsBeforeSuccess).toBe(0);
    });
  });

  describe("getPrinterStatusSummary", () => {
    it("counts printers by status", async () => {
      const summary = await service.getPrinterStatusSummary();

      expect(summary.online).toBe(2);
      expect(summary.offline).toBe(1);
      expect(summary.error).toBe(1);
      expect(summary.noPaper).toBe(1);
      expect(summary.unknown).toBe(0);
    });
  });

  describe("getNonOnlinePrinterCount", () => {
    it("counts printers not ONLINE", async () => {
      const count = await service.getNonOnlinePrinterCount();

      expect(count).toBe(2);
    });
  });

  describe("getHealthLine", () => {
    it("returns a human-readable summary string", async () => {
      const line = await service.getHealthLine();

      expect(line).toContain("2 impresora(s) en línea");
      expect(line).toContain("1 offline");
      expect(line).toContain("1 con error");
      expect(line).toContain("1 sin papel");
      expect(line).toContain("3 trabajo(s) pendiente(s)");
      expect(line).toContain("2 fallido(s)");
    });

    it("returns a default message when everything is fine", async () => {
      mockPrisma.printJob.count = vi.fn().mockResolvedValue(0);
      mockPrisma.printerConfig.findMany = vi.fn().mockResolvedValue([
        { status: "ONLINE" },
      ]);

      const line = await service.getHealthLine();

      expect(line).toContain("1 impresora(s) en línea");
    });
  });
});
