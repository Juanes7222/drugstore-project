/**
 * Tests for SyncScheduler creation inside initializeServices().
 *
 * Follows the same module-level mocking pattern as the existing
 * use-service-init.test.tsx but focuses on sync-scheduler-specific
 * assertions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must use vi.hoisted so the references are
// available when vi.mock factories are hoisted to the top of the file.
// ---------------------------------------------------------------------------

const {
  mockFiscalNumberingService,
  mockContingencyService,
  mockInvoiceService,
  mockFiscalScheduler,
  mockFiscalServices,
  mockPrinterConfig,
  mockPrintQueue,
  mockPrintRouter,
  mockPrinterHealth,
  mockConfigExport,
  mockPrintingMetrics,
  mockPrintingServices,
  mockCashDrawer,
  mockCustomerDisplay,
  mockPeripheralServices,
  mockReturnsService,
  mockInventoryAdjustmentsService,
  mockPrescriptionsService,
  mockRecoveryLogService,
  mockDomainServices,
  mockBackupService,
  mockUpdateService,
  mockAuthService,
  mockSyncSchedulerInstance,
  mockCreateSyncScheduler,
} = vi.hoisted(() => {
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
  const mockFiscalScheduler = {
    start: vi.fn(),
    stop: vi.fn(),
    checkNow: vi.fn(),
  };
  const mockFiscalServices = {
    fiscalNumberingService: mockFiscalNumberingService,
    contingencyService: mockContingencyService,
    invoiceService: mockInvoiceService,
    fiscalScheduler: mockFiscalScheduler,
  };

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
  const mockPrintingServices = {
    printerConfig: mockPrinterConfig,
    printQueue: mockPrintQueue,
    printRouter: mockPrintRouter,
    printerHealth: mockPrinterHealth,
    configExport: mockConfigExport,
    printingMetrics: mockPrintingMetrics,
  };

  const mockCashDrawer = {
    openDrawer: vi.fn(),
    getDrawerConfig: vi.fn(),
    updateDrawerConfig: vi.fn(),
    getOpenMode: vi.fn(),
  };
  const mockCustomerDisplay = {
    showWelcome: vi.fn(),
    showLineItems: vi.fn(),
    showTotal: vi.fn(),
    showChangeDue: vi.fn(),
    showThankYou: vi.fn(),
    updateConfig: vi.fn(),
    getConfig: vi.fn(),
    getStatus: vi.fn(),
  };
  const mockPeripheralServices = {
    cashDrawer: mockCashDrawer,
    customerDisplay: mockCustomerDisplay,
  };

  const mockReturnsService = {
    createReturn: vi.fn(),
    confirmReturn: vi.fn(),
    cancelReturn: vi.fn(),
    getReturn: vi.fn(),
    searchSaleForReturn: vi.fn(),
  };
  const mockInventoryAdjustmentsService = {
    createAdjustment: vi.fn(),
    confirmAdjustment: vi.fn(),
    cancelAdjustment: vi.fn(),
    getAdjustment: vi.fn(),
  };
  const mockPrescriptionsService = {
    createPrescription: vi.fn(),
    getPrescription: vi.fn(),
    listPending: vi.fn(),
  };
  const mockRecoveryLogService = { log: vi.fn(), list: vi.fn() };
  const mockDomainServices = {
    returnsService: mockReturnsService,
    inventoryAdjustmentsService: mockInventoryAdjustmentsService,
    prescriptionsService: mockPrescriptionsService,
    recoveryLogService: mockRecoveryLogService,
  };

  const mockBackupService = {
    createBackup: vi.fn(),
    restoreBackup: vi.fn(),
    verifyBackup: vi.fn(),
    uploadBackup: vi.fn(),
    listBackups: vi.fn(),
    getHealth: vi.fn(),
    getStatus: vi.fn(),
  };

  const mockUpdateService = {
    checkForUpdates: vi.fn(),
    applyUpdate: vi.fn(),
    startTelemetryFlush: vi.fn(),
  };

  const mockAuthService = {
    login: vi.fn(),
    logout: vi.fn(),
    requireRole: vi.fn(),
    getCurrentSession: vi.fn(),
    refreshSession: vi.fn(),
  };

  const mockSyncSchedulerInstance = {
    updateAccessToken: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    syncNow: vi.fn(),
  };
  const mockCreateSyncScheduler = vi.fn(() => mockSyncSchedulerInstance);

  return {
    mockFiscalNumberingService,
    mockContingencyService,
    mockInvoiceService,
    mockFiscalScheduler,
    mockFiscalServices,
    mockPrinterConfig,
    mockPrintQueue,
    mockPrintRouter,
    mockPrinterHealth,
    mockConfigExport,
    mockPrintingMetrics,
    mockPrintingServices,
    mockCashDrawer,
    mockCustomerDisplay,
    mockPeripheralServices,
    mockReturnsService,
    mockInventoryAdjustmentsService,
    mockPrescriptionsService,
    mockRecoveryLogService,
    mockDomainServices,
    mockBackupService,
    mockUpdateService,
    mockAuthService,
    mockSyncSchedulerInstance,
    mockCreateSyncScheduler,
  };
});

// ---------------------------------------------------------------------------
// Module-level mocks — references point to hoisted variables above so the
// factories are available when these vi.mock calls are hoisted.
// ---------------------------------------------------------------------------

vi.mock("../../domain/fiscal/fiscal-service.factory", () => ({
  createFiscalServices: vi.fn(() => mockFiscalServices),
}));

vi.mock("../../domain/printing/printing-service.factory", () => ({
  createPrintingServices: vi.fn(() => mockPrintingServices),
}));

vi.mock("../../domain/peripherals/peripheral-service.factory", () => ({
  createPeripheralServices: vi.fn(() => mockPeripheralServices),
}));

vi.mock("../../domain/domain-services/domain-service.factory", () => ({
  createDomainServices: vi.fn(() => mockDomainServices),
}));

vi.mock("../../domain/backup/backup.service", () => ({
  createBackupService: vi.fn(() => mockBackupService),
}));

vi.mock("../../domain/updates/update.service", () => ({
  createUpdateService: vi.fn(() => mockUpdateService),
}));

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

vi.mock("../../infrastructure/local-database", () => ({
  getLocalDatabase: vi.fn(),
}));

vi.mock("../../config/fiscal", () => ({
  isContingencyTechKeyPlaceholder: vi.fn(() => false),
  CONTINGENCY_TECH_KEY: "test-tech-key-not-placeholder",
  CONTINGENCY_TRANSMISSION_WINDOW_HOURS: 48,
}));

vi.mock("../../domain/sync/sync-scheduler.service", () => ({
  createSyncScheduler: mockCreateSyncScheduler,
  SyncScheduler: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { initializeServices } from "./use-service-init";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockPrisma = {} as any;

const VALID_SESSION = {
  session: {
    userId: "user-1",
    workstationId: "ws-001",
    accessToken: "tok_abc123",
  },
};

const NULL_SESSION = { session: null };

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("initializeServices — sync scheduler creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("syncScheduler in returned services", () => {
    it("includes syncScheduler in the returned Services object", async () => {
      const services = await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => VALID_SESSION,
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(services).toHaveProperty("syncScheduler");
      expect(services.syncScheduler).toBe(mockSyncSchedulerInstance);
    });
  });

  describe("createSyncScheduler arguments", () => {
    it("passes prisma client to createSyncScheduler", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => VALID_SESSION,
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(mockCreateSyncScheduler).toHaveBeenCalledWith(
        expect.objectContaining({ prisma: mockPrisma }),
      );
    });

    it("passes baseUrl to createSyncScheduler", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://custom.api:4000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => VALID_SESSION,
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(mockCreateSyncScheduler).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "http://custom.api:4000" }),
      );
    });

    it("passes accessToken from session when available", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => ({
          session: {
            userId: "user-1",
            workstationId: "ws-001",
            accessToken: "session-token-xyz",
          },
        }),
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(mockCreateSyncScheduler).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: "session-token-xyz" }),
      );
    });

    it("sets accessToken to undefined when session is null", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => NULL_SESSION,
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(mockCreateSyncScheduler).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: undefined }),
      );
    });

    it("passes invoiceService from fiscal services", async () => {
      await initializeServices({
        getLocalDatabase: () => Promise.resolve({ prisma: mockPrisma }),
        apiBaseUrl: "http://localhost:3000",
        checkTechKey: () => false,
        currentVersion: "1.0.0",
        getSession: () => VALID_SESSION,
        executePrint: vi.fn().mockResolvedValue({ success: true }),
        discoverPrinters: vi.fn().mockResolvedValue([]),
        isOnline: () => true,
      });

      expect(mockCreateSyncScheduler).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceService: mockInvoiceService }),
      );
    });
  });
});
