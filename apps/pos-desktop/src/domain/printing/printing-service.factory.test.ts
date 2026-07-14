/**
 * Tests for createPrintingServices — domain factory that wires printing
 * services together with external I/O callbacks.
 *
 * We mock every creation function imported by the factory and verify:
 * 1. All six services are returned and non-null.
 * 2. The printRouter receives the same printerConfig and printQueue.
 * 3. The configExport receives the discoverPrinters callback.
 * 4. The printerHealth receives the isOnline callback.
 * 5. The printQueue is created with the executePrint callback.
 */
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock service objects
// ---------------------------------------------------------------------------

const mockPrinterConfig = {
  listAll: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getPrinterForJobType: vi.fn(),
  resolvePrinterWithFallback: vi.fn(),
  assignJobsToPrinter: vi.fn(),
};

const mockPrintQueue = {
  enqueueJob: vi.fn(),
  processNextJob: vi.fn(),
  processAllPending: vi.fn(),
  retryJob: vi.fn(),
  listJobs: vi.fn(),
  getJob: vi.fn(),
  getQueueSummary: vi.fn(),
  countPendingForPrinter: vi.fn(),
};

const mockPrintRouter = {
  print: vi.fn(),
  tryServerFallback: vi.fn(),
};

const mockPrinterHealth = {
  start: vi.fn(),
  stop: vi.fn(),
  runHealthCheck: vi.fn(),
  isRunning: vi.fn(),
};

const mockConfigExport = {
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
  importFromData: vi.fn(),
};

const mockPrintingMetrics = {
  getPrintQueueSummary: vi.fn(),
  getPrinterStatusSummary: vi.fn(),
  getNonOnlinePrinterCount: vi.fn(),
  getHealthLine: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock creation functions (vitest hoists these above all imports)
// ---------------------------------------------------------------------------

vi.mock("./printer-config.service", () => ({
  createPrinterConfigService: vi.fn(() => mockPrinterConfig),
}));

vi.mock("./print-queue.service", () => ({
  createPrintQueueService: vi.fn(() => mockPrintQueue),
}));

vi.mock("./print-router", () => ({
  createPrintRouter: vi.fn(() => mockPrintRouter),
}));

vi.mock("./printer-health.service", () => ({
  createPrinterHealthService: vi.fn(() => mockPrinterHealth),
}));

vi.mock("./config-export.service", () => ({
  createConfigExportService: vi.fn(() => mockConfigExport),
}));

vi.mock("./printing-metrics.service", () => ({
  createPrintingMetricsService: vi.fn(() => mockPrintingMetrics),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { createPrintingServices } from "./printing-service.factory";
import { createPrinterConfigService } from "./printer-config.service";
import { createPrintQueueService } from "./print-queue.service";
import { createPrintRouter } from "./print-router";
import { createPrinterHealthService } from "./printer-health.service";
import { createConfigExportService } from "./config-export.service";
import { createPrintingMetricsService } from "./printing-metrics.service";

describe("createPrintingServices", () => {
  const mockPrisma = {
    printerConfig: { findMany: vi.fn(), findUnique: vi.fn() },
    printJob: { create: vi.fn() },
    printingMetrics: { findMany: vi.fn() },
  };

  const mockExecutePrint = vi.fn().mockResolvedValue({ success: true });
  const mockDiscoverPrinters = vi.fn().mockResolvedValue([]);
  const mockIsOnline = vi.fn().mockReturnValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an object with all six printing services defined", () => {
    const services = createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
        isOnline: mockIsOnline,
      },
    });

    expect(services.printerConfig).toBe(mockPrinterConfig);
    expect(services.printQueue).toBe(mockPrintQueue);
    expect(services.printRouter).toBe(mockPrintRouter);
    expect(services.printerHealth).toBe(mockPrinterHealth);
    expect(services.configExport).toBe(mockConfigExport);
    expect(services.printingMetrics).toBe(mockPrintingMetrics);
  });

  it("passes prisma to printerConfig service", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createPrinterConfigService).toHaveBeenCalledWith(mockPrisma);
  });

  it("passes prisma and executePrint to printQueue service", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    // The second arg is a resolvePrinter callback wrapped from printerConfig
    expect(createPrintQueueService).toHaveBeenCalledWith(
      mockPrisma,
      expect.any(Function),
      mockExecutePrint,
    );
  });

  it("wires printRouter with the same printerConfig and printQueue (no server config)", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createPrintRouter).toHaveBeenCalledWith(
      mockPrinterConfig,
      mockPrintQueue,
      undefined,
    );
  });

  it("wires printerHealth with printerConfig, printQueue, and isOnline callback", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
        isOnline: mockIsOnline,
      },
    });

    expect(createPrinterHealthService).toHaveBeenCalledWith(
      mockPrinterConfig,
      mockPrintQueue,
      mockIsOnline,
    );
  });

  it("wires configExport with printerConfig and discoverPrinters", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createConfigExportService).toHaveBeenCalledWith(
      mockPrinterConfig,
      mockDiscoverPrinters,
    );
  });

  it("passes prisma to printingMetrics service", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createPrintingMetricsService).toHaveBeenCalledWith(mockPrisma);
  });

  it("defaults isOnline to a function when omitted", () => {
    createPrintingServices({
      prisma: mockPrisma as any,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createPrinterHealthService).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    );
  });

  it("passes serverPrintConfig when provided", () => {
    const serverConfig = { baseUrl: "http://custom.local:4000", authToken: "abc" };

    createPrintingServices({
      prisma: mockPrisma as any,
      serverPrintConfig: serverConfig,
      io: {
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      },
    });

    expect(createPrintRouter).toHaveBeenCalledWith(
      mockPrinterConfig,
      mockPrintQueue,
      serverConfig,
    );
  });
});
