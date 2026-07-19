/**
 * Tests for initializeServices() pure function and useServiceInit() React hook.
 *
 * ## initializeServices()
 * A plain async function that creates all 17 domain services.  Every dependency
 * is injectable so tests avoid real PGlite, Tauri IPC, and network calls.
 *
 * ## useServiceInit()
 * A React hook wrapping initializeServices() in a useEffect with loading/ready/error
 * state and cancellation on unmount.
 *
 * ## Mock strategy
 * Top-level vi.mock calls apply to all tests.  For the pure function tests we
 * override dependencies via the `input` parameter.  For the hook tests we let
 * the default imports use the mocked modules.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock all module-level imports used by initializeServices()
// ---------------------------------------------------------------------------

const mockFiscalNumberingService = {
  nextNumber: vi.fn(),
  ensureCounters: vi.fn(),
  initializeCounters: vi.fn(),
};
const mockContingencyService = {
  isInContingency: vi.fn(),
  enterContingency: vi.fn(),
  endContingency: vi.fn(),
  hydrateStore: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
};
const mockInvoiceService = {
  generateInvoiceForSale: vi.fn(),
  generateCreditNoteForReturn: vi.fn(),
  cancelInvoice: vi.fn(),
  applyTransmissionResult: vi.fn(),
  findById: vi.fn(),
};
const mockFiscalScheduler = { start: vi.fn(), stop: vi.fn(), checkNow: vi.fn() };

const mockFiscalServices = {
  fiscalNumberingService: mockFiscalNumberingService,
  contingencyService: mockContingencyService,
  invoiceService: mockInvoiceService,
  fiscalScheduler: mockFiscalScheduler,
};

vi.mock("../../domain/fiscal/fiscal-service.factory", () => ({
  createFiscalServices: vi.fn(() => mockFiscalServices),
}));

const mockPrinterConfig = {
  listAll: vi.fn(),
  getPrinterForJobType: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
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
const mockPrintRouter = { print: vi.fn(), tryServerFallback: vi.fn() };
const mockPrinterHealth = {
  start: vi.fn(), stop: vi.fn(), runHealthCheck: vi.fn(), isRunning: vi.fn(),
};
const mockConfigExport = { exportConfig: vi.fn(), importConfig: vi.fn(), importFromData: vi.fn() };
const mockPrintingMetrics = {
  getPrintQueueSummary: vi.fn(), getPrinterStatusSummary: vi.fn(),
  getNonOnlinePrinterCount: vi.fn(), getHealthLine: vi.fn(),
};

const mockPrintingServices = {
  printerConfig: mockPrinterConfig,
  printQueue: mockPrintQueue,
  printRouter: mockPrintRouter,
  printerHealth: mockPrinterHealth,
  configExport: mockConfigExport,
  printingMetrics: mockPrintingMetrics,
};

vi.mock("../../domain/printing/printing-service.factory", () => ({
  createPrintingServices: vi.fn(() => mockPrintingServices),
}));

const mockCashDrawer = { openDrawer: vi.fn(), getDrawerConfig: vi.fn(), updateDrawerConfig: vi.fn(), getOpenMode: vi.fn() };
const mockCustomerDisplay = {
  showWelcome: vi.fn(), showLineItems: vi.fn(), showTotal: vi.fn(),
  showChangeDue: vi.fn(), showThankYou: vi.fn(), updateConfig: vi.fn(),
  getConfig: vi.fn(), getStatus: vi.fn(),
};

const mockPeripheralServices = { cashDrawer: mockCashDrawer, customerDisplay: mockCustomerDisplay };

vi.mock("../../domain/peripherals/peripheral-service.factory", () => ({
  createPeripheralServices: vi.fn(() => mockPeripheralServices),
}));

const mockReturnsService = { createReturn: vi.fn(), confirmReturn: vi.fn(), cancelReturn: vi.fn(), getReturn: vi.fn(), searchSaleForReturn: vi.fn() };
const mockInventoryAdjustmentsService = { createAdjustment: vi.fn(), confirmAdjustment: vi.fn(), cancelAdjustment: vi.fn(), getAdjustment: vi.fn() };
const mockPrescriptionsService = { createPrescription: vi.fn(), getPrescription: vi.fn(), listPending: vi.fn() };
const mockRecoveryLogService = { log: vi.fn(), list: vi.fn() };

const mockDomainServices = {
  returnsService: mockReturnsService,
  inventoryAdjustmentsService: mockInventoryAdjustmentsService,
  prescriptionsService: mockPrescriptionsService,
  recoveryLogService: mockRecoveryLogService,
};

vi.mock("../../domain/domain-services/domain-service.factory", () => ({
  createDomainServices: vi.fn(() => mockDomainServices),
}));

const mockBackupService = {
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
  verifyBackup: vi.fn(),
  uploadBackup: vi.fn(),
  listBackups: vi.fn(),
  getHealth: vi.fn(),
  getStatus: vi.fn(),
};

vi.mock("../../domain/backup/backup.service", () => ({
  createBackupService: vi.fn(() => mockBackupService),
}));

const mockUpdateService = {
  checkForUpdates: vi.fn(),
  applyUpdate: vi.fn(),
  startTelemetryFlush: vi.fn(),
};

vi.mock("../../domain/updates/update.service", () => ({
  createUpdateService: vi.fn(() => mockUpdateService),
}));

const mockAuthService = {
  login: vi.fn(),
  logout: vi.fn(),
  requireRole: vi.fn(),
  getCurrentSession: vi.fn(),
  refreshSession: vi.fn(),
};

vi.mock("../../domain/auth/auth.service", () => ({
  createAuthService: vi.fn(() => mockAuthService),
}));

vi.mock("../../domain/updates/update.store", () => ({
  useUpdateStore: {
    getState: vi.fn(() => ({
      hydrateFromDb: vi.fn(),
    })),
  },
}));

// Mock getLocalDatabase so useServiceInit() hook does not attempt real PGlite init.
vi.mock("../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn(),
}));

// Mock the tech key check so default initializeServices() does not throw.
vi.mock("../../config/fiscal", () => ({
  isContingencyTechKeyPlaceholder: vi.fn(() => false),
  CONTINGENCY_TECH_KEY: "test-tech-key-not-placeholder",
  CONTINGENCY_TRANSMISSION_WINDOW_HOURS: 48,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { initializeServices, useServiceInit } from "./use-service-init";
import { createFiscalServices } from "../../domain/fiscal/fiscal-service.factory";
import { createPrintingServices } from "../../domain/printing/printing-service.factory";
import { createPeripheralServices } from "../../domain/peripherals/peripheral-service.factory";
import { createDomainServices } from "../../domain/domain-services/domain-service.factory";
import { createBackupService } from "../../domain/backup/backup.service";
import { createUpdateService } from "../../domain/updates/update.service";
import { createAuthService } from "../../domain/auth/auth.service";
import { getLocalDatabase } from "../../infrastructure/local-database";
import { useUpdateStore } from "../../domain/updates/update.store";

// =========================================================================
// Shared test data
// =========================================================================

const mockPrisma = {
  fiscalCounter: { findUnique: vi.fn(), upsert: vi.fn() },
  printerConfig: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  printJob: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  printingMetrics: { findMany: vi.fn() },
  syncQueue: { count: vi.fn(), aggregate: vi.fn() },
  updateState: { findUnique: vi.fn() },
  contingencyEvent: { findFirst: vi.fn() },
  clientReturn: { findMany: vi.fn() },
} as any;

const mockExecutePrint = vi.fn().mockResolvedValue({ success: true });
const mockDiscoverPrinters = vi.fn().mockResolvedValue([]);
const mockGetSession = () => ({
  session: {
    userId: "user-1",
    workstationId: "ws-001",
    accessToken: "tok_abc123",
  },
});

// =========================================================================
// initializeServices() — pure async function
// =========================================================================

describe("initializeServices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("returns all 17 services defined", async () => {
      const services = await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
        isOnline: () => true,
      });

      expect(services.returnsService).toBe(mockReturnsService);
      expect(services.inventoryAdjustmentsService).toBe(mockInventoryAdjustmentsService);
      expect(services.prescriptionsService).toBe(mockPrescriptionsService);
      expect(services.recoveryLogService).toBe(mockRecoveryLogService);
      expect(services.backupService).toBe(mockBackupService);
      expect(services.invoiceService).toBe(mockInvoiceService);
      expect(services.contingencyService).toBe(mockContingencyService);
      expect(services.fiscalNumberingService).toBe(mockFiscalNumberingService);
      expect(services.fiscalScheduler).toBe(mockFiscalScheduler);
      expect(services.printerConfigService).toBe(mockPrinterConfig);
      expect(services.printQueueService).toBe(mockPrintQueue);
      expect(services.printRouter).toBe(mockPrintRouter);
      expect(services.printerHealthService).toBe(mockPrinterHealth);
      expect(services.configExportService).toBe(mockConfigExport);
      expect(services.printingMetricsService).toBe(mockPrintingMetrics);
      expect(services.cashDrawerService).toBe(mockCashDrawer);
      expect(services.customerDisplayService).toBe(mockCustomerDisplay);
      expect(services.updateService).toBe(mockUpdateService);
    });
  });

  describe("parameter injection", () => {
    it("calls getLocalDatabase when injected", async () => {
      const mockGetDb = vi.fn().mockResolvedValue({ prisma: mockPrisma });

      await initializeServices({
        getLocalDatabase: mockGetDb,
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(mockGetDb).toHaveBeenCalledOnce();
    });

    it("passes executePrint and discoverPrinters to printing factory", async () => {
      const execPrint = vi.fn().mockResolvedValue({ success: true });
      const discPrinters = vi.fn().mockResolvedValue([]);

      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: execPrint,
        discoverPrinters: discPrinters,
      });

      expect(createPrintingServices).toHaveBeenCalledWith(
        expect.objectContaining({
          io: expect.objectContaining({
            executePrint: execPrint,
            discoverPrinters: discPrinters,
          }),
        }),
      );
    });

    it("uses injected getSession for workstationId", async () => {
      const getSession = vi.fn(() => ({
        session: { userId: "u1", workstationId: "ws-custom", accessToken: "tok" },
      }));

      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createFiscalServices).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: "ws-custom" }),
      );
    });

    it("calls checkTechKey and throws when it returns true", async () => {
      const checkTechKey = vi.fn(() => true);

      await expect(
        initializeServices({
          getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
          checkTechKey,
          getSession: mockGetSession,
          executePrint: mockExecutePrint,
          discoverPrinters: mockDiscoverPrinters,
        }),
      ).rejects.toThrow(/clave t.cnica de contingencia/i);
    });

    it("falls back to env var WORKSTATION_ID when no session and no override", async () => {
      // Session returns null (not yet logged in)
      const nullSession = vi.fn(() => ({ session: null }));

      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: nullSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      // WORKSTATION_ID defaults to "ws_principal" in test environment
      expect(createFiscalServices).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: "ws_principal" }),
      );
    });

    it("uses explicit workstationId override instead of session or env var", async () => {
      const sessionWithWs = vi.fn(() => ({
        session: { userId: "u1", workstationId: "ws-session", accessToken: "tok" },
      }));

      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: sessionWithWs,
        workstationId: "ws-override",
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      // Explicit override wins over session value
      expect(createFiscalServices).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: "ws-override" }),
      );
    });

    it("uses session workstationId over env var when no explicit override", async () => {
      const sessionWithWs = vi.fn(() => ({
        session: { userId: "u1", workstationId: "ws-from-session", accessToken: "tok" },
      }));

      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: sessionWithWs,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      // Session value beats env var default
      expect(createFiscalServices).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: "ws-from-session" }),
      );
    });
  });

  describe("factory wiring", () => {
    it("passes workstationId to fiscal factory", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: () => ({
          session: { userId: "u1", workstationId: "ws-xyz", accessToken: "tok" },
        }),
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createFiscalServices).toHaveBeenCalledWith(
        expect.objectContaining({ workstationId: "ws-xyz" }),
      );
    });

    it("creates peripheral services from printerConfig", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createPeripheralServices).toHaveBeenCalledWith(mockPrinterConfig);
    });

    it("creates auth service with the correct base URL", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://custom.api:4000",
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createAuthService).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://custom.api:4000" }),
      );
    });

    it("creates domain services with auth, invoiceService, and printRouter", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createDomainServices).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: mockAuthService,
          invoiceService: mockInvoiceService,
          printRouter: mockPrintRouter,
        }),
      );
    });
  });

  describe("side effects", () => {
    it("hydrates the contingency store", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(mockContingencyService.hydrateStore).toHaveBeenCalledOnce();
    });

    it("starts the printer health check loop", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(mockPrinterHealth.start).toHaveBeenCalledOnce();
    });

    it("starts telemetry flush on the update service", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(mockUpdateService.startTelemetryFlush).toHaveBeenCalledOnce();
    });
  });

  describe("update service creation", () => {
    it("passes prisma, version, workstationId to createUpdateService", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        checkTechKey: () => false,
        currentVersion: "2.0.0",
        getSession: mockGetSession,
        executePrint: mockExecutePrint,
        discoverPrinters: mockDiscoverPrinters,
      });

      expect(createUpdateService).toHaveBeenCalledWith(
        expect.objectContaining({
          prisma: mockPrisma,
          currentVersion: "2.0.0",
          workstationId: "ws-001",
          licenseId: "unknown",
        }),
      );
    });
  });

  describe("tech key guard", () => {
    it("throws descriptive error when checkTechKey returns true", async () => {
      await expect(
        initializeServices({
          getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
          checkTechKey: () => true,
          getSession: mockGetSession,
          executePrint: mockExecutePrint,
          discoverPrinters: mockDiscoverPrinters,
        }),
      ).rejects.toThrow(/La clave t.cnica de contingencia no ha sido configurada/);
    });
  });
});

// =========================================================================
// useServiceInit() — React hook
// =========================================================================

describe("useServiceInit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default getLocalDatabase mock so the hook can resolve.
    vi.mocked(getLocalDatabase).mockResolvedValue({ prisma: mockPrisma });
  });

  describe("state transitions", () => {
    it("starts in loading state", () => {
      // Keep initializeServices pending so loading persists.
      vi.mocked(getLocalDatabase).mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      const { result } = renderHook(() => useServiceInit());

      expect(result.current.status).toBe("loading");
    });

    it("transitions to ready when initialization succeeds", async () => {
      vi.mocked(getLocalDatabase).mockResolvedValue({ prisma: mockPrisma });

      const { result } = renderHook(() => useServiceInit());

      await waitFor(() => {
        expect(result.current.status).toBe("ready");
      });

      if (result.current.status === "ready") {
        expect(result.current.services.returnsService).toBe(mockReturnsService);
        expect(result.current.services.invoiceService).toBe(mockInvoiceService);
      }
    });

    it("transitions to error when getLocalDatabase throws", async () => {
      const dbError = new Error("PGlite connection failed");
      vi.mocked(getLocalDatabase).mockRejectedValue(dbError);

      const { result } = renderHook(() => useServiceInit());

      await waitFor(() => {
        expect(result.current.status).toBe("error");
      });

      if (result.current.status === "error") {
        expect(result.current.error).toBe(dbError);
      }
    });

    it("wraps a thrown non-Error value in an Error object", async () => {
      vi.mocked(getLocalDatabase).mockRejectedValue("raw string error");

      const { result } = renderHook(() => useServiceInit());

      await waitFor(() => {
        expect(result.current.status).toBe("error");
      });

      if (result.current.status === "error") {
        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error.message).toBe("raw string error");
      }
    });
  });

  describe("cleanup on unmount", () => {
    it("does not call setState after unmount", async () => {
      let resolvePromise: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(getLocalDatabase).mockReturnValue(pendingPromise as any);

      const { result, unmount } = renderHook(() => useServiceInit());

      // Unmount before the promise resolves
      unmount();

      // Now resolve the promise
      resolvePromise!({ prisma: mockPrisma });

      // Wait a tick then verify the state stayed at loading
      await new Promise((r) => setTimeout(r, 10));
      expect(result.current.status).toBe("loading");
    });
  });
});
